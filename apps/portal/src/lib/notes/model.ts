/**
 * 帳 Kimono Notes — notebooks of Markdown, kept in Drive.
 *
 * Notes has no storage of its own. A notebook is a Drive folder marked as
 * one (purpose "notebook"), in any space; folders in it are sections, and
 * every .md file is a note, its title the file's name without ".md". So the
 * same notes are in Drive (which shows a notebook as a notebook, not a
 * folder), in the Files app on the phone, and in Kimono AI, and Drive's rules
 * decide who may read or change them: a notebook is shared with whoever is in
 * its space, and can also be shared, staying where it is, with people outside
 * it, as can a single note (Drive's shares; see ../drive/model.ts).
 *
 * Someone with no notebook gets one, "Notes", the first time they ask, in
 * their own space: the oldest one they own and nobody else is in, or a new
 * "Personal" space if they have none. A notebook never holds another.
 *
 * Pure logic over the Drive database, tested in scripts/test-notes.mjs.
 */
import type { DatabaseSync } from "node:sqlite";
import { cleanName, createFolder, createSpace, DriveProblem, nodeFor, roleOn, setPurpose, sharedWithYou, spacesOf, type DriveNode, type Role, type Space } from "../drive/model";

export const firstNotebookName = "Notes";
export const personalSpaceName = "Personal";
/** The largest note: Markdown this long is a book, not a note. */
export const maxNoteBytes = 2 * 1024 * 1024;

export const isNoteName = (name: string) => /\.md$/i.test(name) && name.length > 3;
/** "Groceries.md" → "Groceries". */
export const titleOf = (name: string) => name.replace(/\.md$/i, "");
/** What a person types as a title, as a file name. Blank is "Untitled". */
export function noteName(rawTitle: unknown): string {
  const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle : "Untitled";
  return `${cleanName(title, "title")}.md`;
}

export type Notebook = {
  /** The notebook's folder. Notes and sections name it as their notebookId. */
  id: string; name: string; createdBy: string; createdAt: number; updatedAt: number;
  /** The space it is in: whoever is in that space shares it. */
  space: Pick<Space, "id" | "name" | "crest" | "color" | "members">;
  role: Role;
  /** Whether it is its space's top folder (made by sharing it on its own). */
  isSpace: boolean;
  /** Shared with this person from a space they aren't in; its space is then not theirs to see (name "", members 0). */
  sharedWithYou: boolean;
};
export type Section = { id: string; notebookId: string; parentId: string; name: string; updatedAt: number };
export type NoteMeta = {
  /** notebookId is null for a note shared with this person on its own, outside any notebook of theirs. */
  id: string; notebookId: string | null; parentId: string; title: string; createdBy: string; createdAt: number; updatedAt: number;
  /** The version an edit must start from to save over it (Drive's contentVersion). */
  version: number;
};

type Row = {
  id: string; space_id: string; parent_id: string | null; kind: "folder" | "file"; name: string; purpose: string | null;
  created_by: string; created_at: number; updated_at: number; content_version: number; blob: string | null; trashed_at: number | null;
};

/* Every live node in the person's spaces, as a walk down from each space's top folder. */
const liveIn = `WITH RECURSIVE live(id) AS (
    SELECT s.root_id FROM spaces s JOIN members m ON m.space_id = s.id AND m.username = ?
    UNION ALL
    SELECT c.id FROM nodes c JOIN live ON c.parent_id = live.id WHERE c.trashed_at IS NULL
  )`;
const columns = "n.id, n.space_id, n.parent_id, n.kind, n.name, n.purpose, n.created_by, n.created_at, n.updated_at, n.content_version, n.blob, n.trashed_at";

