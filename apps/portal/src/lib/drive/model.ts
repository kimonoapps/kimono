/**
 * 堂 Kimono Drive — spaces, folders, files, members and public links.
 *
 * Pure logic over a SQLite database (Node's built-in node:sqlite), with no
 * Next.js imports, so it is tested directly (scripts/test-drive.mjs). File
 * bytes live on disk beside the database; see ./storage.ts.
 *
 * The rules, kept simple enough to predict:
 *   - A space is the unit of access. Its members are owners, editors or
 *     viewers. Folders inside it have no access of their own.
 *   - Viewers open and download. Editors also upload, make folders, rename,
 *     move, trash and restore, and make or turn off public links. Owners also
 *     manage members, rename the space, and turn folders into spaces.
 *   - A space always keeps at least one owner.
 *   - Spaces don't nest: a folder turned into a space leaves its old space,
 *     contents and public links with it; only the person who turned it and
 *     the people they choose are its members.
 *   - Names are unique within a folder, ignoring case; a clash on upload gets
 *     " (2)", " (3)" … before the extension.
 *   - Trash keeps things for 30 days. A public link to something in the trash
 *     stops working, and works again if it is restored.
 *   - An owner can open a space to anyone with its link, to view and download,
 *     or also to add files. Such guests never see who is in the space, and
 *     can't rename, move or remove anything. Turning the link off ends it for
 *     good; turning it on again makes a new one.
 *   - Being a Kimono admin gives no access to other people's spaces.
 *   - One folder or file can also be shared with people outside its space,
 *     as an editor or a viewer of it and everything in it (migration 8). It
 *     stays where it is; for them it stands on its own ("shared with you").
 *     Anyone who may edit it may share it, change who it's shared with, or
 *     take someone off; anyone may take themselves off. Someone in it only
 *     through a share can't trash it (they leave it instead). A share gives
 *     no say over the space: its members, its link, its name.
 *   - A notebook (a folder) can also have a public link, read-only, like a
 *     file's.
 *
 * Every change is logged (see changesFor) so devices keep a copy in step:
 * the Files app on iPhone and Android, and the Kimono apps' offline cache.
 * Each node carries a version, bumped on any change, and a contentVersion,
 * bumped only when its bytes are replaced.
 */
import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

let savepoints = 0;
/**
 * Starts a transaction, or a savepoint inside one already open (a Notes space
 * made during an import, say), so each change here is all or nothing either way.
 */
export function begin(db: DatabaseSync): { commit: () => void; rollback: () => void } {
  if (db.isTransaction) {
    const name = `kimono_${++savepoints}`;
    db.exec(`SAVEPOINT ${name}`);
    return { commit: () => db.exec(`RELEASE ${name}`), rollback: () => { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); } };
  }
  db.exec("BEGIN");
  return { commit: () => db.exec("COMMIT"), rollback: () => db.exec("ROLLBACK") };
}

export type Role = "owner" | "editor" | "viewer";
export type LinkAccess = "view" | "add";
export type Space = {
  id: string; name: string; crest: string; color: string; rootId: string; createdBy: string; createdAt: number; role: Role; members: number;
  link: string | null; linkAccess: LinkAccess | null;
  /** "notes" for the person's Kimono Notes space, which Drive lists with Kimono's own; null for any other. */
  purpose: SpacePurpose | null;
};
export type SpacePurpose = "notes";
/** What a folder is when it is more than a folder (see migration 7). */
export type FolderPurpose = "notebook" | "chat" | "project";
export const folderPurposes: readonly FolderPurpose[] = ["notebook", "chat", "project"];
export type Member = { username: string; role: Role; addedAt: number };
export type DriveNode = {
  id: string; spaceId: string; parentId: string | null; kind: "folder" | "file"; name: string;
  size: number; mime: string | null; createdBy: string; createdAt: number; updatedAt: number;
  /** Who last saved its contents. */
  updatedBy: string;
  trashedAt: number | null; link: string | null;
  /** The name a guest gave when adding this through the space's link (createdBy is then ""). */
  guest: string | null;
  /** Goes up on any change to the node. */
  version: number;
  /** Goes up only when the file's bytes are replaced. */
  contentVersion: number;
  /** A folder that is a notebook, chat or project; null for a plain folder or a file. */
  purpose: FolderPurpose | null;
  /** Which chat or project it is, for its app to open. */
  ref: string | null;
  /** Set when it was shared with this person on its own, from a space they aren't in: it stands at their top level. */
  sharedWithYou?: boolean;
  /** What the person asking may do with it, when known: devices need it for things shared from spaces they aren't in. */
  role?: Role;
  /** Who shared it with them, on a shared-with-you item. */
  sharedBy?: string;
};

/** A refusal a person can read. Routes turn it into a 4xx with this sentence. */
export class DriveProblem extends Error {
  readonly status: 400 | 403 | 404 | 409 | 410 | 413 | 429 | 507;
  constructor(message: string, status: 400 | 403 | 404 | 409 | 410 | 413 | 429 | 507 = 400) {
    super(message);
    this.status = status;
  }
}

export const crests = ["sakura", "ume", "kikyo", "kiku", "hanabishi", "nadeshiko", "aoi"] as const;
/** The colours a crest can be (their inks live with the drawing, in @kimono/ui/crest). */
export const crestColours = ["plum", "suo", "sakura", "fuji", "ai", "asagi", "koke", "kincha"] as const;
export const trashDays = 30;
const rank: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export const newId = (bytes = 16) => randomBytes(bytes).toString("base64url");

/** A node as people see it: where its bytes live on disk is the server's business. */
export function withoutBlob<T extends { blob?: unknown }>(node: T): Omit<T, "blob"> {
  const copy = { ...node };
  delete copy.blob;
  return copy;
}

export function migrate(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const version = Number((db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value?: string } | undefined)?.value ?? 0);
  if (version < 1) {
    db.exec(`
      BEGIN;
      CREATE TABLE spaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, crest TEXT NOT NULL, root_id TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE members (
        space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        username TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
        added_at INTEGER NOT NULL, PRIMARY KEY (space_id, username)
      );
      CREATE INDEX members_by_user ON members (username);
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES nodes(id), kind TEXT NOT NULL CHECK (kind IN ('folder', 'file')),
        name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, mime TEXT, blob TEXT,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        trashed_at INTEGER, trashed_by TEXT
      );
      CREATE INDEX nodes_by_parent ON nodes (parent_id);
      CREATE UNIQUE INDEX nodes_unique_name ON nodes (parent_id, lower(name)) WHERE trashed_at IS NULL AND parent_id IS NOT NULL;
      CREATE TABLE links (
        token TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER
      );
      CREATE INDEX links_by_node ON links (node_id);
      CREATE TABLE uploads (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        parent_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL,
        received INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '1');
      COMMIT;
    `);
  }
  if (version < 2) {
    /* Big uploads take days; they are judged by when bytes last arrived. */
    db.exec(`
      BEGIN;
      ALTER TABLE uploads ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
      UPDATE uploads SET updated_at = created_at;
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '2');
      COMMIT;
    `);
  }
  if (version < 3) {
    /* Spaces open to anyone with their link, and the files guests add through it. */
    db.exec(`
      BEGIN;
      ALTER TABLE spaces ADD COLUMN link TEXT;
      ALTER TABLE spaces ADD COLUMN link_access TEXT CHECK (link_access IN ('view', 'add'));
      CREATE UNIQUE INDEX spaces_by_link ON spaces (link) WHERE link IS NOT NULL;
      ALTER TABLE nodes ADD COLUMN guest TEXT;
      ALTER TABLE uploads ADD COLUMN link TEXT;
      ALTER TABLE uploads ADD COLUMN guest TEXT;
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '3');
      COMMIT;
    `);
  }
  if (version < 4) {
    /*
     * The change log devices sync from. A row says "this node changed" in a
     * space (seen by its members), or for one person (they joined or left
     * the space whose top folder it is). What changed is read from the node
     * as it is now, so the log never has to describe it.
     */
    db.exec(`
      BEGIN;
      ALTER TABLE nodes ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE nodes ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE uploads ADD COLUMN replaces TEXT;
      ALTER TABLE uploads ADD COLUMN base_version INTEGER;
      CREATE TABLE changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT NOT NULL,
        space_id TEXT, username TEXT, at INTEGER NOT NULL
      );
      CREATE INDEX changes_by_space ON changes (space_id, seq);
      CREATE INDEX changes_by_user ON changes (username, seq);
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '4');
      COMMIT;
    `);
  }
  if (version < 5) {
    /* Each space's crest gets a colour, plum until its owner picks another. */
    db.exec(`
      BEGIN;
      ALTER TABLE spaces ADD COLUMN color TEXT NOT NULL DEFAULT 'plum';
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '5');
      COMMIT;
    `);
  }
  if (version < 6) {
    /* What a space is for: null for files, 'notes' for a notebook Kimono Notes keeps as Markdown files. */
    db.exec(`
      BEGIN;
      ALTER TABLE spaces ADD COLUMN purpose TEXT CHECK (purpose IN ('notes'));
      CREATE INDEX spaces_by_purpose ON spaces (purpose) WHERE purpose IS NOT NULL;
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '6');
      COMMIT;
    `);
  }
  if (version < 7) {
    /*
     * What a folder is, when it is more than a folder: a notebook Kimono Notes
     * keeps, or a Kimono AI chat or project, with [ref] naming which chat or
     * project. Drive shows each as itself and opens it in its app. This
     * replaces 6's notebooks-as-spaces: a notebook is a folder in any space,
     * and one that was a space keeps being one, as its top folder.
     */
    db.exec(`
      BEGIN;
      ALTER TABLE nodes ADD COLUMN purpose TEXT CHECK (purpose IN ('notebook', 'chat', 'project'));
      ALTER TABLE nodes ADD COLUMN ref TEXT;
      UPDATE nodes SET purpose = 'notebook' WHERE id IN (SELECT root_id FROM spaces WHERE purpose = 'notes');
      UPDATE spaces SET purpose = NULL;
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '7');
      COMMIT;
    `);
  }
  if (version < 8) {
    /* A folder or file shared with someone outside its space, and what they may do with it. */
    db.exec(`
      BEGIN;
      CREATE TABLE shares (
        node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        username TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
        added_by TEXT NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY (node_id, username)
      );
      CREATE INDEX shares_by_user ON shares (username);
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '8');
      COMMIT;
    `);
  }
  if (version < 9) {
    /* Who last saved a file's contents (its maker, until someone saves over it). */
    db.exec(`
      BEGIN;
      ALTER TABLE nodes ADD COLUMN updated_by TEXT;
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '9');
      COMMIT;
    `);
  }
  if (version < 10) {
    /* A folder's own crest and colour (a notebook's), over its space's. */
    db.exec(`
      BEGIN;
      ALTER TABLE nodes ADD COLUMN crest TEXT;
      ALTER TABLE nodes ADD COLUMN color TEXT;
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '10');
      COMMIT;
    `);
  }
}

