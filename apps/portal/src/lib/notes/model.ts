/**
 * 帳 Kimono Notes — notebooks of Markdown, kept in Drive.
 *
 * Notes has no storage of its own. A notebook is a Drive space whose purpose
 * is "notes"; folders in it are sections, and every .md file is a note, its
 * title the file's name without ".md". So the same notes show in Drive, in
 * the Files app on the phone, and to anything that reads Markdown, and
 * Drive's rules decide who may read or change them (see ../drive/model.ts).
 *
 * Everyone gets their own notebook, "Notes", made the first time they ask.
 * Sharing a section turns it into a notebook of its own (Drive's
 * folderToSpace), which keeps the purpose.
 *
 * Pure logic over the Drive database, tested in scripts/test-notes.mjs.
 */
import type { DatabaseSync } from "node:sqlite";
import { cleanName, createSpace, DriveProblem, nodeFor, spacesOf, type DriveNode, type Role, type Space } from "../drive/model";

export const ownNotebookName = "Notes";
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

export type Notebook = Pick<Space, "id" | "name" | "crest" | "color" | "rootId" | "role" | "members" | "createdBy"> & { own: boolean };
export type Section = { id: string; notebookId: string; parentId: string; name: string; updatedAt: number };
export type NoteMeta = {
  id: string; notebookId: string; parentId: string; title: string; createdBy: string; createdAt: number; updatedAt: number;
  /** The version an edit must start from to save over it (Drive's contentVersion). */
  version: number;
};

const asNotebook = (space: Space, username: string): Notebook => ({
  id: space.id, name: space.name, crest: space.crest, color: space.color, rootId: space.rootId, role: space.role, members: space.members,
  createdBy: space.createdBy, own: space.createdBy === username.toLowerCase(),
});

/** The person's own notebook, made the first time it's asked for. */
export function ownNotebook(db: DatabaseSync, username: string, now = Date.now()): Notebook {
  const mine = spacesOf(db, username).filter((s) => s.purpose === "notes" && s.createdBy === username.toLowerCase() && s.role === "owner")
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  return asNotebook(mine ?? createSpace(db, username, { name: ownNotebookName, crest: "kikyo", color: "plum", purpose: "notes" }, now), username);
}

/** Every notebook the person is in, their own first. */
export function notebooksOf(db: DatabaseSync, username: string): Notebook[] {
  ownNotebook(db, username);
  return spacesOf(db, username).filter((s) => s.purpose === "notes").map((s) => asNotebook(s, username))
    .sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name));
}

type Row = { id: string; space_id: string; parent_id: string; kind: "folder" | "file"; name: string; created_by: string; created_at: number; updated_at: number; content_version: number; blob: string | null };

/**
 * Everything in the person's notebooks: sections, and notes newest first,
 * each with the blob its text is in (for the server to read, never to send).
 * Files that aren't Markdown are Drive's business and left out.
 */
export function libraryOf(db: DatabaseSync, username: string): { notebooks: Notebook[]; sections: Section[]; notes: (NoteMeta & { blob: string | null })[] } {
  const notebooks = notebooksOf(db, username);
  const roots = notebooks.map((n) => n.rootId);
  if (!roots.length) return { notebooks, sections: [], notes: [] };
  const rows = db.prepare(`
    WITH RECURSIVE live(id) AS (
      SELECT value FROM json_each(?)
      UNION ALL
      SELECT c.id FROM nodes c JOIN live ON c.parent_id = live.id WHERE c.trashed_at IS NULL
    )
    SELECT n.id, n.space_id, n.parent_id, n.kind, n.name, n.created_by, n.created_at, n.updated_at, n.content_version, n.blob
    FROM nodes n JOIN live ON live.id = n.id WHERE n.parent_id IS NOT NULL
  `).all(JSON.stringify(roots)) as Row[];
  const sections: Section[] = [], notes: (NoteMeta & { blob: string | null })[] = [];
  for (const row of rows) {
    if (row.kind === "folder") sections.push({ id: row.id, notebookId: row.space_id, parentId: row.parent_id, name: row.name, updatedAt: row.updated_at });
    else if (isNoteName(row.name)) notes.push({ ...meta(row), blob: row.blob });
  }
  sections.sort((a, b) => a.name.localeCompare(b.name));
  notes.sort((a, b) => b.updatedAt - a.updatedAt);
  return { notebooks, sections, notes };
}

const meta = (row: Pick<Row, "id" | "space_id" | "parent_id" | "name" | "created_by" | "created_at" | "updated_at" | "content_version">): NoteMeta => ({
  id: row.id, notebookId: row.space_id, parentId: row.parent_id, title: titleOf(row.name), createdBy: row.created_by,
  createdAt: row.created_at, updatedAt: row.updated_at, version: row.content_version,
});

/** A Drive node as a note, refused if it isn't one, or isn't in a notebook. */
export function noteFrom(db: DatabaseSync, node: DriveNode & { blob: string | null }): NoteMeta & { blob: string | null } {
  if (node.kind !== "file" || !isNoteName(node.name) || !inNotebook(db, node.spaceId)) throw new DriveProblem("That isn't a note.", 404);
  return {
    ...meta({ id: node.id, space_id: node.spaceId, parent_id: node.parentId!, name: node.name, created_by: node.createdBy, created_at: node.createdAt, updated_at: node.updatedAt, content_version: node.contentVersion }),
    blob: node.blob,
  };
}

/** A note the person may see, at [need] or above. */
export function noteFor(db: DatabaseSync, id: string, username: string, need: Role = "viewer") {
  return noteFrom(db, nodeFor(db, id, username, need));
}

/** A folder in a notebook (a notebook's top or a section) the person may write in. */
export function placeFor(db: DatabaseSync, id: string, username: string): DriveNode {
  const folder = nodeFor(db, id, username, "editor");
  if (folder.kind !== "folder" || !inNotebook(db, folder.spaceId)) throw new DriveProblem("Notes go in a notebook.", 404);
  return folder;
}

function inNotebook(db: DatabaseSync, spaceId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM spaces WHERE id = ? AND purpose = 'notes'").get(spaceId));
}

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
