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
 */
import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

export type Role = "owner" | "editor" | "viewer";
export type LinkAccess = "view" | "add";
export type Space = {
  id: string; name: string; crest: string; rootId: string; createdBy: string; createdAt: number; role: Role; members: number;
  link: string | null; linkAccess: LinkAccess | null;
};
export type Member = { username: string; role: Role; addedAt: number };
export type DriveNode = {
  id: string; spaceId: string; parentId: string | null; kind: "folder" | "file"; name: string;
  size: number; mime: string | null; createdBy: string; createdAt: number; updatedAt: number;
  trashedAt: number | null; link: string | null;
  /** The name a guest gave when adding this through the space's link (createdBy is then ""). */
  guest: string | null;
};

/** A refusal a person can read. Routes turn it into a 4xx with this sentence. */
export class DriveProblem extends Error {
  readonly status: 400 | 403 | 404 | 409 | 413 | 429 | 507;
  constructor(message: string, status: 400 | 403 | 404 | 409 | 413 | 429 | 507 = 400) {
    super(message);
    this.status = status;
  }
}

export const crests = ["sakura", "ume", "kikyo", "kiku", "hanabishi", "nadeshiko", "aoi"] as const;
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
  mime: string | null; blob: string | null; created_by: string; created_at: number; updated_at: number;
  trashed_at: number | null; link: string | null; guest: string | null;
};

const nodeColumns = `n.id, n.space_id, n.parent_id, n.kind, n.name, n.size, n.mime, n.blob, n.created_by, n.created_at, n.updated_at, n.trashed_at, n.guest,
  (SELECT token FROM links l WHERE l.node_id = n.id AND l.revoked_at IS NULL ORDER BY l.created_at DESC LIMIT 1) AS link`;

const toNode = (row: NodeRow): DriveNode => ({
  id: row.id, spaceId: row.space_id, parentId: row.parent_id, kind: row.kind, name: row.name, size: row.size,
  mime: row.mime, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  trashedAt: row.trashed_at, link: row.link, guest: row.guest,
});

function nodeRow(db: DatabaseSync, id: string): (NodeRow & { blob: string | null }) | undefined {
  return db.prepare(`SELECT ${nodeColumns} FROM nodes n WHERE n.id = ?`).get(id) as (NodeRow & { blob: string | null }) | undefined;
}

export function roleIn(db: DatabaseSync, spaceId: string, username: string): Role | null {
  const row = db.prepare("SELECT role FROM members WHERE space_id = ? AND username = ?").get(spaceId, username.toLowerCase()) as { role?: Role } | undefined;
  return row?.role ?? null;
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
  require(db, row.space_id, username, need);
  if (!trashed && inTrash(db, id)) throw new DriveProblem("That's in the trash.", 404);
  return { ...toNode(row), blob: row.blob };
}

export function spacesOf(db: DatabaseSync, username: string): Space[] {
  const rows = db.prepare(`
    SELECT s.id, s.name, s.crest, s.root_id, s.created_by, s.created_at, s.link, s.link_access, m.role,
      (SELECT count(*) FROM members x WHERE x.space_id = s.id) AS members
    FROM spaces s JOIN members m ON m.space_id = s.id AND m.username = ?
    ORDER BY lower(s.name)
  `).all(username.toLowerCase()) as { id: string; name: string; crest: string; root_id: string; created_by: string; created_at: number; link: string | null; link_access: LinkAccess | null; role: Role; members: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, crest: r.crest, rootId: r.root_id, createdBy: r.created_by, createdAt: r.created_at, role: r.role, members: r.members, link: r.link, linkAccess: r.link_access }));
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
  const children = (db.prepare(`SELECT ${nodeColumns} FROM nodes n WHERE n.parent_id = ? AND n.trashed_at IS NULL ORDER BY n.kind = 'file', lower(n.name)`).all(folderId) as NodeRow[]).map(toNode);
  const path: DriveNode[] = [];
  for (let at: string | null = folder.parentId; at && path.length < 256;) {
    const row = nodeRow(db, at);
    if (!row) break;
    path.unshift(toNode(row));
    at = row.parent_id;
  }
  return { folder: withoutBlob(folder), path, children };
}