/* ── the change log ── */

/** Records that a node changed, for everyone in its space, and bumps its version. */
function touch(db: DatabaseSync, nodeId: string, spaceId: string, now = Date.now()) {
  db.prepare("UPDATE nodes SET version = version + 1 WHERE id = ?").run(nodeId);
  db.prepare("INSERT INTO changes (node_id, space_id, at) VALUES (?, ?, ?)").run(nodeId, spaceId, now);
}

/** Records, for one person, that a space appeared, disappeared or changed for them. */
function touchFor(db: DatabaseSync, spaceId: string, username: string, now = Date.now()) {
  const root = db.prepare("SELECT root_id FROM spaces WHERE id = ?").get(spaceId) as { root_id: string } | undefined;
  if (root) db.prepare("INSERT INTO changes (node_id, username, at) VALUES (?, ?, ?)").run(root.root_id, username.toLowerCase(), now);
}

/** How long the log is kept. A device away for longer starts over from a full listing. */
export const changeLogDays = 90;

export type Changes = {
  /** Where to ask from next time. */
  cursor: number;
  /** Nodes that are new or changed, as they are now. A space's top folder has parentId null. */
  changed: DriveNode[];
  /** Nodes the person can no longer see: removed, trashed, or in a space they left. Children go with them. */
  removed: string[];
  /** Ask again straight away: there is more. */
  more: boolean;
  /** The person's spaces and roles, which decide what they may do with each node. */
  spaces: Space[];
};

/**
 * What changed for a person since [since] (a cursor from an earlier answer;
 * 0 to start). Throws 410 when [since] is older than the log, meaning: list
 * everything again.
 */
export function changesFor(db: DatabaseSync, username: string, since: number, limit = 500): Changes {
  const who = username.toLowerCase();
  if (!Number.isSafeInteger(since) || since < 0) throw new DriveProblem("Give a cursor from an earlier answer.");
  const forgotten = Number((db.prepare("SELECT value FROM meta WHERE key = 'changes_forgotten'").get() as { value?: string } | undefined)?.value ?? 0);
  if (since < forgotten) throw new DriveProblem("That's too long ago. List everything again.", 410);
  /* The log's end, even when every row before it has been forgotten. */
  const latest = latestChange(db);
  if (since > latest) throw new DriveProblem("That cursor isn't from this Drive. List everything again.", 410);
  const rows = db.prepare(`
    SELECT node_id, max(seq) AS seq FROM changes
    WHERE seq > ? AND (username = ? OR space_id IN (SELECT space_id FROM members WHERE username = ?)
      OR space_id IN (SELECT n.space_id FROM shares s JOIN nodes n ON n.id = s.node_id WHERE s.username = ?))
    GROUP BY node_id ORDER BY seq LIMIT ?
  `).all(since, who, who, who, limit + 1) as { node_id: string; seq: number }[];
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const changed: DriveNode[] = [], removed: string[] = [];
  for (const { node_id } of page) {
    const row = nodeRow(db, node_id);
    const role = row ? roleOn(db, node_id, who) : null;
    if (row && role && !inTrash(db, node_id)) changed.push(asSeenBy(db, toNode(row, role), who));
    else removed.push(node_id);
  }
  /* With no more to come, the cursor is the log's end, so others' unrelated changes aren't asked about again. */
  const cursor = more ? page[page.length - 1].seq : Math.max(latest, since);
  return { cursor, changed, removed, more, spaces: spacesOf(db, who) };
}

/** Something shared with someone outside its space stands on its own for them: no parent they can't see. */
export function asSeenBy<T extends DriveNode>(db: DatabaseSync, node: T, username: string): T {
  if (node.parentId && !roleOn(db, node.parentId, username)) return { ...node, parentId: null, sharedWithYou: true };
  return node;
}

