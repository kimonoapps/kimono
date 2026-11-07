import "server-only";

import { bounded } from "./bounded";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { childrenOf, db as driveDb, DriveProblem, nodeFor, roleIn, spacesOf, trashNode, type DriveNode } from "../drive";
import {
  accessNote, coveringGrant, filesRoot, needOn, openedDir, readOnly, segment,
  type Grant, type Need,
} from "./access-plan";
import type { CodeConfig } from "./config";
import { addToDrive, codeSpaceOf, driveBytes, replaceInDrive } from "./drive";
import { CodeProblem, newId, type Workspace } from "./model";
import { sandbox } from "./node";
import { planSync, type SyncAction } from "./sync";

/*
 * Asking for a person's Drive (docs/kimono-ai.md, "Your files, and asking").
 * The agent asks with kimono-access; the person answers in the chat. Only what
 * Portal copies into the sandbox is ever there, so the sandbox can't widen its
 * own reach. Everything goes through Drive's own model: versions, the trash
 * and the change feed all apply.
 */

const sha1 = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex");
const maxFiles = 5000;
const maxBytes = 50 * 1024 * 1024;

/* ── reading Drive ── */

/** A node and every folder above it, nearest first. */
function chainOf(nodeId: string): string[] {
  const chain: string[] = [];
  for (let at: string | null = nodeId; at && chain.length < 256;) {
    chain.push(at);
    const row = driveDb().prepare("SELECT parent_id FROM nodes WHERE id = ?").get(at) as { parent_id: string | null } | undefined;
    at = row?.parent_id ?? null;
  }
  return chain;
}

/** The names from below a space's root down to a node. */
function namesBelowRoot(nodeId: string): string[] {
  const names: string[] = [];
  for (const id of chainOf(nodeId)) {
    const row = driveDb().prepare("SELECT name, parent_id FROM nodes WHERE id = ?").get(id) as { name: string; parent_id: string | null } | undefined;
    if (!row || row.parent_id === null) break;
    names.unshift(row.name);
  }
  return names;
}

/** What the agent named, found in the person's Drive: a space, then a path in it by names. */
export function resolve(username: string, spaceName: string, path: string): { spaceId: string; spaceName: string; node: DriveNode } | null {
  const want = spaceName.trim().toLowerCase();
  const space = spacesOf(driveDb(), username).find((s) => s.name.trim().toLowerCase() === want);
  if (!space) return null;
  let node: DriveNode = nodeFor(driveDb(), space.rootId, username);
  for (const part of path.split("/").map((p) => p.trim()).filter(Boolean)) {
    if (node.kind !== "folder") return null;
    const next = childrenOf(driveDb(), node.id, username).children.find((c) => c.name.toLowerCase() === part.toLowerCase());
    if (!next) return null;
    node = next;
  }
  return { spaceId: space.id, spaceName: space.name, node };
}

/** Every file in an opened node, by its path below it (a file is its own one entry). */
function filesUnder(node: DriveNode, owner: string): { path: string; nodeId: string; contentVersion: number }[] {
  if (node.kind === "file") return node.size <= maxBytes ? [{ path: node.name, nodeId: node.id, contentVersion: node.contentVersion }] : [];
  const out: { path: string; nodeId: string; contentVersion: number }[] = [];
  const walk = (id: string, prefix: string, depth: number) => {
    if (depth > 32 || out.length >= maxFiles) return;
    for (const child of childrenOf(driveDb(), id, owner).children) {
      const path = `${prefix}${child.name}`;
      if (child.kind === "folder") walk(child.id, `${path}/`, depth + 1);
      else if (child.size <= maxBytes && out.length < maxFiles) out.push({ path, nodeId: child.id, contentVersion: child.contentVersion });
    }
  };
  walk(node.id, "", 0);
  return out;
}

/* ── the stored side ── */

type Opened = { workspace_id: string; node_id: string; space_id: string; dir: string };
type Request = { id: string; workspace_id: string; space_name: string; path: string; need: Need; why: string; space_id: string | null; node_id: string | null; state: string };

function grantsOf(db: DatabaseSync, username: string): Grant[] {
  return (db.prepare("SELECT id, username, workspace_id, space_id, node_id, need FROM grants WHERE username = ?").all(username) as { id: string; username: string; workspace_id: string | null; space_id: string; node_id: string; need: Need }[])
    .map((g) => ({ id: g.id, username: g.username, workspaceId: g.workspace_id, spaceId: g.space_id, nodeId: g.node_id, need: g.need }));
}

