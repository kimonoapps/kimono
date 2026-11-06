import "server-only";

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  addFile, blobPath, childrenOf, moveNode, createFolder, createSpace, db as driveDb, driveOn, DriveProblem, finishUpload,
  maxFileBytes, newId as driveId, nodeFor, renameNode, roleIn, root as driveRoot, startReplace, trashNode, typeOf,
  type DriveNode,
} from "../drive";
import type { CodeConfig } from "./config";
import {
  CodeProblem, driveSpaceOf, noteDriveNews, recordSynced, setDriveFolder, setDriveSpace, syncedRows, workspaceFor,
  type Workspace,
} from "./model";
import { sandbox } from "./node";
import { agentCopyName, planSync, type DriveFile, type SyncAction } from "./sync";

/*
 * Kimono AI in Drive. Everyone who uses it gets a "Kimono AI" space; each project is a
 * folder in it and each task a folder in that, holding the task's files as
 * they are in its sandbox. Everything goes through Drive's own model, so web
 * Drive, the phone and the Files app see Code's files like any others, and a
 * person's edits there come back into the sandbox before the agent's next turn.
 */

const shotsFolder = "Screenshots";
const sha1 = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex");

async function storeBlob(bytes: Uint8Array) {
  const blob = driveId();
  const path = blobPath(driveRoot, blob);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { mode: 0o600 });
  return blob;
}

/** A child folder by name, made if it isn't there. */
function folderIn(parentId: string, owner: string, name: string): DriveNode {
  const db = driveDb();
  const found = childrenOf(db, parentId, owner).children.find((c) => c.kind === "folder" && c.name.toLowerCase() === name.toLowerCase());
  return found ?? createFolder(db, parentId, owner, name);
}

/** The person's Kimono AI space, made the first time and made again if they deleted it or left it. */
function codeSpace(db: DatabaseSync, owner: string) {
  const drive = driveDb();
  const known = driveSpaceOf(db, owner);
  if (known && roleIn(drive, known, owner) === "owner") {
    const root = drive.prepare("SELECT root_id FROM spaces WHERE id = ?").get(known) as { root_id: string } | undefined;
    if (root) return { id: known, rootId: root.root_id };
  }
  const made = createSpace(drive, owner, { name: "Kimono AI", crest: "kikyo", color: "asagi" });
  setDriveSpace(db, owner, made.id);
  return { id: made.id, rootId: made.rootId };
}

/** Where a chat's folder belongs: its project's folder, "Chats" for one in none, or its repository's for work on one. */
function homeOf(workspace: Workspace) {
  return workspace.kind === "project" ? workspace.repo.name : workspace.folder?.name ?? "Chats";
}

/** Moves a chat's folder to where it now belongs (after it changed project, or its project was renamed). */
export async function rehome(db: DatabaseSync, workspace: Workspace) {
  if (!(await driveOn()) || !workspace.drive) return;
  const space = codeSpace(db, workspace.owner);
  if (space.id !== workspace.drive.spaceId) return;
  const home = folderIn(space.rootId, workspace.owner, homeOf(workspace));
  try { moveNode(driveDb(), workspace.drive.folderId, workspace.owner, home.id); } catch (error) { if (!(error instanceof DriveProblem)) throw error; }
}

/** The chat's folder takes its new name, made unique among its neighbours as when it was made. */
export async function retitle(db: DatabaseSync, workspace: Workspace) {
  if (!(await driveOn()) || !workspace.drive) return;
  const base = folderName(workspace.title);
  for (let n = 1; n < 50; n += 1) {
    try { renameNode(driveDb(), workspace.drive.folderId, workspace.owner, n === 1 ? base : `${base} (${n})`); return; } catch (error) {
      if (!(error instanceof DriveProblem) || error.status !== 409) return;
    }
  }
}

const folderName = (title: string) => title.replace(/[\u0000-\u001f\u007f/\\]/g, " ").trim().slice(0, 120) || "Task";

/** The person's Code space, where every chat's files are: any of their chats may use it without asking. */
export function codeSpaceOf(db: DatabaseSync, owner: string): string | null {
  try { return codeSpace(db, owner).id; } catch { return null; }
}