/** The log's end: a cursor for a device that has just listed everything. */
export function latestChange(db: DatabaseSync): number {
  return Number((db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'changes'").get() as { seq?: number } | undefined)?.seq ?? 0);
}

/** Forgets log entries older than [changeLogDays]. */
export function forgetOldChanges(db: DatabaseSync, now = Date.now()) {
  const cutoff = now - changeLogDays * 24 * 60 * 60 * 1000;
  const last = (db.prepare("SELECT max(seq) AS n FROM changes WHERE at < ?").get(cutoff) as { n: number | null }).n;
  if (last === null) return;
  db.prepare("DELETE FROM changes WHERE seq <= ?").run(last);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('changes_forgotten', ?)").run(String(last));
}

/* ── names ── */

const forbidden = /[\u0000-\u001f\u007f/\\]/;

/** A name as people type it, checked: no slashes, no control characters, not "." or "..". */
export function cleanName(raw: unknown, what = "name"): string {
  if (typeof raw !== "string") throw new DriveProblem(`Give it a ${what}.`);
  const name = raw.normalize("NFC").trim();
  if (!name) throw new DriveProblem(`Give it a ${what}.`);
  if (name === "." || name === "..") throw new DriveProblem(`That ${what} isn't allowed.`);
  if (forbidden.test(name)) throw new DriveProblem(`A ${what} can't contain slashes or control characters.`);
  if (Buffer.byteLength(name) > 255) throw new DriveProblem(`That ${what} is too long.`);
  return name;
}

/** "clip.mp4" → "clip (2).mp4", "notes" → "notes (2)". */
export function numbered(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

/* ── reading ── */

type NodeRow = {
  id: string; space_id: string; parent_id: string | null; kind: "folder" | "file"; name: string; size: number;
  mime: string | null; blob: string | null; created_by: string; created_at: number; updated_at: number; updated_by: string | null;
  trashed_at: number | null; link: string | null; guest: string | null; version: number; content_version: number;
  purpose: FolderPurpose | null; ref: string | null;
};

const nodeColumns = `n.id, n.space_id, n.parent_id, n.kind, n.name, n.size, n.mime, n.blob, n.created_by, n.created_at, n.updated_at, n.updated_by, n.trashed_at, n.guest, n.version, n.content_version, n.purpose, n.ref,
  (SELECT token FROM links l WHERE l.node_id = n.id AND l.revoked_at IS NULL ORDER BY l.created_at DESC LIMIT 1) AS link`;

/* Links are for those who may make or turn them off: a viewer handed one could pass on what they were only meant to see. */
const seesLinks = (role: Role | null) => role !== null && rank[role] >= rank.editor;

/** A node as [role] sees it (null: a guest, or nobody in particular). */
const toNode = (row: NodeRow, role: Role | null): DriveNode => ({
  id: row.id, spaceId: row.space_id, parentId: row.parent_id, kind: row.kind, name: row.name, size: row.size,
  mime: row.mime, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, updatedBy: row.updated_by ?? row.created_by,
  trashedAt: row.trashed_at, link: seesLinks(role) ? row.link : null, guest: row.guest, version: row.version, contentVersion: row.content_version,
  purpose: row.purpose ?? null, ref: row.ref ?? null, ...(role ? { role } : {}),
});

function nodeRow(db: DatabaseSync, id: string): (NodeRow & { blob: string | null }) | undefined {
  return db.prepare(`SELECT ${nodeColumns} FROM nodes n WHERE n.id = ?`).get(id) as (NodeRow & { blob: string | null }) | undefined;
}

export function roleIn(db: DatabaseSync, spaceId: string, username: string): Role | null {
  const row = db.prepare("SELECT role FROM members WHERE space_id = ? AND username = ?").get(spaceId, username.toLowerCase()) as { role?: Role } | undefined;
  return row?.role ?? null;
}

/** The roles at or above a node a share gives, nearest first: [nodeId, role][]. */
function sharesAbove(db: DatabaseSync, nodeId: string, username: string): { nodeId: string; role: Role }[] {
  const who = username.toLowerCase();
  const out: { nodeId: string; role: Role }[] = [];
  for (let at: string | null = nodeId, depth = 0; at && depth < 256; depth += 1) {
    const share = db.prepare("SELECT role FROM shares WHERE node_id = ? AND username = ?").get(at, who) as { role?: Role } | undefined;
    if (share?.role) out.push({ nodeId: at, role: share.role });
    at = (db.prepare("SELECT parent_id FROM nodes WHERE id = ?").get(at) as { parent_id: string | null } | undefined)?.parent_id ?? null;
  }
  return out;
}

/**
 * What the person may do with a node: their role in its space, or what a
 * share of it (or of a folder above it) gives, whichever is more.
 */
export function roleOn(db: DatabaseSync, nodeId: string, username: string): Role | null {
  const row = db.prepare("SELECT space_id FROM nodes WHERE id = ?").get(nodeId) as { space_id: string } | undefined;
  if (!row) return null;
  const inSpace = roleIn(db, row.space_id, username);
  if (inSpace === "owner") return inSpace;
  const best = sharesAbove(db, nodeId, username).reduce<Role | null>((most, s) => !most || rank[s.role] > rank[most] ? s.role : most, inSpace);
  return best;
}

/** The person's role in the space, refused below [need]. Unknown spaces and spaces you aren't in look the same. */
function require(db: DatabaseSync, spaceId: string, username: string, need: Role): Role {
  const role = roleIn(db, spaceId, username);
  if (!role) throw new DriveProblem("That space doesn't exist, or you're not in it.", 404);
  if (rank[role] < rank[need]) throw new DriveProblem(need === "owner" ? "Only the space's owners can do that." : "You can only view this space.", 403);
  return role;
}

/** Whether a node or any folder above it is in the trash. */
function inTrash(db: DatabaseSync, id: string): boolean {
  let current: string | null = id;
  for (let depth = 0; current && depth < 256; depth += 1) {
    const row = db.prepare("SELECT parent_id, trashed_at FROM nodes WHERE id = ?").get(current) as { parent_id: string | null; trashed_at: number | null } | undefined;
    if (!row) return true;
    if (row.trashed_at !== null) return true;
    current = row.parent_id;
  }
  return false;
}

/** A node the person may see, at [need] or above; trashed ones only if asked. */
export function nodeFor(db: DatabaseSync, id: string, username: string, need: Role = "viewer", { trashed = false } = {}): DriveNode & { blob: string | null } {
  const row = nodeRow(db, id);
  if (!row) throw new DriveProblem("That file or folder doesn't exist.", 404);
  const role = roleOn(db, id, username);
  if (!role) throw new DriveProblem("That file or folder doesn't exist.", 404);
  if (rank[role] < rank[need]) throw new DriveProblem(need === "owner" ? "Only the space's owners can do that." : "You can only view this.", 403);
  if (!trashed && inTrash(db, id)) throw new DriveProblem("That's in the trash.", 404);
  return { ...toNode(row, role), blob: row.blob };
}

export function spacesOf(db: DatabaseSync, username: string): Space[] {
  const rows = db.prepare(`
    SELECT s.id, s.name, s.crest, s.color, s.root_id, s.created_by, s.created_at, s.link, s.link_access, s.purpose, m.role,
      (SELECT count(*) FROM members x WHERE x.space_id = s.id) AS members
    FROM spaces s JOIN members m ON m.space_id = s.id AND m.username = ?
    ORDER BY lower(s.name)
  `).all(username.toLowerCase()) as { id: string; name: string; crest: string; color: string; root_id: string; created_by: string; created_at: number; link: string | null; link_access: LinkAccess | null; purpose: SpacePurpose | null; role: Role; members: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, crest: r.crest, color: r.color, rootId: r.root_id, createdBy: r.created_by, createdAt: r.created_at, role: r.role, members: r.members,
    link: seesLinks(r.role) ? r.link : null, linkAccess: seesLinks(r.role) ? r.link_access : null, purpose: r.purpose ?? null }));
}

export function spaceFor(db: DatabaseSync, spaceId: string, username: string): Space & { memberList: Member[] } {
  const space = spacesOf(db, username).find((s) => s.id === spaceId);
  if (!space) throw new DriveProblem("That space doesn't exist, or you're not in it.", 404);
  const memberList = (db.prepare("SELECT username, role, added_at FROM members WHERE space_id = ? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, username").all(spaceId) as { username: string; role: Role; added_at: number }[])
    .map((m) => ({ username: m.username, role: m.role, addedAt: m.added_at }));
  return { ...space, memberList };
}

/** What is in a folder: folders first, then files, by name. */
export function childrenOf(db: DatabaseSync, folderId: string, username: string): { folder: DriveNode; path: DriveNode[]; children: DriveNode[] } {
  const folder = nodeFor(db, folderId, username);
  if (folder.kind !== "folder") throw new DriveProblem("That's a file, not a folder.");
  const role = roleOn(db, folder.id, username);
  const children = (db.prepare(`SELECT ${nodeColumns} FROM nodes n WHERE n.parent_id = ? AND n.trashed_at IS NULL ORDER BY n.kind = 'file', lower(n.name)`).all(folderId) as NodeRow[]).map((row) => toNode(row, role));
  const path: DriveNode[] = [];
  /* Someone in it only through a share sees the way down from what was shared with them, no further up. */
  for (let at: string | null = folder.parentId; at && path.length < 256;) {
    const row = nodeRow(db, at);
    if (!row || !roleOn(db, at, username)) break;
    path.unshift(toNode(row, role));
    at = row.parent_id;
  }
  return { folder: asSeenBy(db, withoutBlob(folder), username), path, children };
}

/** Everything in the person's spaces that is in the trash, newest first. */
export function trashOf(db: DatabaseSync, username: string): DriveNode[] {
  return (db.prepare(`SELECT ${nodeColumns}, m.role FROM nodes n JOIN members m ON m.space_id = n.space_id AND m.username = ? WHERE n.trashed_at IS NOT NULL ORDER BY n.trashed_at DESC LIMIT 500`).all(username.toLowerCase()) as (NodeRow & { role: Role })[]).map((row) => toNode(row, row.role));
}

/**
 * Every live file and folder in the person's spaces, as a recursive walk down
 * from each space's top folder: anything inside a trashed folder is left out
 * too, though only the folder itself is marked.
 */
const liveNodes = `WITH RECURSIVE live(id) AS (
    SELECT s.root_id FROM spaces s JOIN members m ON m.space_id = s.id AND m.username = ?1
    UNION
    SELECT sh.node_id FROM shares sh JOIN nodes x ON x.id = sh.node_id WHERE sh.username = ?1 AND x.trashed_at IS NULL
    UNION
    SELECT c.id FROM nodes c JOIN live ON c.parent_id = live.id WHERE c.trashed_at IS NULL
  )`;

/* The person's role in each node's space, which decides whether they see its link. */
const roleColumn = "(SELECT role FROM members WHERE space_id = n.space_id AND username = ?) AS role";

/** Files and folders whose names contain [query], ignoring case: up to [limit], closest names first. */
export function searchNodes(db: DatabaseSync, username: string, query: string, limit = 50): DriveNode[] {
  const words = query.trim().toLowerCase();
  if (!words) return [];
  const pattern = `%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return (db.prepare(`${liveNodes}
    SELECT ${nodeColumns}, ${roleColumn} FROM nodes n JOIN live ON live.id = n.id
    WHERE n.parent_id IS NOT NULL AND lower(n.name) LIKE ? ESCAPE '\\'
    ORDER BY lower(n.name) = ? DESC, instr(lower(n.name), ?) = 1 DESC, n.updated_at DESC LIMIT ?`)
    .all(username.toLowerCase(), username.toLowerCase(), pattern, words, words, Math.min(Math.max(1, limit), 200)) as (NodeRow & { role: Role })[]).map((row) => toNode(row, row.role ?? roleOn(db, row.id, username)));
}

/** The person's most recently changed files, newest first. */
export function recentFiles(db: DatabaseSync, username: string, limit = 50): DriveNode[] {
  return (db.prepare(`${liveNodes}
    SELECT ${nodeColumns}, ${roleColumn} FROM nodes n JOIN live ON live.id = n.id
    WHERE n.kind = 'file' ORDER BY n.updated_at DESC LIMIT ?`)
    .all(username.toLowerCase(), username.toLowerCase(), Math.min(Math.max(1, limit), 200)) as (NodeRow & { role: Role })[]).map((row) => toNode(row, row.role ?? roleOn(db, row.id, username)));
}

/* ── spaces and members ── */

export function createSpace(db: DatabaseSync, username: string, input: { name: unknown; crest?: unknown; color?: unknown; members?: { username: string; role: Role }[] }, now = Date.now()): Space {
  const name = cleanName(input.name, "space name");
  const crest = typeof input.crest === "string" && (crests as readonly string[]).includes(input.crest) ? input.crest : "sakura";
  const color = typeof input.color === "string" && (crestColours as readonly string[]).includes(input.color) ? input.color : "plum";
  const owner = username.toLowerCase();
  const id = newId(), rootId = newId();
  const tx = begin(db);
  try {
    db.prepare("INSERT INTO spaces (id, name, crest, color, root_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, name, crest, color, rootId, owner, now);
    db.prepare("INSERT INTO nodes (id, space_id, parent_id, kind, name, created_by, created_at, updated_at) VALUES (?, ?, NULL, 'folder', ?, ?, ?, ?)").run(rootId, id, name, owner, now, now);
    db.prepare("INSERT INTO members (space_id, username, role, added_at) VALUES (?, ?, 'owner', ?)").run(id, owner, now);
    for (const member of input.members ?? []) {
      const who = member.username.toLowerCase();
      if (who === owner) continue;
      db.prepare("INSERT OR REPLACE INTO members (space_id, username, role, added_at) VALUES (?, ?, ?, ?)").run(id, who, validRole(member.role), now);
    }
    touch(db, rootId, id, now);
    tx.commit();
  } catch (error) { tx.rollback(); throw error; }
  return spacesOf(db, owner).find((s) => s.id === id)!;
}

function validRole(role: unknown): Role {
  if (role === "owner" || role === "editor" || role === "viewer") return role;
  throw new DriveProblem("A member is an owner, an editor or a viewer.");
}

export function renameSpace(db: DatabaseSync, spaceId: string, username: string, input: { name?: unknown; crest?: unknown; color?: unknown }) {
  require(db, spaceId, username, "owner");
  if (input.name !== undefined) {
    const name = cleanName(input.name, "space name");
    db.prepare("UPDATE spaces SET name = ? WHERE id = ?").run(name, spaceId);
    db.prepare("UPDATE nodes SET name = ? WHERE id = (SELECT root_id FROM spaces WHERE id = ?)").run(name, spaceId);
    touch(db, (db.prepare("SELECT root_id FROM spaces WHERE id = ?").get(spaceId) as { root_id: string }).root_id, spaceId);
  }
  if (input.crest !== undefined) {
    if (typeof input.crest !== "string" || !(crests as readonly string[]).includes(input.crest)) throw new DriveProblem("Pick one of the crests.");
    db.prepare("UPDATE spaces SET crest = ? WHERE id = ?").run(input.crest, spaceId);
  }
  if (input.color !== undefined) {
    if (typeof input.color !== "string" || !(crestColours as readonly string[]).includes(input.color)) throw new DriveProblem("Pick one of the colours.");
    db.prepare("UPDATE spaces SET color = ? WHERE id = ?").run(input.color, spaceId);
  }
}

/** Adds someone, changes their role, or (role null) removes them. A space always keeps an owner. */
export function setMember(db: DatabaseSync, spaceId: string, username: string, who: string, role: Role | null, now = Date.now()) {
  const self = username.toLowerCase(), target = who.toLowerCase();
  /* Anyone may leave; everything else is for owners. */
  if (!(role === null && target === self)) require(db, spaceId, username, "owner");
  else require(db, spaceId, username, "viewer");
  const owners = (db.prepare("SELECT count(*) AS n FROM members WHERE space_id = ? AND role = 'owner'").get(spaceId) as { n: number }).n;
  const current = roleIn(db, spaceId, target);
  if (current === "owner" && role !== "owner" && owners <= 1) throw new DriveProblem("A space needs an owner. Make someone else an owner first.", 409);
  if (role === null) db.prepare("DELETE FROM members WHERE space_id = ? AND username = ?").run(spaceId, target);
  else db.prepare("INSERT INTO members (space_id, username, role, added_at) VALUES (?, ?, ?, ?) ON CONFLICT (space_id, username) DO UPDATE SET role = excluded.role").run(spaceId, target, validRole(role), now);
  /* The space appears, disappears, or allows them something new; its version moves so devices look again. */
  db.prepare("UPDATE nodes SET version = version + 1 WHERE id = (SELECT root_id FROM spaces WHERE id = ?)").run(spaceId);
  touchFor(db, spaceId, target, now);
}

/* ── folders and files ── */

function freeName(db: DatabaseSync, parentId: string, wanted: string, except?: string): string {
  const taken = (name: string) => Boolean(db.prepare("SELECT 1 FROM nodes WHERE parent_id = ? AND lower(name) = lower(?) AND trashed_at IS NULL AND id IS NOT ?").get(parentId, name, except ?? null));
  if (!taken(wanted)) return wanted;
  for (let n = 2; n < 10_000; n += 1) if (!taken(numbered(wanted, n))) return numbered(wanted, n);
  throw new DriveProblem("There are too many things with that name here.", 409);
}

/**
 * Marks a folder as a notebook, chat or project (or, with null, a plain
 * folder again). Not a person's choice in Drive: the app it belongs to sets it.
 */
export function setPurpose(db: DatabaseSync, id: string, username: string, purpose: FolderPurpose | null, ref: string | null = null, now = Date.now()): DriveNode {
  const node = nodeFor(db, id, username, "editor");
  if (node.kind !== "folder") throw new DriveProblem("Only a folder can be that.");
  if (purpose !== null && !folderPurposes.includes(purpose)) throw new DriveProblem("A folder is a notebook, a chat or a project.");
  if (node.purpose === purpose && node.ref === ref) return node;
  db.prepare("UPDATE nodes SET purpose = ?, ref = ? WHERE id = ?").run(purpose, ref, id);
  touch(db, id, node.spaceId, now);
  return toNode(nodeRow(db, id)!, "editor");
}

/** A folder's own crest and colour, or its space's again when both are null. */
export function setFolderCrest(db: DatabaseSync, id: string, username: string, crest: unknown, color: unknown, now = Date.now()): DriveNode {
  const node = nodeFor(db, id, username, "editor");
  if (node.kind !== "folder") throw new DriveProblem("Only a folder has a crest.");
  if (crest !== null && !(typeof crest === "string" && (crests as readonly string[]).includes(crest))) throw new DriveProblem("That isn't one of the crests.");
  if (color !== null && !(typeof color === "string" && (crestColours as readonly string[]).includes(color))) throw new DriveProblem("That isn't one of the colours.");
  db.prepare("UPDATE nodes SET crest = ?, color = ? WHERE id = ?").run(crest, color, id);
  touch(db, id, node.spaceId, now);
  return toNode(nodeRow(db, id)!, "editor");
}

export function createFolder(db: DatabaseSync, parentId: string, username: string, rawName: unknown, now = Date.now()): DriveNode {
  const parent = nodeFor(db, parentId, username, "editor");
  if (parent.kind !== "folder") throw new DriveProblem("You can only make a folder inside a folder.");
  const name = cleanName(rawName, "folder name");
  if (db.prepare("SELECT 1 FROM nodes WHERE parent_id = ? AND lower(name) = lower(?) AND trashed_at IS NULL").get(parentId, name)) throw new DriveProblem("Something here already has that name.", 409);
  const id = newId();
  db.prepare("INSERT INTO nodes (id, space_id, parent_id, kind, name, created_by, created_at, updated_at) VALUES (?, ?, ?, 'folder', ?, ?, ?, ?)").run(id, parent.spaceId, parentId, name, username.toLowerCase(), now, now);
  touch(db, id, parent.spaceId, now);
  return toNode(nodeRow(db, id)!, "editor");
}

/** Adds a finished upload as a file, numbering the name if it clashes. */
export function addFile(db: DatabaseSync, parentId: string, username: string, file: { name: string; size: number; mime: string | null; blob: string }, now = Date.now()): DriveNode {
  const parent = nodeFor(db, parentId, username, "editor");
  return insertFile(db, parent, username.toLowerCase(), null, file, now);
}

function insertFile(db: DatabaseSync, parent: DriveNode, createdBy: string, guest: string | null, file: { name: string; size: number; mime: string | null; blob: string }, now: number): DriveNode {
  if (parent.kind !== "folder") throw new DriveProblem("Files go inside folders.");
  const name = freeName(db, parent.id, cleanName(file.name, "file name"));
  const id = newId();
  db.prepare("INSERT INTO nodes (id, space_id, parent_id, kind, name, size, mime, blob, created_by, created_at, updated_at, guest) VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, parent.spaceId, parent.id, name, file.size, file.mime, file.blob, createdBy, now, now, guest);
  touch(db, id, parent.spaceId, now);
  return toNode(nodeRow(db, id)!, "editor");
}

function isRoot(db: DatabaseSync, node: DriveNode) {
  return node.parentId === null || Boolean(db.prepare("SELECT 1 FROM spaces WHERE root_id = ?").get(node.id));
}

export function renameNode(db: DatabaseSync, id: string, username: string, rawName: unknown, now = Date.now()): DriveNode {
  const node = nodeFor(db, id, username, "editor");
  if (isRoot(db, node)) throw new DriveProblem("Rename the space itself instead.");
  const name = cleanName(rawName);
  if (db.prepare("SELECT 1 FROM nodes WHERE parent_id = ? AND lower(name) = lower(?) AND trashed_at IS NULL AND id != ?").get(node.parentId, name, id)) throw new DriveProblem("Something here already has that name.", 409);
  db.prepare("UPDATE nodes SET name = ?, updated_at = ? WHERE id = ?").run(name, now, id);
  touch(db, id, node.spaceId, now);
  return toNode(nodeRow(db, id)!, "editor");
}

/** Moves within a space. Moving between spaces is a copy, so it isn't done here. */
export function moveNode(db: DatabaseSync, id: string, username: string, toFolderId: string, now = Date.now()): DriveNode {
  const node = nodeFor(db, id, username, "editor");
  const target = nodeFor(db, toFolderId, username, "editor");
  if (isRoot(db, node)) throw new DriveProblem("A space's top folder can't be moved.");
  if (target.kind !== "folder") throw new DriveProblem("You can only move things into a folder.");
  if (target.spaceId !== node.spaceId) throw new DriveProblem("Things can only be moved within a space.");
  for (let at: string | null = target.id; at; at = (db.prepare("SELECT parent_id FROM nodes WHERE id = ?").get(at) as { parent_id: string | null } | undefined)?.parent_id ?? null) {
    if (at === node.id) throw new DriveProblem("A folder can't go inside itself.");
  }
  const name = freeName(db, target.id, node.name, node.id);
  db.prepare("UPDATE nodes SET parent_id = ?, name = ?, updated_at = ? WHERE id = ?").run(target.id, name, now, id);
  touch(db, id, node.spaceId, now);
  return toNode(nodeRow(db, id)!, "editor");
}

/**
 * Moves a folder or file, with everything in it, into a folder of another
 * space. Only between spaces the person owns and nobody else is in, so no one
 * gains or loses sight of it; its own shares go with it.
 */
export function moveToSpace(db: DatabaseSync, id: string, username: string, toFolderId: string, now = Date.now()): DriveNode {
  const node = nodeFor(db, id, username, "owner");
  const target = nodeFor(db, toFolderId, username, "owner");
  if (target.spaceId === node.spaceId) return moveNode(db, id, username, toFolderId, now);
  if (isRoot(db, node)) throw new DriveProblem("A space's top folder can't be moved.");
  if (target.kind !== "folder") throw new DriveProblem("You can only move things into a folder.");
  const alone = (spaceId: string) => (db.prepare("SELECT count(*) AS n FROM members WHERE space_id = ?").get(spaceId) as { n: number }).n === 1;
  if (!alone(node.spaceId) || !alone(target.spaceId)) throw new DriveProblem("Things only move between spaces that are yours alone.");
  const subtree = (db.prepare(`WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT c.id FROM nodes c JOIN t ON c.parent_id = t.id) SELECT id FROM t`).all(id) as { id: string }[]).map((r) => r.id);
  const name = freeName(db, target.id, node.name, node.id);
  const tx = begin(db);
  try {
    for (const at of subtree) {
      db.prepare("UPDATE nodes SET space_id = ? WHERE id = ?").run(target.spaceId, at);
      /* Gone from the old space for its devices, there in the new one. */
      db.prepare("INSERT INTO changes (node_id, space_id, at) VALUES (?, ?, ?)").run(at, node.spaceId, now);
      touch(db, at, target.spaceId, now);
    }
    db.prepare("UPDATE nodes SET parent_id = ?, name = ?, updated_at = ? WHERE id = ?").run(target.id, name, now, id);
    tx.commit();
  } catch (error) { tx.rollback(); throw error; }
  return toNode(nodeRow(db, id)!, "owner");
}

/** Marks a space as what it is for (see SpacePurpose), or as an ordinary one. */
export function setSpacePurpose(db: DatabaseSync, spaceId: string, purpose: SpacePurpose | null) {
  db.prepare("UPDATE spaces SET purpose = ? WHERE id = ?").run(purpose, spaceId);
}

export function trashNode(db: DatabaseSync, id: string, username: string, now = Date.now()) {
  const node = nodeFor(db, id, username, "editor");
  if (isRoot(db, node)) throw new DriveProblem("A space's top folder can't be trashed.");
  if (!roleIn(db, node.spaceId, username) && sharesAbove(db, id, username).some((s) => s.nodeId === id)) throw new DriveProblem("It was shared with you. Leave it instead.", 403);
  db.prepare("UPDATE nodes SET trashed_at = ?, trashed_by = ? WHERE id = ?").run(now, username.toLowerCase(), id);
  touch(db, id, node.spaceId, now);
}

export function restoreNode(db: DatabaseSync, id: string, username: string, now = Date.now()): DriveNode {
  const node = nodeFor(db, id, username, "editor", { trashed: true });
  if (node.trashedAt === null) return node;
  /* Back where it was; if that folder is gone too, to the top of the space. */
  const parentGone = !node.parentId || inTrash(db, node.parentId);
  const parentId = parentGone ? (db.prepare("SELECT root_id FROM spaces WHERE id = ?").get(node.spaceId) as { root_id: string }).root_id : node.parentId!;
  const name = freeName(db, parentId, node.name, node.id);
  db.prepare("UPDATE nodes SET trashed_at = NULL, trashed_by = NULL, parent_id = ?, name = ?, updated_at = ? WHERE id = ?").run(parentId, name, now, id);
  touch(db, id, node.spaceId, now);
  return toNode(nodeRow(db, id)!, "editor");
}

/** Blobs of things trashed longer than [trashDays], removed from the database; the caller deletes the bytes. */
export function emptyOldTrash(db: DatabaseSync, now = Date.now()): string[] {
  const cutoff = now - trashDays * 24 * 60 * 60 * 1000;
  return purge(db, db.prepare("SELECT id FROM nodes WHERE trashed_at IS NOT NULL AND trashed_at < ?").all(cutoff) as { id: string }[]);
}

/** Empties the trash now, of every space where the person can edit; the caller deletes the bytes. */
export function emptyTrash(db: DatabaseSync, username: string): string[] {
  return purge(db, db.prepare("SELECT n.id FROM nodes n JOIN members m ON m.space_id = n.space_id AND m.username = ? WHERE n.trashed_at IS NOT NULL AND m.role IN ('owner', 'editor')").all(username.toLowerCase()) as { id: string }[]);
}

/** Trashed things and everything inside them, gone from the database; returns their blobs. */
function purge(db: DatabaseSync, roots: { id: string }[]): string[] {
  const blobs: string[] = [];
  const remove = (id: string) => {
    for (const child of db.prepare("SELECT id FROM nodes WHERE parent_id = ?").all(id) as { id: string }[]) remove(child.id);
    const row = db.prepare("SELECT blob FROM nodes WHERE id = ?").get(id) as { blob: string | null } | undefined;
    if (row?.blob) blobs.push(row.blob);
    db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
  };
  const tx = begin(db);
  try { for (const root of roots) remove(root.id); tx.commit(); } catch (error) { tx.rollback(); throw error; }
  return blobs;
}

/* ── public links ── */

/** Makes (or returns) the public link for a file. Folders aren't shared by link. */
export function linkFile(db: DatabaseSync, id: string, username: string, now = Date.now()): string {
  const node = nodeFor(db, id, username, "editor");
  if (node.kind !== "file" && node.purpose !== "notebook") throw new DriveProblem("Only files and notebooks can have a public link.");
  if (node.link) return node.link;
  const token = newId(9);
  db.prepare("INSERT INTO links (token, node_id, created_by, created_at) VALUES (?, ?, ?, ?)").run(token, id, username.toLowerCase(), now);
  touch(db, id, node.spaceId, now);
  return token;
}

export function unlinkFile(db: DatabaseSync, id: string, username: string, now = Date.now()) {
  const node = nodeFor(db, id, username, "editor", { trashed: true });
  db.prepare("UPDATE links SET revoked_at = ? WHERE node_id = ? AND revoked_at IS NULL").run(now, id);
  touch(db, id, node.spaceId, now);
}

/** What a public link points at, if it still works. No account is involved. */
export function publicFile(db: DatabaseSync, token: string): { id: string; name: string; size: number; mime: string | null; blob: string; updatedAt: number } | null {
  const row = db.prepare(`SELECT n.id, n.name, n.size, n.mime, n.blob, n.updated_at FROM links l JOIN nodes n ON n.id = l.node_id WHERE l.token = ? AND l.revoked_at IS NULL AND n.kind = 'file'`).get(token) as { id: string; name: string; size: number; mime: string | null; blob: string | null; updated_at: number } | undefined;
  if (!row?.blob || inTrash(db, row.id)) return null;
  return { id: row.id, name: row.name, size: row.size, mime: row.mime, blob: row.blob, updatedAt: row.updated_at };
}

/* ── shares: one folder or file, with people outside its space ── */

export type Share = { username: string; role: Exclude<Role, "owner">; addedBy: string; addedAt: number };
export type ShareInfo = {
  /** People it is shared with on its own. */
  shares: Share[];
  /** People who have it through a folder above it that is shared: the folder, and them. */
  inherited: (Share & { via: { id: string; name: string } })[];
  /** The space it is in, and how many are in that space (who all see it already). */
  space: { id: string; name: string; members: number };
};

const shareRole = (role: unknown): Exclude<Role, "owner"> => {
  if (role === "editor" || role === "viewer") return role;
  throw new DriveProblem("Someone it's shared with is an editor or a viewer.");
};

/**
 * Shares a folder or file with someone (role editor or viewer), changes what
 * they may do, or (null) takes them off it. Anyone who may edit it may; anyone
 * may take themselves off. Someone already in its space needs no share.
 */
export function shareNode(db: DatabaseSync, id: string, username: string, who: string, role: Exclude<Role, "owner"> | null, now = Date.now()): ShareInfo {
  const self = username.toLowerCase(), target = who.toLowerCase();
  const node = nodeFor(db, id, username, role === null && target === self ? "viewer" : "editor");
  if (role !== null) {
    shareRole(role);
    if (isRoot(db, node)) throw new DriveProblem("Add them to the space instead.");
    if (target === self) throw new DriveProblem("You already have it.");
    /* Someone in it only through a share isn't told about the space. */
    if (roleIn(db, node.spaceId, target)) throw new DriveProblem(roleIn(db, node.spaceId, self) ? `${who} is already in ${spaceName(db, node.spaceId)}.` : `${who} already has it.`, 409);
    db.prepare("INSERT INTO shares (node_id, username, role, added_by, added_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (node_id, username) DO UPDATE SET role = excluded.role")
      .run(id, target, role, self, now);
  } else {
    db.prepare("DELETE FROM shares WHERE node_id = ? AND username = ?").run(id, target);
  }
  /* It appears, disappears, or allows them something new: their devices look again. */
  db.prepare("UPDATE nodes SET version = version + 1 WHERE id = ?").run(id);
  db.prepare("INSERT INTO changes (node_id, username, at) VALUES (?, ?, ?)").run(id, target, now);
  return role === null && target === self ? { shares: [], inherited: [], space: { id: node.spaceId, name: "", members: 0 } } : sharesOn(db, id, username);
}

function spaceName(db: DatabaseSync, spaceId: string): string {
  return (db.prepare("SELECT name FROM spaces WHERE id = ?").get(spaceId) as { name: string } | undefined)?.name ?? "its space";
}

/** Who a folder or file is shared with, beyond its space. */
export function sharesOn(db: DatabaseSync, id: string, username: string): ShareInfo {
  const node = nodeFor(db, id, username);
  const rows = (nodeId: string) => (db.prepare("SELECT username, role, added_by, added_at FROM shares WHERE node_id = ? ORDER BY added_at").all(nodeId) as { username: string; role: "editor" | "viewer"; added_by: string; added_at: number }[])
    .map((r) => ({ username: r.username, role: r.role, addedBy: r.added_by, addedAt: r.added_at }));
  const inherited: ShareInfo["inherited"] = [];
  for (let at = node.parentId; at;) {
    const row = nodeRow(db, at);
    if (!row || row.parent_id === null) break;
    for (const share of rows(at)) inherited.push({ ...share, via: { id: row.id, name: row.name } });
    at = row.parent_id;
  }
  const members = (db.prepare("SELECT count(*) AS n FROM members WHERE space_id = ?").get(node.spaceId) as { n: number }).n;
  /* Someone in it only through a share sees who else has it, not who is in a space they aren't in. */
  const inSpace = Boolean(roleIn(db, node.spaceId, username));
  return { shares: rows(id), inherited, space: { id: node.spaceId, name: inSpace ? spaceName(db, node.spaceId) : "", members: inSpace ? members : 0 } };
}

/** What has been shared with the person from spaces they aren't in: the shared folders and files themselves, newest first. */
export function sharedWithYou(db: DatabaseSync, username: string): DriveNode[] {
  const who = username.toLowerCase();
  const rows = db.prepare(`SELECT ${nodeColumns}, sh.added_by AS shared_by FROM shares sh JOIN nodes n ON n.id = sh.node_id
    WHERE sh.username = ? AND n.space_id NOT IN (SELECT space_id FROM members WHERE username = ?) ORDER BY sh.added_at DESC`).all(who, who) as (NodeRow & { shared_by: string })[];
  const ids = new Set(rows.map((r) => r.id));
  return rows
    .filter((row) => !inTrash(db, row.id))
    /* One inside another shared with them comes with that one. */
    .filter((row) => !sharesAbove(db, row.parent_id ?? "", who).some((s) => ids.has(s.nodeId)))
    .map((row) => ({ ...toNode(row, roleOn(db, row.id, who)), parentId: null, sharedWithYou: true, sharedBy: row.shared_by }));
}

/** A public link to a notebook: the notebook, and every live folder and file in it. No account is involved. */
export function publicFolder(db: DatabaseSync, token: string): { folder: SharedNode; nodes: (SharedNode & { parentId: string; blob: string | null })[] } | null {
  const row = db.prepare("SELECT n.id FROM links l JOIN nodes n ON n.id = l.node_id WHERE l.token = ? AND l.revoked_at IS NULL AND n.kind = 'folder'").get(token) as { id: string } | undefined;
  if (!row || inTrash(db, row.id)) return null;
  const top = nodeRow(db, row.id)!;
  const nodes = db.prepare(`WITH RECURSIVE under(id) AS (SELECT ? UNION ALL SELECT c.id FROM nodes c JOIN under ON c.parent_id = under.id WHERE c.trashed_at IS NULL)
    SELECT n.id, n.parent_id, n.kind, n.name, n.size, n.mime, n.blob, n.updated_at FROM nodes n JOIN under ON under.id = n.id WHERE n.id != ?`).all(row.id, row.id) as { id: string; parent_id: string; kind: "folder" | "file"; name: string; size: number; mime: string | null; blob: string | null; updated_at: number }[];
  const plain = (r: { id: string; kind: "folder" | "file"; name: string; size: number; mime: string | null; updated_at: number }): SharedNode => ({ id: r.id, kind: r.kind, name: r.name, size: r.size, mime: r.mime, updatedAt: r.updated_at });
  return { folder: plain(top), nodes: nodes.map((r) => ({ ...plain(r), parentId: r.parent_id, blob: r.blob })) };
}

/* ── space links ── */

export type SharedSpace = { id: string; name: string; crest: string; color: string; rootId: string; access: LinkAccess };
/** A file or folder as a guest sees it: no usernames, no links of its own. */
export type SharedNode = { id: string; kind: "folder" | "file"; name: string; size: number; mime: string | null; updatedAt: number };

/** Opens a space to anyone with its link ("view" or "add"), or closes it (null). Owners only. */
export function setSpaceLink(db: DatabaseSync, spaceId: string, username: string, access: LinkAccess | null): string | null {
  require(db, spaceId, username, "owner");
  if (access === null) {
    db.prepare("UPDATE spaces SET link = NULL, link_access = NULL WHERE id = ?").run(spaceId);
    return null;
  }
  if (access !== "view" && access !== "add") throw new DriveProblem("A link lets people view, or view and add files.");
  const current = (db.prepare("SELECT link FROM spaces WHERE id = ?").get(spaceId) as { link: string | null }).link;
  const token = current ?? newId(12);
  db.prepare("UPDATE spaces SET link = ?, link_access = ? WHERE id = ?").run(token, access, spaceId);
  return token;
}

const linkShape = /^[A-Za-z0-9_-]{8,32}$/;

/** The space a link opens, if it still does. */
export function linkedSpace(db: DatabaseSync, token: string): SharedSpace | null {
  if (!linkShape.test(token)) return null;
  const row = db.prepare("SELECT id, name, crest, color, root_id, link_access FROM spaces WHERE link = ?").get(token) as { id: string; name: string; crest: string; color: string | null; root_id: string; link_access: LinkAccess } | undefined;
  return row ? { id: row.id, name: row.name, crest: row.crest, color: row.color || "plum", rootId: row.root_id, access: row.link_access } : null;
}

function guestSpace(db: DatabaseSync, token: string, need: LinkAccess = "view"): SharedSpace {
  const space = linkedSpace(db, token);
  if (!space) throw new DriveProblem("This link doesn't work any more.", 404);
  if (need === "add" && space.access !== "add") throw new DriveProblem("This link is for viewing only.", 403);
  return space;
}

/** A node inside the link's space, not in the trash. */
function guestNode(db: DatabaseSync, space: SharedSpace, id: string): DriveNode & { blob: string | null } {
  const row = nodeRow(db, id);
  if (!row || row.space_id !== space.id || inTrash(db, id)) throw new DriveProblem("That file or folder doesn't exist.", 404);
  return { ...toNode(row, null), blob: row.blob };
}

const shared = (node: DriveNode): SharedNode => ({ id: node.id, kind: node.kind, name: node.name, size: node.size, mime: node.mime, updatedAt: node.updatedAt });

/** A folder of a linked space, for anyone holding the link. The path starts at the space's top. */
export function sharedFolder(db: DatabaseSync, token: string, folderId?: string): { space: SharedSpace; folder: SharedNode; path: SharedNode[]; children: SharedNode[] } {
  const space = guestSpace(db, token);
  const folder = guestNode(db, space, folderId || space.rootId);
  if (folder.kind !== "folder") throw new DriveProblem("That's a file, not a folder.");
  const children = (db.prepare(`SELECT ${nodeColumns} FROM nodes n WHERE n.parent_id = ? AND n.trashed_at IS NULL ORDER BY n.kind = 'file', lower(n.name)`).all(folder.id) as NodeRow[]).map((row) => toNode(row, null));
  const path: SharedNode[] = [];
  for (let at: string | null = folder.parentId; at && path.length < 256;) {
    const row = nodeRow(db, at);
    if (!row || row.space_id !== space.id) break;
    path.unshift(shared(toNode(row, null)));
    at = row.parent_id;
  }
  return { space, folder: shared(folder), path, children: children.map(shared) };
}

/** A file of a linked space, for downloading. */
export function sharedFile(db: DatabaseSync, token: string, id: string): { name: string; size: number; blob: string } {
  const node = guestNode(db, guestSpace(db, token), id);
  if (node.kind !== "file" || !node.blob) throw new DriveProblem("That's a folder.");
  return { name: node.name, size: node.size, blob: node.blob };
}

/* ── uploads ── */

/**
 * An upload in progress. A member's belongs to them; a guest's has no owner,
 * only the link it came through, and its unguessable id is what lets the
 * guest carry on with it.
 */
export type Upload = {
  id: string; spaceId: string; parentId: string; name: string; mime: string | null; size: number; received: number; createdBy: string;
  link: string | null; guest: string | null;
  /** A file whose bytes this upload replaces, and the contentVersion it was edited from. */
  replaces: string | null; baseVersion: number | null;
};

/** Unfinished guest uploads one link may have at once, so strangers can't promise the whole disk away. */
export const guestUploadsAtOnce = 10;
/*
 * An upload holds disk for the bytes it still says are coming, so what one
 * person or one link may hold at once is capped, and so is what guests may
 * leave in a space through its link: otherwise a stranger could declare huge
 * files, send nothing, and leave everyone else with a full disk.
 */
export const reservedPerLink = 20 * 1024 ** 3;
export const reservedPerMember = 200 * 1024 ** 3;
export const guestBytesPerLink = 50 * 1024 ** 3;

/** Bytes still to arrive for one person's uploads, or one link's. */
function reservedBy(db: DatabaseSync, who: { username: string } | { link: string }): number {
  const row = "link" in who
    ? db.prepare("SELECT coalesce(sum(size - received), 0) AS n FROM uploads WHERE link = ?").get(who.link)
    : db.prepare("SELECT coalesce(sum(size - received), 0) AS n FROM uploads WHERE link IS NULL AND created_by = ?").get(who.username.toLowerCase());
  return Number((row as { n: number }).n);
}

function checkMemberRoom(db: DatabaseSync, username: string, size: number) {
  if (reservedBy(db, { username }) + size > reservedPerMember) throw new DriveProblem("You have a lot uploading already. Let some of it finish first.", 429);
}

/*
 * A space has one link at a time, and files guests add carry no account, so
 * what guests have added to the space (outside the trash) stands for what
 * its link has taken in.
 */
function checkGuestRoom(db: DatabaseSync, spaceId: string, token: string, size: number) {
  if (size > reservedPerLink) throw new DriveProblem(`Files added through a link can be up to ${Math.floor(reservedPerLink / 1024 ** 3)} GB.`, 413);
  if (reservedBy(db, { link: token }) + size > reservedPerLink) throw new DriveProblem("A lot is uploading through this link already. Try again when some finishes.", 429);
  const kept = Number((db.prepare("SELECT coalesce(sum(size), 0) AS n FROM nodes WHERE space_id = ? AND created_by = '' AND kind = 'file' AND trashed_at IS NULL").get(spaceId) as { n: number }).n);
  if (kept + reservedBy(db, { link: token }) + size > guestBytesPerLink) throw new DriveProblem("This link can't take any more files.", 507);
}

function checkFile(file: { name: unknown; size: number }, maxBytes: number): string {
  const name = cleanName(file.name, "file name");
  if (!Number.isSafeInteger(file.size) || file.size < 0) throw new DriveProblem("Say how big the file is.");
  if (file.size > maxBytes) throw new DriveProblem(`Files can be up to ${Math.floor(maxBytes / 1024 ** 3)} GB.`, 413);
  return name;
}

export function startUpload(db: DatabaseSync, parentId: string, username: string, file: { name: unknown; size: number; mime: string | null }, maxBytes: number, now = Date.now()): Upload {
  const parent = nodeFor(db, parentId, username, "editor");
  if (parent.kind !== "folder") throw new DriveProblem("Files go inside folders.");
  const name = checkFile(file, maxBytes);
  checkMemberRoom(db, username, file.size);
  const id = newId();
  db.prepare("INSERT INTO uploads (id, space_id, parent_id, name, mime, size, received, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)")
    .run(id, parent.spaceId, parentId, name, file.mime, file.size, username.toLowerCase(), now, now);
  return { id, spaceId: parent.spaceId, parentId, name, mime: file.mime, size: file.size, received: 0, createdBy: username.toLowerCase(), link: null, guest: null, replaces: null, baseVersion: null };
}

/**
 * Starts new bytes for an existing file, as when it is edited and saved in
 * another app. [baseVersion] is the contentVersion the edit started from; if
 * someone else's edit lands first, this one is kept beside it as a copy
 * rather than overwriting theirs (see finishUpload).
 */
export function startReplace(db: DatabaseSync, fileId: string, username: string, baseVersion: number, file: { size: number; mime: string | null }, maxBytes: number, now = Date.now()): Upload {
  const node = nodeFor(db, fileId, username, "editor");
  if (node.kind !== "file") throw new DriveProblem("Only a file's contents can be replaced.");
  if (!Number.isSafeInteger(baseVersion) || baseVersion < 1) throw new DriveProblem("Say which version the edit started from.");
  checkFile({ name: node.name, size: file.size }, maxBytes);
  checkMemberRoom(db, username, file.size);
  const id = newId();
  db.prepare("INSERT INTO uploads (id, space_id, parent_id, name, mime, size, received, created_by, created_at, updated_at, replaces, base_version) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)")
    .run(id, node.spaceId, node.parentId, node.name, file.mime, file.size, username.toLowerCase(), now, now, fileId, baseVersion);
  return { id, spaceId: node.spaceId, parentId: node.parentId!, name: node.name, mime: file.mime, size: file.size, received: 0, createdBy: username.toLowerCase(), link: null, guest: null, replaces: fileId, baseVersion };
}

/** "report.docx" → "report (edited elsewhere).docx", the name a losing edit is kept under. */
export const conflictName = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (edited elsewhere)${name.slice(dot)}` : `${name} (edited elsewhere)`;
};