/** Everything in the person's spaces that is in the trash, newest first. */
export function trashOf(db: DatabaseSync, username: string): DriveNode[] {
  return (db.prepare(`SELECT ${nodeColumns} FROM nodes n JOIN members m ON m.space_id = n.space_id AND m.username = ? WHERE n.trashed_at IS NOT NULL ORDER BY n.trashed_at DESC LIMIT 500`).all(username.toLowerCase()) as NodeRow[]).map(toNode);
}

/* ── spaces and members ── */

export function createSpace(db: DatabaseSync, username: string, input: { name: unknown; crest?: unknown; members?: { username: string; role: Role }[] }, now = Date.now()): Space {
  const name = cleanName(input.name, "space name");
  const crest = typeof input.crest === "string" && (crests as readonly string[]).includes(input.crest) ? input.crest : "sakura";
  const owner = username.toLowerCase();
  const id = newId(), rootId = newId();
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO spaces (id, name, crest, root_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, name, crest, rootId, owner, now);
    db.prepare("INSERT INTO nodes (id, space_id, parent_id, kind, name, created_by, created_at, updated_at) VALUES (?, ?, NULL, 'folder', ?, ?, ?, ?)").run(rootId, id, name, owner, now, now);
    db.prepare("INSERT INTO members (space_id, username, role, added_at) VALUES (?, ?, 'owner', ?)").run(id, owner, now);
    for (const member of input.members ?? []) {
      const who = member.username.toLowerCase();
      if (who === owner) continue;
      db.prepare("INSERT OR REPLACE INTO members (space_id, username, role, added_at) VALUES (?, ?, ?, ?)").run(id, who, validRole(member.role), now);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return spacesOf(db, owner).find((s) => s.id === id)!;
}

function validRole(role: unknown): Role {
  if (role === "owner" || role === "editor" || role === "viewer") return role;
  throw new DriveProblem("A member is an owner, an editor or a viewer.");
}

export function renameSpace(db: DatabaseSync, spaceId: string, username: string, input: { name?: unknown; crest?: unknown }) {
  require(db, spaceId, username, "owner");
  if (input.name !== undefined) {
    const name = cleanName(input.name, "space name");
    db.prepare("UPDATE spaces SET name = ? WHERE id = ?").run(name, spaceId);
    db.prepare("UPDATE nodes SET name = ? WHERE id = (SELECT root_id FROM spaces WHERE id = ?)").run(name, spaceId);
  }
  if (input.crest !== undefined) {
    if (typeof input.crest !== "string" || !(crests as readonly string[]).includes(input.crest)) throw new DriveProblem("Pick one of the crests.");
    db.prepare("UPDATE spaces SET crest = ? WHERE id = ?").run(input.crest, spaceId);
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
}

/* ── folders and files ── */

function freeName(db: DatabaseSync, parentId: string, wanted: string, except?: string): string {
  const taken = (name: string) => Boolean(db.prepare("SELECT 1 FROM nodes WHERE parent_id = ? AND lower(name) = lower(?) AND trashed_at IS NULL AND id IS NOT ?").get(parentId, name, except ?? null));
  if (!taken(wanted)) return wanted;
  for (let n = 2; n < 10_000; n += 1) if (!taken(numbered(wanted, n))) return numbered(wanted, n);
  throw new DriveProblem("There are too many things with that name here.", 409);
}

export function createFolder(db: DatabaseSync, parentId: string, username: string, rawName: unknown, now = Date.now()): DriveNode {
  const parent = nodeFor(db, parentId, username, "editor");
  if (parent.kind !== "folder") throw new DriveProblem("You can only make a folder inside a folder.");
  const name = cleanName(rawName, "folder name");
  if (db.prepare("SELECT 1 FROM nodes WHERE parent_id = ? AND lower(name) = lower(?) AND trashed_at IS NULL").get(parentId, name)) throw new DriveProblem("Something here already has that name.", 409);
  const id = newId();
  db.prepare("INSERT INTO nodes (id, space_id, parent_id, kind, name, created_by, created_at, updated_at) VALUES (?, ?, ?, 'folder', ?, ?, ?, ?)").run(id, parent.spaceId, parentId, name, username.toLowerCase(), now, now);
  return toNode(nodeRow(db, id)!);
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
  return toNode(nodeRow(db, id)!);
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
  return toNode(nodeRow(db, id)!);
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
  return toNode(nodeRow(db, id)!);
}

export function trashNode(db: DatabaseSync, id: string, username: string, now = Date.now()) {
  const node = nodeFor(db, id, username, "editor");
  if (isRoot(db, node)) throw new DriveProblem("A space's top folder can't be trashed.");
  db.prepare("UPDATE nodes SET trashed_at = ?, trashed_by = ? WHERE id = ?").run(now, username.toLowerCase(), id);
}

export function restoreNode(db: DatabaseSync, id: string, username: string, now = Date.now()): DriveNode {
  const node = nodeFor(db, id, username, "editor", { trashed: true });
  if (node.trashedAt === null) return node;
  /* Back where it was; if that folder is gone too, to the top of the space. */
  const parentGone = !node.parentId || inTrash(db, node.parentId);
  const parentId = parentGone ? (db.prepare("SELECT root_id FROM spaces WHERE id = ?").get(node.spaceId) as { root_id: string }).root_id : node.parentId!;
  const name = freeName(db, parentId, node.name, node.id);
  db.prepare("UPDATE nodes SET trashed_at = NULL, trashed_by = NULL, parent_id = ?, name = ?, updated_at = ? WHERE id = ?").run(parentId, name, now, id);
  return toNode(nodeRow(db, id)!);
}

/** Blobs of things trashed longer than [trashDays], removed from the database; the caller deletes the bytes. */
export function emptyOldTrash(db: DatabaseSync, now = Date.now()): string[] {
  const cutoff = now - trashDays * 24 * 60 * 60 * 1000;
  const roots = db.prepare("SELECT id FROM nodes WHERE trashed_at IS NOT NULL AND trashed_at < ?").all(cutoff) as { id: string }[];
  const blobs: string[] = [];
  const remove = (id: string) => {
    for (const child of db.prepare("SELECT id FROM nodes WHERE parent_id = ?").all(id) as { id: string }[]) remove(child.id);
    const row = db.prepare("SELECT blob FROM nodes WHERE id = ?").get(id) as { blob: string | null } | undefined;
    if (row?.blob) blobs.push(row.blob);
    db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
  };
  db.exec("BEGIN");
  try { for (const root of roots) remove(root.id); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; }
  return blobs;
}

/* ── public links ── */

/** Makes (or returns) the public link for a file. Folders aren't shared by link. */
export function linkFile(db: DatabaseSync, id: string, username: string, now = Date.now()): string {
  const node = nodeFor(db, id, username, "editor");
  if (node.kind !== "file") throw new DriveProblem("Only files can have a public link.");
  if (node.link) return node.link;
  const token = newId(9);
  db.prepare("INSERT INTO links (token, node_id, created_by, created_at) VALUES (?, ?, ?, ?)").run(token, id, username.toLowerCase(), now);
  return token;
}

export function unlinkFile(db: DatabaseSync, id: string, username: string, now = Date.now()) {
  nodeFor(db, id, username, "editor", { trashed: true });
  db.prepare("UPDATE links SET revoked_at = ? WHERE node_id = ? AND revoked_at IS NULL").run(now, id);
}

/** What a public link points at, if it still works. No account is involved. */
export function publicFile(db: DatabaseSync, token: string): { id: string; name: string; size: number; mime: string | null; blob: string; updatedAt: number } | null {
  const row = db.prepare(`SELECT n.id, n.name, n.size, n.mime, n.blob, n.updated_at FROM links l JOIN nodes n ON n.id = l.node_id WHERE l.token = ? AND l.revoked_at IS NULL AND n.kind = 'file'`).get(token) as { id: string; name: string; size: number; mime: string | null; blob: string | null; updated_at: number } | undefined;
  if (!row?.blob || inTrash(db, row.id)) return null;
  return { id: row.id, name: row.name, size: row.size, mime: row.mime, blob: row.blob, updatedAt: row.updated_at };
}

/* ── space links ── */

export type SharedSpace = { id: string; name: string; crest: string; rootId: string; access: LinkAccess };
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
  const row = db.prepare("SELECT id, name, crest, root_id, link_access FROM spaces WHERE link = ?").get(token) as { id: string; name: string; crest: string; root_id: string; link_access: LinkAccess } | undefined;
  return row ? { id: row.id, name: row.name, crest: row.crest, rootId: row.root_id, access: row.link_access } : null;
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
  return { ...toNode(row), blob: row.blob };
}

const shared = (node: DriveNode): SharedNode => ({ id: node.id, kind: node.kind, name: node.name, size: node.size, mime: node.mime, updatedAt: node.updatedAt });

/** A folder of a linked space, for anyone holding the link. The path starts at the space's top. */
export function sharedFolder(db: DatabaseSync, token: string, folderId?: string): { space: SharedSpace; folder: SharedNode; path: SharedNode[]; children: SharedNode[] } {
  const space = guestSpace(db, token);
  const folder = guestNode(db, space, folderId || space.rootId);
  if (folder.kind !== "folder") throw new DriveProblem("That's a file, not a folder.");
  const children = (db.prepare(`SELECT ${nodeColumns} FROM nodes n WHERE n.parent_id = ? AND n.trashed_at IS NULL ORDER BY n.kind = 'file', lower(n.name)`).all(folder.id) as NodeRow[]).map(toNode);
  const path: SharedNode[] = [];
  for (let at: string | null = folder.parentId; at && path.length < 256;) {
    const row = nodeRow(db, at);
    if (!row || row.space_id !== space.id) break;
    path.unshift(shared(toNode(row)));
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
export type Upload = { id: string; spaceId: string; parentId: string; name: string; mime: string | null; size: number; received: number; createdBy: string; link: string | null; guest: string | null };

/** Unfinished guest uploads one link may have at once, so strangers can't promise the whole disk away. */
export const guestUploadsAtOnce = 10;

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
  const id = newId();
  db.prepare("INSERT INTO uploads (id, space_id, parent_id, name, mime, size, received, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)")
    .run(id, parent.spaceId, parentId, name, file.mime, file.size, username.toLowerCase(), now, now);
  return { id, spaceId: parent.spaceId, parentId, name, mime: file.mime, size: file.size, received: 0, createdBy: username.toLowerCase(), link: null, guest: null };
}

/** Starts an upload through a space's link, by someone without an account. [guest] is the name they give, if any. */
export function startGuestUpload(db: DatabaseSync, token: string, folderId: string | undefined, guest: unknown, file: { name: unknown; size: number; mime: string | null }, maxBytes: number, now = Date.now()): Upload {
  const space = guestSpace(db, token, "add");
  const parent = guestNode(db, space, folderId || space.rootId);
  if (parent.kind !== "folder") throw new DriveProblem("Files go inside folders.");
  const name = checkFile(file, maxBytes);
  const who = guestName(guest);
  const open = (db.prepare("SELECT count(*) AS n FROM uploads WHERE link = ?").get(token) as { n: number }).n;
  if (open >= guestUploadsAtOnce) throw new DriveProblem("Too many uploads are going through this link at once. Try again when some finish.", 429);
  const id = newId();
  db.prepare("INSERT INTO uploads (id, space_id, parent_id, name, mime, size, received, created_by, created_at, updated_at, link, guest) VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?)")
    .run(id, space.id, parent.id, name, file.mime, file.size, now, now, token, who);
  return { id, spaceId: space.id, parentId: parent.id, name, mime: file.mime, size: file.size, received: 0, createdBy: "", link: token, guest: who };
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
  const row = db.prepare("SELECT id, space_id, parent_id, name, mime, size, received, created_by, link, guest FROM uploads WHERE id = ?").get(id) as { id: string; space_id: string; parent_id: string; name: string; mime: string | null; size: number; received: number; created_by: string; link: string | null; guest: string | null } | undefined;
  const missing = new DriveProblem("That upload doesn't exist.", 404);
  if (!row) throw missing;
  if (row.link) {
    const space = linkedSpace(db, row.link);
    if (!space || space.id !== row.space_id || space.access !== "add") throw missing;
  } else if (!username || row.created_by !== username.toLowerCase()) throw missing;
  return { id: row.id, spaceId: row.space_id, parentId: row.parent_id, name: row.name, mime: row.mime, size: row.size, received: row.received, createdBy: row.created_by, link: row.link, guest: row.guest };
}

/** Puts a finished upload in its folder, as its member or as the guest. */
export function finishUpload(db: DatabaseSync, upload: Upload, blob: string, now = Date.now()): DriveNode {
  db.exec("BEGIN");
  try {
    let node: DriveNode;
    if (upload.link) {
      const space = guestSpace(db, upload.link, "add");
      if (space.id !== upload.spaceId) throw new DriveProblem("This link doesn't work any more.", 404);
      node = insertFile(db, guestNode(db, space, upload.parentId), "", upload.guest, { name: upload.name, size: upload.size, mime: upload.mime, blob }, now);
    } else {
      node = addFile(db, upload.parentId, upload.createdBy, { name: upload.name, size: upload.size, mime: upload.mime, blob }, now);
    }
    endUpload(db, upload.id);
    db.exec("COMMIT");
    return node;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function recordReceived(db: DatabaseSync, id: string, received: number, now = Date.now()) {
  db.prepare("UPDATE uploads SET received = ?, updated_at = ? WHERE id = ?").run(received, now, id);
}

/** Bytes still to arrive for every unfinished upload: disk space already promised. */
export function promisedBytes(db: DatabaseSync): number {
  return Number((db.prepare("SELECT coalesce(sum(size - received), 0) AS n FROM uploads").get() as { n: number }).n);
}

/** How long an upload may go without receiving anything before it is thrown away. */
export const uploadIdleDays = 7;

export function endUpload(db: DatabaseSync, id: string) {
  db.prepare("DELETE FROM uploads WHERE id = ?").run(id);
}

/** Uploads that received nothing for [uploadIdleDays], or whose link closed; the caller deletes their partial bytes. */
export function staleUploads(db: DatabaseSync, now = Date.now()): string[] {
  const cutoff = now - uploadIdleDays * 24 * 60 * 60 * 1000;
  /* Guests' uploads also end when their link closes or stops letting people add. */
  const stale = "updated_at < ? OR (link IS NOT NULL AND link NOT IN (SELECT link FROM spaces WHERE link IS NOT NULL AND link_access = 'add'))";
  const rows = db.prepare(`SELECT id FROM uploads WHERE ${stale}`).all(cutoff) as { id: string }[];
  db.prepare(`DELETE FROM uploads WHERE ${stale}`).run(cutoff);
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
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO spaces (id, name, crest, root_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, folder.name, crest, folder.id, owner, now);
    db.prepare(`
      WITH RECURSIVE tree(id) AS (SELECT ? UNION ALL SELECT n.id FROM nodes n JOIN tree t ON n.parent_id = t.id)
      UPDATE nodes SET space_id = ? WHERE id IN (SELECT id FROM tree)
    `).run(folder.id, id);
    db.prepare("UPDATE nodes SET parent_id = NULL, updated_at = ? WHERE id = ?").run(now, folder.id);
    db.prepare("INSERT INTO members (space_id, username, role, added_at) VALUES (?, ?, 'owner', ?)").run(id, owner, now);
    for (const member of input.members ?? []) {
      const who = member.username.toLowerCase();
      if (who !== owner) db.prepare("INSERT OR REPLACE INTO members (space_id, username, role, added_at) VALUES (?, ?, ?, ?)").run(id, who, validRole(member.role), now);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return spacesOf(db, owner).find((s) => s.id === id)!;
}