/** The task's folder: Code → project → task. Made, or made again, as needed. */
export async function taskFolder(db: DatabaseSync, workspace: Workspace): Promise<{ spaceId: string; folderId: string } | null> {
  if (!(await driveOn())) return null;
  const owner = workspace.owner;
  const space = codeSpace(db, owner);
  const current = workspaceFor(db, workspace.id, owner).drive;
  if (current && current.spaceId === space.id) {
    try {
      const folder = nodeFor(driveDb(), current.folderId, owner, "editor");
      if (folder.kind === "folder") return current;
    } catch (error) {
      if (!(error instanceof DriveProblem)) throw error;
    }
  }
  const project = folderIn(space.rootId, owner, homeOf(workspace));
  const taken = new Set(childrenOf(driveDb(), project.id, owner).children.map((c) => c.name.toLowerCase()));
  const base = folderName(workspace.title);
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base} (${n})`;
  const folder = createFolder(driveDb(), project.id, owner, name);
  setDriveFolder(db, workspace.id, folder.id);
  return { spaceId: space.id, folderId: folder.id };
}

/** Every file under the task folder, by its path there; the Screenshots folder is the agent's, not the project's. */
function driveFiles(folderId: string, owner: string): DriveFile[] {
  const db = driveDb();
  const out: DriveFile[] = [];
  const walk = (id: string, prefix: string, depth: number) => {
    if (depth > 32) return;
    for (const child of childrenOf(db, id, owner).children) {
      if (!prefix && child.kind === "folder" && child.name === shotsFolder) continue;
      const path = `${prefix}${child.name}`;
      if (child.kind === "folder") walk(child.id, `${path}/`, depth + 1);
      else out.push({ path, nodeId: child.id, contentVersion: child.contentVersion });
    }
  };
  walk(folderId, "", 0);
  return out;
}

/** The folder a path's file lives in, made down from the task folder. */
function parentFor(folderId: string, owner: string, path: string): string {
  let at = folderId;
  for (const part of path.split("/").slice(0, -1)) at = folderIn(at, owner, part).id;
  return at;
}

export async function driveBytes(nodeId: string, owner: string) {
  const node = nodeFor(driveDb(), nodeId, owner, "viewer");
  if (node.kind !== "file" || !node.blob) throw new CodeProblem("That isn't a file.");
  return { node, bytes: new Uint8Array(await readFile(blobPath(driveRoot, node.blob))) };
}

/** New bytes for a Drive file, as a new version of the same file, the way Drive takes an edit. */
export async function replaceInDrive(nodeId: string, owner: string, name: string, bytes: Uint8Array): Promise<DriveNode> {
  const db = driveDb();
  const node = nodeFor(db, nodeId, owner, "editor");
  const upload = startReplace(db, nodeId, owner, node.contentVersion, { size: bytes.byteLength, mime: typeOf(name) }, maxFileBytes);
  const blob = await storeBlob(bytes);
  const { node: done } = finishUpload(db, upload, blob);
  return done;
}

export async function addToDrive(folderId: string, owner: string, path: string, bytes: Uint8Array): Promise<DriveNode> {
  const name = path.split("/").pop()!;
  const blob = await storeBlob(bytes);
  return addFile(driveDb(), parentFor(folderId, owner, path), owner, { name, size: bytes.byteLength, mime: typeOf(name), blob });
}

/* One sync at a time per workspace; a second waits for the first. */
const running = new Map<string, Promise<string[]>>();

/**
 * Brings the task's Drive folder and its sandbox into agreement. Returns the
 * paths that came into the sandbox from Drive, which the agent is told about.
 */
export function syncDrive(db: DatabaseSync, config: CodeConfig, workspace: Workspace): Promise<string[]> {
  const before = running.get(workspace.id) ?? Promise.resolve([]);
  const next = before.catch(() => []).then(() => syncOnce(db, config, workspace));
  running.set(workspace.id, next);
  void next.finally(() => { if (running.get(workspace.id) === next) running.delete(workspace.id); }).catch(() => {});
  return next;
}

async function syncOnce(db: DatabaseSync, config: CodeConfig, workspace: Workspace): Promise<string[]> {
  const place = await taskFolder(db, workspace);
  if (!place) return [];
  const owner = workspace.owner;
  const { files: tree } = await sandbox.tree(config, workspace);
  const actions = planSync(syncedRows(db, workspace.id), tree, driveFiles(place.folderId, owner));
  const fromDrive: string[] = [];
  const shaOf = new Map(tree.map((f) => [f.path, f.sha1]));
  for (const action of actions) {
    try {
      fromDrive.push(...(await apply(db, config, workspace, place.folderId, action, shaOf.get(action.path))));
    } catch (error) {
      /* One file that won't go doesn't stop the rest; it is tried again next time. */
      console.warn(`Code couldn't sync ${action.path}:`, error instanceof Error ? error.message : error);
    }
  }
  noteDriveNews(db, workspace.id, fromDrive);
  return fromDrive;
}