/** Starts an upload through a space's link, by someone without an account. [guest] is the name they give, if any. */
export function startGuestUpload(db: DatabaseSync, token: string, folderId: string | undefined, guest: unknown, file: { name: unknown; size: number; mime: string | null }, maxBytes: number, now = Date.now()): Upload {
  const space = guestSpace(db, token, "add");
  const parent = guestNode(db, space, folderId || space.rootId);
  if (parent.kind !== "folder") throw new DriveProblem("Files go inside folders.");
  const name = checkFile(file, maxBytes);
  const who = guestName(guest);
  const open = (db.prepare("SELECT count(*) AS n FROM uploads WHERE link = ?").get(token) as { n: number }).n;
  if (open >= guestUploadsAtOnce) throw new DriveProblem("Too many uploads are going through this link at once. Try again when some finish.", 429);
  checkGuestRoom(db, space.id, token, file.size);
  const id = newId();
  db.prepare("INSERT INTO uploads (id, space_id, parent_id, name, mime, size, received, created_by, created_at, updated_at, link, guest) VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?)")
    .run(id, space.id, parent.id, name, file.mime, file.size, now, now, token, who);
  return { id, spaceId: space.id, parentId: parent.id, name, mime: file.mime, size: file.size, received: 0, createdBy: "", link: token, guest: who, replaces: null, baseVersion: null };
}