/** Every notebook the person can open, by name; ones they made first. */
export function notebooksOf(db: DatabaseSync, username: string): Notebook[] {
  const who = username.toLowerCase();
  const spaces = new Map(spacesOf(db, who).map((s) => [s.id, s]));
  const rows = db.prepare(`${liveIn} SELECT ${columns} FROM nodes n JOIN live ON live.id = n.id WHERE n.kind = 'folder' AND n.purpose = 'notebook'`).all(who) as Row[];
  const ids = new Set(rows.map((r) => r.id));
  return rows
    /* One inside another (moved there in Drive) is a section of the outer one. */
    .filter((r) => !ancestors(db, r.parent_id).some((a) => ids.has(a)))
    .flatMap((r) => {
      const space = spaces.get(r.space_id);
      if (!space) return [];
      return [{
        id: r.id, name: r.name, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
        space: { id: space.id, name: space.name, crest: space.crest, color: space.color, members: space.members },
        role: space.role, isSpace: space.rootId === r.id, sharedWithYou: false,
      }];
    })
    .concat(sharedWithYou(db, who).filter((n) => n.kind === "folder" && n.purpose === "notebook" && !ids.has(n.id)).map((n) => ({
      id: n.id, name: n.name, createdBy: n.createdBy, createdAt: n.createdAt, updatedAt: n.updatedAt,
      space: { id: n.spaceId, name: "", crest: "kikyo", color: "plum", members: 0 },
      role: roleOn(db, n.id, who) ?? "viewer", isSpace: false, sharedWithYou: true,
    })))
    .sort((a, b) => Number(a.sharedWithYou) - Number(b.sharedWithYou) || Number(b.createdBy === who) - Number(a.createdBy === who) || a.name.localeCompare(b.name));
}

function ancestors(db: DatabaseSync, from: string | null): string[] {
  const out: string[] = [];
  for (let at = from; at && out.length < 256;) {
    out.push(at);
    at = (db.prepare("SELECT parent_id FROM nodes WHERE id = ?").get(at) as { parent_id: string | null } | undefined)?.parent_id ?? null;
  }
  return out;
}

/** The notebook a node is in (itself, if it is one), or null. */
function notebookAbove(db: DatabaseSync, id: string): string | null {
  for (const at of ancestors(db, id).reverse()) {
    const row = db.prepare("SELECT purpose FROM nodes WHERE id = ?").get(at) as { purpose: string | null } | undefined;
    if (row?.purpose === "notebook") return at;
  }
  return null;
}

/** The person's own space for a first notebook: the oldest they own alone, else a new "Personal". */
export function personalSpace(db: DatabaseSync, username: string, now = Date.now()): Space {
  const who = username.toLowerCase();
  const alone = spacesOf(db, who).filter((s) => s.role === "owner" && s.members === 1 && s.createdBy === who).sort((a, b) => a.createdAt - b.createdAt);
  return alone[0] ?? createSpace(db, who, { name: personalSpaceName, crest: "sakura", color: "plum" }, now);
}

/** A new notebook, in the space named (by its id) or the person's own. */
export function createNotebook(db: DatabaseSync, username: string, input: { name?: unknown; space?: unknown }, now = Date.now()): Notebook {
  const name = typeof input.name === "string" && input.name.trim() ? input.name : firstNotebookName;
  const space = typeof input.space === "string" && input.space ? spacesOf(db, username).find((s) => s.id === input.space) : personalSpace(db, username, now);
  if (!space) throw new DriveProblem("That space doesn't exist, or you're not in it.", 404);
  const folder = createFolder(db, space.rootId, username, cleanName(name, "notebook name"), now);
  setPurpose(db, folder.id, username, "notebook", null, now);
  return notebooksOf(db, username).find((n) => n.id === folder.id)!;
}

/** The person's notebooks, making their first if they have none. */
export function ensureNotebook(db: DatabaseSync, username: string, now = Date.now()): Notebook[] {
  const found = notebooksOf(db, username);
  return found.some((n) => !n.sharedWithYou) ? found : [createNotebook(db, username, {}, now), ...found];
}

/** Where a new note goes when none is named: their first notebook they may write in. */
export function defaultNotebook(db: DatabaseSync, username: string): Notebook {
  const books = ensureNotebook(db, username);
  return books.find((b) => b.role !== "viewer" && !b.sharedWithYou) ?? createNotebook(db, username, {});
}

/**
 * Everything in the person's notebooks: sections, and notes newest first,
 * each with the blob its text is in (for the server to read, never to send).
 * Files that aren't Markdown are Drive's business and left out.
 */