async function apply(db: DatabaseSync, config: CodeConfig, workspace: Workspace, folderId: string, action: SyncAction, sandboxSha?: string): Promise<string[]> {
  const owner = workspace.owner;
  const record = (path: string, node: DriveNode, sha: string) => recordSynced(db, workspace.id, path, { nodeId: node.id, sha1: sha, contentVersion: node.contentVersion });
  switch (action.kind) {
    case "upload": {
      const bytes = await sandbox.readFull(config, workspace, action.path);
      record(action.path, await addToDrive(folderId, owner, action.path, bytes), sha1(bytes));
      return [];
    }
    case "update": {
      const bytes = await sandbox.readFull(config, workspace, action.path);
      record(action.path, await replaceInDrive(action.nodeId, owner, action.path.split("/").pop()!, bytes), sha1(bytes));
      return [];
    }
    case "trash":
      try { trashNode(driveDb(), action.nodeId, owner); } catch (error) { if (!(error instanceof DriveProblem)) throw error; }
      recordSynced(db, workspace.id, action.path, null);
      return [];
    case "put": {
      const { node, bytes } = await driveBytes(action.nodeId, owner);
      await sandbox.write(config, workspace, action.path, bytes);
      record(action.path, node, sha1(bytes));
      return [action.path];
    }
    case "delete":
      await sandbox.removeFile(config, workspace, action.path);
      recordSynced(db, workspace.id, action.path, null);
      return [action.path];
    case "conflict": {
      /* Drive wins; the agent's version is kept beside it, and reaches Drive on the next sync as a file of its own. */
      if (sandboxSha) {
        const mine = await sandbox.readFull(config, workspace, action.path);
        await sandbox.write(config, workspace, agentCopyName(action.path), mine);
      }
      if (action.nodeId) {
        const { node, bytes } = await driveBytes(action.nodeId, owner);
        await sandbox.write(config, workspace, action.path, bytes);
        record(action.path, node, sha1(bytes));
      } else {
        await sandbox.removeFile(config, workspace, action.path);
        recordSynced(db, workspace.id, action.path, null);
      }
      return [action.path];
    }
    case "forget":
      recordSynced(db, workspace.id, action.path, null);
      return [];
  }
}

/** A screenshot the agent took, into the task's Screenshots folder. */
export async function shotToDrive(db: DatabaseSync, workspace: Workspace, name: string, bytes: Uint8Array) {
  const place = await taskFolder(db, workspace);
  if (!place) return;
  const folder = folderIn(place.folderId, workspace.owner, shotsFolder);
  const blob = await storeBlob(bytes);
  addFile(driveDb(), folder.id, workspace.owner, { name, size: bytes.byteLength, mime: typeOf(name), blob });
}

/**
 * Files someone picked in Drive, for the agent: copied into the task folder
 * (so they become the project's) and into the sandbox. The caller hands the
 * bytes on as attachments too, so the message can point at them.
 */
export async function fromDrive(db: DatabaseSync, config: CodeConfig, workspace: Workspace, username: string, ids: unknown): Promise<{ name: string; type: string; bytes: Uint8Array }[]> {
  if (!Array.isArray(ids) || !ids.length || ids.length > 10 || !ids.every((id) => typeof id === "string")) throw new CodeProblem("Choose up to ten files.");
  const place = await taskFolder(db, workspace);
  if (!place) throw new CodeProblem("Drive isn't switched on.", 409);
  const picked: (DriveNode & { blob: string | null })[] = [];
  for (const id of ids as string[]) {
    let node: DriveNode & { blob: string | null };
    try { node = nodeFor(driveDb(), id, username, "viewer"); } catch (error) {
      if (error instanceof DriveProblem) throw new CodeProblem(error.message, error.status);
      throw error;
    }
    if (node.kind !== "file" || !node.blob) throw new CodeProblem(`“${node.name}” is a folder. Choose files.`);
    if (node.size > 20 * 1024 * 1024) throw new CodeProblem(`“${node.name}” is over 20 MB.`);
    picked.push(node);
  }
  const out: { name: string; type: string; bytes: Uint8Array }[] = [];
  for (const node of picked) {
    const blob = driveId();
    const target = blobPath(driveRoot, blob);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(blobPath(driveRoot, node.blob!), target);
    const copy = addFile(driveDb(), place.folderId, workspace.owner, { name: node.name, size: node.size, mime: node.mime, blob });
    const bytes = new Uint8Array(await readFile(target));
    /* Into the repository where Drive has it, recorded as agreed so the next sync leaves it be. */
    await sandbox.write(config, workspace, copy.name, bytes);
    recordSynced(db, workspace.id, copy.name, { nodeId: copy.id, sha1: sha1(bytes), contentVersion: copy.contentVersion });
    out.push({ name: copy.name, type: node.mime || typeOf(node.name) || "application/octet-stream", bytes });
  }
  return out;
}