function guestName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name) return null;
  if ([...name].length > 60) throw new DriveProblem("That name is too long.");
  return name;
}

/**
 * An upload in progress: a member's only for them (username), a guest's for
 * whoever holds its id (username null) while its link still lets people add.
 */
export function uploadFor(db: DatabaseSync, id: string, username: string | null): Upload {
  const row = db.prepare("SELECT id, space_id, parent_id, name, mime, size, received, created_by, link, guest, replaces, base_version FROM uploads WHERE id = ?").get(id) as { id: string; space_id: string; parent_id: string; name: string; mime: string | null; size: number; received: number; created_by: string; link: string | null; guest: string | null; replaces: string | null; base_version: number | null } | undefined;
  const missing = new DriveProblem("That upload doesn't exist.", 404);
  if (!row) throw missing;
  if (row.link) {
    const space = linkedSpace(db, row.link);
    if (!space || space.id !== row.space_id || space.access !== "add") throw missing;
  } else if (!username || row.created_by !== username.toLowerCase()) throw missing;
  return { id: row.id, spaceId: row.space_id, parentId: row.parent_id, name: row.name, mime: row.mime, size: row.size, received: row.received, createdBy: row.created_by, link: row.link, guest: row.guest, replaces: row.replaces, baseVersion: row.base_version };
}