export function libraryOf(db: DatabaseSync, username: string): { notebooks: Notebook[]; sections: Section[]; notes: (NoteMeta & { blob: string | null })[] } {
  const notebooks = ensureNotebook(db, username);
  if (!notebooks.length) return { notebooks, sections: [], notes: [] };
  const rows = db.prepare(`
    WITH RECURSIVE under(id, book) AS (
      SELECT value, value FROM json_each(?)
      UNION ALL
      SELECT c.id, under.book FROM nodes c JOIN under ON c.parent_id = under.id WHERE c.trashed_at IS NULL
    )
    SELECT ${columns}, under.book FROM nodes n JOIN under ON under.id = n.id WHERE n.id != under.book
  `).all(JSON.stringify(notebooks.map((n) => n.id))) as (Row & { book: string })[];
  const sections: Section[] = [], notes: (NoteMeta & { blob: string | null })[] = [];
  for (const row of rows) {
    if (row.kind === "folder") sections.push({ id: row.id, notebookId: row.book, parentId: row.parent_id!, name: row.name, updatedAt: row.updated_at });
    else if (isNoteName(row.name)) notes.push({ ...meta(row, row.book), blob: row.blob });
  }
  /* A note shared with them on its own stands outside their notebooks. */
  const listed = new Set(notes.map((n) => n.id));
  for (const shared of sharedWithYou(db, username)) {
    if (shared.kind !== "file" || !isNoteName(shared.name) || listed.has(shared.id)) continue;
    const row = db.prepare(`SELECT ${columns} FROM nodes n WHERE n.id = ?`).get(shared.id) as Row | undefined;
    if (row && notebookAbove(db, row.parent_id ?? "")) notes.push({ ...meta(row, null), blob: row.blob });
  }
  sections.sort((a, b) => a.name.localeCompare(b.name));
  notes.sort((a, b) => b.updatedAt - a.updatedAt);
  return { notebooks, sections, notes };
}

const meta = (row: Pick<Row, "id" | "parent_id" | "name" | "created_by" | "created_at" | "updated_at" | "content_version">, notebookId: string | null): NoteMeta => ({
  id: row.id, notebookId, parentId: row.parent_id!, title: titleOf(row.name), createdBy: row.created_by,
  createdAt: row.created_at, updatedAt: row.updated_at, version: row.content_version,
});

/** A Drive node as a note, refused if it isn't one, or isn't in a notebook. */
export function noteFrom(db: DatabaseSync, node: DriveNode & { blob: string | null }): NoteMeta & { blob: string | null } {
  const book = node.kind === "file" && isNoteName(node.name) && node.parentId ? notebookAbove(db, node.parentId) : null;
  if (!book) throw new DriveProblem("That isn't a note.", 404);
  return {
    ...meta({ id: node.id, parent_id: node.parentId, name: node.name, created_by: node.createdBy, created_at: node.createdAt, updated_at: node.updatedAt, content_version: node.contentVersion }, book),
    blob: node.blob,
  };
}

/** A note the person may see, at [need] or above. Its notebookId is null when they have the note but not its notebook. */
export function noteFor(db: DatabaseSync, id: string, username: string, need: Role = "viewer") {
  const note = noteFrom(db, nodeFor(db, id, username, need));
  return note.notebookId && !roleOn(db, note.notebookId, username) ? { ...note, notebookId: null } : note;
}

/** A notebook or a section in one, which the person may write in; with the notebook it is in. */
export function placeFor(db: DatabaseSync, id: string, username: string): DriveNode & { notebookId: string } {
  const folder = nodeFor(db, id, username, "editor");
  const book = folder.kind === "folder" ? notebookAbove(db, folder.id) : null;
  if (!book) throw new DriveProblem("Notes go in a notebook.", 404);
  const { blob, ...plain } = folder;
  void blob;
  return { ...plain, notebookId: book };
}

/** A notebook the person may open, at [need] or above. */
export function notebookFor(db: DatabaseSync, id: string, username: string, need: Role = "viewer"): Notebook {
  nodeFor(db, id, username, need);
  const book = notebooksOf(db, username).find((n) => n.id === id);
  if (!book) throw new DriveProblem("That notebook doesn't exist, or you're not in it.", 404);
  return book;
}

/** Where a notebook is, as Kimono AI asks for it: "Personal / Notes", or just its name when it is a space. */
export const notebookPlace = (book: Pick<Notebook, "name" | "isSpace" | "space">) => book.isSpace ? book.name : `${book.space.name} / ${book.name}`;

/** A note's text, cut to its first [chars] characters of prose: no markup, no title line. */
export function excerptOf(text: string, chars = 160): string {
  const prose = text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .split("\n").filter((line) => !/^\s*#\s/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/, "")).join(" ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|]/g, "")
    .replace(/\s+/g, " ").trim();
  return [...prose].length > chars ? `${[...prose].slice(0, chars).join("").trimEnd()}…` : prose;
}