function addGrant(db: DatabaseSync, username: string, workspaceId: string | null, spaceId: string, nodeId: string, need: Need) {
  const existing = grantsOf(db, username).find((g) => g.workspaceId === workspaceId && g.nodeId === nodeId);
  if (existing) {
    if (existing.need !== "change" && need === "change") db.prepare("UPDATE grants SET need = 'change' WHERE id = ?").run(existing.id);
    return existing.id;
  }
  const id = newId();
  db.prepare("INSERT INTO grants (id, username, workspace_id, space_id, node_id, need, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, username, workspaceId, spaceId, nodeId, need, Date.now());
  return id;
}

/** The strongest the person themself may do in a space: an agent never reaches past its person. */
function ceiling(spaceId: string, username: string): Need | null {
  const role = roleIn(driveDb(), spaceId, username);
  return !role ? null : role === "viewer" ? "read" : "change";
}

/* ── the sandbox side ── */

/** Puts a node in the chat's /files and brings its files in. Nothing new if a folder above is already open. */
async function open(db: DatabaseSync, config: CodeConfig, workspace: Workspace, spaceName: string, node: DriveNode) {
  const opened = db.prepare("SELECT node_id FROM opened WHERE workspace_id = ?").all(workspace.id) as { node_id: string }[];
  const chain = chainOf(node.id);
  if (opened.some((o) => chain.includes(o.node_id))) return syncOpened(db, config, workspace);
  /* Opening a folder takes in anything opened below it: same paths, one owner. */
  for (const o of opened) if (chainOf(o.node_id).includes(node.id)) db.prepare("DELETE FROM opened WHERE workspace_id = ? AND node_id = ?").run(workspace.id, o.node_id);
  const below = namesBelowRoot(node.id);
  const dir = openedDir(spaceName, node.kind === "file" ? below.slice(0, -1) : below);
  db.prepare("INSERT OR REPLACE INTO opened (workspace_id, node_id, space_id, dir) VALUES (?, ?, ?, ?)").run(workspace.id, node.id, node.spaceId, dir);
  return syncOpened(db, config, workspace);
}

function rowsIn(db: DatabaseSync, workspaceId: string, dir: string, only?: string) {
  const rows = db.prepare("SELECT path, node_id, sha1, content_version FROM opened_files WHERE workspace_id = ? AND path LIKE ? ESCAPE '\\'").all(workspaceId, `${dir.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`) as { path: string; node_id: string; sha1: string; content_version: number }[];
  return rows
    .map((r) => ({ path: r.path.slice(dir.length + 1), nodeId: r.node_id, sha1: r.sha1, contentVersion: r.content_version }))
    .filter((r) => only === undefined ? true : r.path === only);
}

function remember(db: DatabaseSync, workspaceId: string, path: string, row: { nodeId: string; sha1: string; contentVersion: number } | null) {
  if (!row) db.prepare("DELETE FROM opened_files WHERE workspace_id = ? AND path = ?").run(workspaceId, path);
  else db.prepare(`INSERT INTO opened_files (workspace_id, path, node_id, sha1, content_version) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (workspace_id, path) DO UPDATE SET node_id = excluded.node_id, sha1 = excluded.sha1, content_version = excluded.content_version`).run(workspaceId, path, row.nodeId, row.sha1, row.contentVersion);
}

/* One sync of opened files at a time per chat. */
const running = new Map<string, Promise<string[]>>();

/**
 * Brings every node the chat has open into agreement with Drive, both ways
 * for change, Drive → sandbox only for read; closes what is no longer allowed.
 * Returns the paths Drive changed, which the agent is told about.
 */
export function syncOpened(db: DatabaseSync, config: CodeConfig, workspace: Workspace): Promise<string[]> {
  const before = running.get(workspace.id) ?? Promise.resolve([]);
  const next = before.catch(() => []).then(() => syncOnce(db, config, workspace));
  running.set(workspace.id, next);
  void next.finally(() => { if (running.get(workspace.id) === next) running.delete(workspace.id); }).catch(() => {});
  return next;
}

async function syncOnce(db: DatabaseSync, config: CodeConfig, workspace: Workspace): Promise<string[]> {
  const opened = db.prepare("SELECT workspace_id, node_id, space_id, dir FROM opened WHERE workspace_id = ?").all(workspace.id) as Opened[];
  if (!opened.length) return [];
  const owner = workspace.owner;
  const grants = grantsOf(db, owner);
  const { files: tree } = await sandbox.granted(config, workspace);
  const news: string[] = [];
  for (const o of opened) {
    let node: DriveNode | null = null;
    try { node = nodeFor(driveDb(), o.node_id, owner); } catch (error) { if (!(error instanceof DriveProblem)) throw error; }
    const allowed = node ? needOn(grants, owner, workspace.id, chainOf(o.node_id)) : null;
    const ceil = ceiling(o.space_id, owner);
    const need: Need | null = !allowed || !ceil ? null : allowed === "change" && ceil === "change" ? "change" : "read";
    const only = node?.kind === "file" ? node.name : undefined;
    if (!node || !need) {
      /* No longer allowed, or gone: out of the sandbox, and forgotten. */
      for (const row of rowsIn(db, workspace.id, o.dir, only)) {
        await sandbox.removeFile(config, workspace, `${o.dir}/${row.path}`).catch(() => {});
        remember(db, workspace.id, `${o.dir}/${row.path}`, null);
      }
      db.prepare("DELETE FROM opened WHERE workspace_id = ? AND node_id = ?").run(workspace.id, o.node_id);
      continue;
    }
    const prefix = `${o.dir.slice(filesRoot.length + 1)}/`;
    const here = tree.filter((f) => f.path.startsWith(prefix)).map((f) => ({ ...f, path: f.path.slice(prefix.length) })).filter((f) => only === undefined || f.path === only);
    let actions: SyncAction[] = planSync(rowsIn(db, workspace.id, o.dir, only), here, filesUnder(node, owner));
    if (need === "read") actions = readOnly(actions);
    if (only !== undefined) actions = actions.filter((a) => a.kind !== "upload");
    const opened = node;
    /* A few files at a time; each touches only its own path. */
    await bounded(actions, 6, async (action) => {
      try {
        if (await apply(db, config, workspace, o, opened, action)) news.push(`/files/${prefix}${action.path}`);
      } catch (error) {
        console.warn(`Kimono AI couldn't sync ${o.dir}/${action.path}:`, error instanceof Error ? error.message : error);
      }
    });
  }
  return news;
}

/** One file's move. Returns whether it came from Drive (the agent is told). */
async function apply(db: DatabaseSync, config: CodeConfig, workspace: Workspace, o: Opened, node: DriveNode, action: SyncAction): Promise<boolean> {
  const owner = workspace.owner;
  const full = `${o.dir}/${action.path}`;
  const keep = (n: DriveNode, sha: string) => remember(db, workspace.id, full, { nodeId: n.id, sha1: sha, contentVersion: n.contentVersion });
  switch (action.kind) {
    case "upload": {
      if (node.kind !== "folder") return false;
      const bytes = await sandbox.readFull(config, workspace, full);
      keep(await addToDrive(node.id, owner, action.path, bytes), sha1(bytes));
      return false;
    }
    case "update": {
      const bytes = await sandbox.readFull(config, workspace, full);
      keep(await replaceInDrive(action.nodeId, owner, action.path.split("/").pop()!, bytes), sha1(bytes));
      return false;
    }
    case "trash":
      try { trashNode(driveDb(), action.nodeId, owner); } catch (error) { if (!(error instanceof DriveProblem)) throw error; }
      remember(db, workspace.id, full, null);
      return false;
    case "put": {
      const { node: file, bytes } = await driveBytes(action.nodeId, owner);
      await sandbox.write(config, workspace, full, bytes);
      keep(file, sha1(bytes));
      return true;
    }
    case "delete":
      await sandbox.removeFile(config, workspace, full);
      remember(db, workspace.id, full, null);
      return true;
    case "conflict": {
      /* The person's copy wins; the agent's is kept beside it and goes to Drive next time as its own file. */
      const mine = await sandbox.readFull(config, workspace, full).catch(() => null);
      if (mine) {
        const dot = full.lastIndexOf("."), slash = full.lastIndexOf("/");
        await sandbox.write(config, workspace, dot > slash + 1 ? `${full.slice(0, dot)} (agent)${full.slice(dot)}` : `${full} (agent)`, mine);
      }
      if (action.nodeId) {
        const { node: file, bytes } = await driveBytes(action.nodeId, owner);
        await sandbox.write(config, workspace, full, bytes);
        keep(file, sha1(bytes));
      } else {
        await sandbox.removeFile(config, workspace, full);
        remember(db, workspace.id, full, null);
      }
      return true;
    }
    case "forget":
      remember(db, workspace.id, full, null);
      return false;
  }
}

/* ── asking and answering ── */

const describe = (r: { space_name: string; path: string }) => r.path ? `${r.path} in ${r.space_name}` : `${r.space_name}`;

/**
 * A request the agent wrote. Returns what to tell the agent when the next turn
 * should start by itself (already allowed), or null when the person decides.
 */
export async function onRequest(db: DatabaseSync, config: CodeConfig, workspace: Workspace, turn: string | null, line: { id: string; space: string; path: string; need: Need; why: string }) {
  const owner = workspace.owner;
  const found = (() => { try { return resolve(owner, line.space, line.path); } catch { return null; } })();
  const id = `${workspace.id.slice(0, 8)}-${line.id}`.slice(0, 64);
  const base = { id, space: found?.spaceName ?? line.space, path: line.path, need: line.need, why: line.why, file: found?.node.kind === "file", ...(found ? { node: found.node.id } : {}) };
  db.prepare(`INSERT OR IGNORE INTO access_requests (id, workspace_id, turn_id, space_name, path, need, why, space_id, node_id, state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, workspace.id, turn, base.space, line.path, line.need, line.why, found?.spaceId ?? null, found?.node.id ?? null, found ? "pending" : "missing", Date.now());
  if (!found) return { event: { kind: "access" as const, ...base, state: "missing" as const }, carryOn: `There's nothing called "${describe({ space_name: line.space, path: line.path })}" in their Drive. Check the name with them.` };
  /* The person's own chats' files (their Code space) are every one of their chats' to use: no asking. */
  const ownChats = found.spaceId === codeSpaceOf(db, owner);
  if (ownChats && !grantsOf(db, owner).some((g) => g.workspaceId === null && g.nodeId === found.node.id)) {
    const root = spacesOf(driveDb(), owner).find((s) => s.id === found.spaceId)?.rootId;
    if (root) addGrant(db, owner, null, found.spaceId, root, "change");
  }
  const grant = coveringGrant(grantsOf(db, owner), owner, workspace.id, chainOf(found.node.id), line.need);
  const ceil = ceiling(found.spaceId, owner);
  if (grant && ceil && (line.need === "read" || ceil === "change")) {
    db.prepare("UPDATE access_requests SET state = 'auto', answered_at = ? WHERE id = ?").run(Date.now(), id);
    await open(db, config, workspace, found.spaceName, found.node);
    return { event: { kind: "access" as const, ...base, state: "auto" as const }, carryOn: `That was already allowed. The files are in ${where(found.spaceName, found.node)}.` };
  }
  return { event: { kind: "access" as const, ...base, state: "pending" as const }, carryOn: null };
}

function where(spaceName: string, node: DriveNode) {
  return `/files/${[segment(spaceName), ...namesBelowRoot(node.id).map(segment)].join("/")}`;
}

/**
 * The person's answer. "file" allows one file of what was asked (or the file it
 * was), "chat" allows it for this chat, "always" for every chat; "deny" doesn't.
 * Returns the event to record and what to tell the agent as it carries on.
 */
export async function answer(db: DatabaseSync, config: CodeConfig, workspace: Workspace, username: string, requestId: string, choice: "file" | "chat" | "always" | "deny", fileId?: string) {
  if (username !== workspace.owner) throw new CodeProblem("Only the person this chat belongs to can answer.", 403);
  const request = db.prepare("SELECT * FROM access_requests WHERE id = ? AND workspace_id = ?").get(requestId, workspace.id) as Request | undefined;
  if (!request) throw new CodeProblem("That request isn't here.", 404);
  if (request.state !== "pending") throw new CodeProblem("That's already been answered.", 409);
  if (choice === "deny") {
    db.prepare("UPDATE access_requests SET state = 'denied', answered_at = ? WHERE id = ?").run(Date.now(), request.id);
    return { event: { kind: "access-answer" as const, id: request.id, state: "denied" as const }, carryOn: `They didn't allow ${request.need === "change" ? "changing" : "reading"} ${describe(request)}. Carry on without it, or ask them what they'd like.` };
  }
  if (!request.space_id || !request.node_id) throw new CodeProblem("That isn't in Drive any more.", 404);
  let node = nodeFor(driveDb(), request.node_id, username);
  if (choice === "file") {
    if (node.kind === "folder") {
      if (!fileId) throw new CodeProblem("Pick a file.");
      const picked = nodeFor(driveDb(), fileId, username);
      if (picked.kind !== "file" || !chainOf(picked.id).includes(node.id)) throw new CodeProblem("Pick a file from what it asked for.");
      node = picked;
    }
  }
  const ceil = ceiling(request.space_id, username);
  if (!ceil) throw new CodeProblem("You're no longer in that space.", 403);
  const need: Need = request.need === "change" && ceil === "change" ? "change" : "read";
  addGrant(db, username, choice === "always" ? null : workspace.id, request.space_id, node.id, need);
  db.prepare("UPDATE access_requests SET state = 'allowed', answered_at = ? WHERE id = ?").run(Date.now(), request.id);
  const spaceName = spacesOf(driveDb(), username).find((s) => s.id === request.space_id)?.name ?? request.space_name;
  await open(db, config, workspace, spaceName, node);
  const scope = choice === "always" ? "from now on, in every chat" : "for this chat";
  const downgraded = need !== request.need ? " They can only view that space, so it's read only." : "";
  return {
    event: { kind: "access-answer" as const, id: request.id, state: "allowed" as const, scope: choice, need },
    carryOn: `They allowed you to ${need === "change" ? "read and change" : "read"} ${node.kind === "file" ? node.name : describe(request)}, ${scope}. It's in ${where(spaceName, node)}.${downgraded} Carry on with what they asked.`,
  };
}

/** The line each message starts with: the spaces to ask for, and what's open in this chat. */
export function accessPrompt(db: DatabaseSync, workspace: Workspace): string {
  try {
    const owner = workspace.owner;
    const spaces = spacesOf(driveDb(), owner).map((s) => s.name);
    const grants = grantsOf(db, owner);
    const open = (db.prepare("SELECT node_id, dir FROM opened WHERE workspace_id = ?").all(workspace.id) as { node_id: string; dir: string }[])
      .map((o) => ({ dir: o.dir, need: needOn(grants, owner, workspace.id, chainOf(o.node_id)) }))
      .filter((o): o is { dir: string; need: Need } => o.need !== null);
    const code = codeSpaceOf(db, owner);
    const codeName = spacesOf(driveDb(), owner).find((s) => s.id === code)?.name;
    const note = accessNote(spaces, open);
    return codeName ? `${note} Every one of their chats keeps its files in the "${codeName}" space (a folder per project, then one per chat); ask for any of it with kimono-access and it opens without asking them.` : note;
  } catch {
    return "";
  }
}

/* ── settings: what is always allowed ── */

export type AlwaysGrant = { id: string; spaceId: string; spaceName: string; path: string; need: Need };

export function alwaysGrants(db: DatabaseSync, username: string): AlwaysGrant[] {
  const spaces = new Map(spacesOf(driveDb(), username).map((s) => [s.id, s]));
  return grantsOf(db, username).filter((g) => g.workspaceId === null && spaces.has(g.spaceId)).map((g) => {
    const space = spaces.get(g.spaceId)!;
    return { id: g.id, spaceId: g.spaceId, spaceName: space.name, path: g.nodeId === space.rootId ? "" : namesBelowRoot(g.nodeId).join("/"), need: g.need };
  });
}

/** Always allow a whole space without asking, at [need]; null takes it back. */
export function setSpaceAuto(db: DatabaseSync, username: string, spaceId: string, need: Need | null) {
  const space = spacesOf(driveDb(), username).find((s) => s.id === spaceId);
  if (!space) throw new CodeProblem("That space isn't yours to share.", 404);
  db.prepare("DELETE FROM grants WHERE username = ? AND workspace_id IS NULL AND node_id = ?").run(username, space.rootId);
  if (need) addGrant(db, username, null, space.id, space.rootId, need === "change" && space.role === "viewer" ? "read" : need);
}

/** Takes back an always permission. Chats that opened files through it lose them at their next sync. */
export function revokeGrant(db: DatabaseSync, username: string, grantId: string) {
  const done = db.prepare("DELETE FROM grants WHERE id = ? AND username = ?").run(grantId, username);
  if (!done.changes) throw new CodeProblem("That permission isn't here.", 404);
}

/** Chats with files open, so revoking can close them straight away. */
export function chatsWithOpenFiles(db: DatabaseSync, username: string): string[] {
  return (db.prepare("SELECT DISTINCT o.workspace_id AS id FROM opened o JOIN workspaces w ON w.id = o.workspace_id WHERE w.owner = ?").all(username) as { id: string }[]).map((r) => r.id);
}

/** After a permission is taken back: every chat with files open drops what it may no longer have, now. */
export function closeRevoked(db: DatabaseSync, config: CodeConfig, username: string, workspaceOf: (id: string) => Workspace | null) {
  for (const id of chatsWithOpenFiles(db, username)) {
    const workspace = workspaceOf(id);
    if (workspace) void syncOpened(db, config, workspace).catch((error) => console.warn("Kimono AI couldn't close revoked files:", error instanceof Error ? error.message : error));
  }
}