/** Puts a finished upload in its folder, as its member or as the guest. */
export function finishUpload(db: DatabaseSync, upload: Upload, blob: string, now = Date.now()): { node: DriveNode; conflict: boolean; oldBlob: string | null } {
  const tx = begin(db);
  try {
    let node: DriveNode, conflict = false, oldBlob: string | null = null;
    const file = { name: upload.name, size: upload.size, mime: upload.mime, blob };
    /* Access can change over the days an upload takes: whoever started it must still be allowed to add, or to overwrite. */
    if (upload.link) {
      if (guestSpace(db, upload.link, "add").id !== upload.spaceId) throw new DriveProblem("This link doesn't work any more.", 404);
    } else {
      const at = upload.replaces ?? upload.parentId;
      const role = roleOn(db, at, upload.createdBy);
      if (!role) throw new DriveProblem("That space doesn't exist, or you're not in it.", 404);
      if (rank[role] < rank.editor) throw new DriveProblem("You can only view this.", 403);
    }
    if (upload.replaces) {
      const target = nodeRow(db, upload.replaces);
      const live = target && target.space_id === upload.spaceId && !inTrash(db, target.id);
      if (live && target.content_version === upload.baseVersion) {
        db.prepare("UPDATE nodes SET blob = ?, size = ?, mime = ?, content_version = content_version + 1, updated_at = ?, updated_by = ? WHERE id = ?").run(blob, upload.size, upload.mime, now, upload.guest ? `guest:${upload.guest}` : upload.createdBy, target.id);
        touch(db, target.id, target.space_id, now);
        oldBlob = target.blob;
        node = toNode(nodeRow(db, target.id)!, "editor");
      } else {
        /* Someone else's edit landed first, or the file went: keep this one beside it, never over it. */
        conflict = true;
        const folder = live ? target.parent_id! : upload.parentId;
        const parentOk = nodeRow(db, folder) && !inTrash(db, folder);
        const parentId = parentOk ? folder : (db.prepare("SELECT root_id FROM spaces WHERE id = ?").get(upload.spaceId) as { root_id: string }).root_id;
        node = addFile(db, parentId, upload.createdBy, { ...file, name: live ? conflictName(upload.name) : upload.name }, now);
      }
    } else if (upload.link) {
      const space = guestSpace(db, upload.link, "add");
      if (space.id !== upload.spaceId) throw new DriveProblem("This link doesn't work any more.", 404);
      node = insertFile(db, guestNode(db, space, upload.parentId), "", upload.guest, file, now);
    } else {
      node = addFile(db, upload.parentId, upload.createdBy, file, now);
    }
    endUpload(db, upload.id);
    tx.commit();
    return { node, conflict, oldBlob };
  } catch (error) { tx.rollback(); throw error; }
}

export function recordReceived(db: DatabaseSync, id: string, received: number, now = Date.now()) {
  db.prepare("UPDATE uploads SET received = ?, updated_at = ? WHERE id = ?").run(received, now, id);
}

/** Bytes still to arrive for every unfinished upload: disk space already promised. */
export function promisedBytes(db: DatabaseSync): number {
  return Number((db.prepare("SELECT coalesce(sum(size - received), 0) AS n FROM uploads").get() as { n: number }).n);
}

/*
 * An upload that never receives a byte is let go after an hour, and one that
 * stops after a day, so declared sizes can't hold disk for long. A big file
 * still takes days, as long as bytes keep arriving.
 */
export const uploadUnstartedHours = 1;
export const uploadIdleHours = 24;

export function endUpload(db: DatabaseSync, id: string) {
  db.prepare("DELETE FROM uploads WHERE id = ?").run(id);
}

/** Uploads that never started or went quiet (see [uploadIdleHours]), or whose link closed; the caller deletes their partial bytes. */
export function staleUploads(db: DatabaseSync, now = Date.now()): string[] {
  const hour = 60 * 60 * 1000;
  const unstarted = now - uploadUnstartedHours * hour, idle = now - uploadIdleHours * hour;
  /* Guests' uploads also end when their link closes or stops letting people add. */
  const stale = "(received = 0 AND updated_at < ?) OR updated_at < ? OR (link IS NOT NULL AND link NOT IN (SELECT link FROM spaces WHERE link IS NOT NULL AND link_access = 'add'))";
  const rows = db.prepare(`SELECT id FROM uploads WHERE ${stale}`).all(unstarted, idle) as { id: string }[];
  db.prepare(`DELETE FROM uploads WHERE ${stale}`).run(unstarted, idle);
  return rows.map((r) => r.id);
}

/**
 * Turns a folder into a space of its own, contents and public links included.
 * Only an owner of the space it is in may; they own the new space, with the
 * members they name. Nobody else from the old space keeps access to it.
 */
export function folderToSpace(db: DatabaseSync, folderId: string, username: string, input: { crest?: unknown; members?: { username: string; role: Role }[] }, now = Date.now()): Space {
  const folder = nodeFor(db, folderId, username, "owner");
  if (folder.kind !== "folder") throw new DriveProblem("Only a folder can become a space.");
  if (isRoot(db, folder)) throw new DriveProblem("That is already a space.");
  const crest = typeof input.crest === "string" && (crests as readonly string[]).includes(input.crest) ? input.crest : "sakura";
  const owner = username.toLowerCase();
  const id = newId();
  const tx = begin(db);
  try {
    db.prepare("INSERT INTO spaces (id, name, crest, root_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, folder.name, crest, folder.id, owner, now);
    db.prepare(`
      WITH RECURSIVE tree(id) AS (SELECT ? UNION ALL SELECT n.id FROM nodes n JOIN tree t ON n.parent_id = t.id)
      UPDATE nodes SET space_id = ? WHERE id IN (SELECT id FROM tree)
    `).run(folder.id, id);
    db.prepare("UPDATE nodes SET parent_id = NULL, updated_at = ? WHERE id = ?").run(now, folder.id);
    /* Gone for the old space's members; a new space for the new one's (whose log rows follow). */
    touch(db, folder.id, folder.spaceId, now);
    db.prepare("INSERT INTO members (space_id, username, role, added_at) VALUES (?, ?, 'owner', ?)").run(id, owner, now);
    for (const member of input.members ?? []) {
      const who = member.username.toLowerCase();
      if (who !== owner) db.prepare("INSERT OR REPLACE INTO members (space_id, username, role, added_at) VALUES (?, ?, ?, ?)").run(id, who, validRole(member.role), now);
    }
    touch(db, folder.id, id, now);
    tx.commit();
  } catch (error) { tx.rollback(); throw error; }
  return spacesOf(db, owner).find((s) => s.id === id)!;
}
