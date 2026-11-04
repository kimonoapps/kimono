/*
 * Keeping a task's files in Drive and in its sandbox the same. This is only
 * the deciding: given what both sides held when they last agreed, and what
 * each holds now, which way each file has to go. The doing is in drive.ts.
 *
 * A person's edit in Drive is intent, so when both sides changed the same
 * file, Drive's copy wins and the agent's is kept beside it.
 */

/** What both sides held for a path the last time they agreed. */
export type SyncRow = { path: string; nodeId: string; sha1: string; contentVersion: number };
/** A file in the sandbox now. */
export type TreeFile = { path: string; size: number; sha1: string };
/** A file in the task's Drive folder now. */
export type DriveFile = { path: string; nodeId: string; contentVersion: number };

export type SyncAction =
  /** New in the sandbox: add it to Drive. */
  | { kind: "upload"; path: string }
  /** Changed in the sandbox: a new version of the same Drive file. */
  | { kind: "update"; path: string; nodeId: string }
  /** Gone from the sandbox: to Drive's trash. */
  | { kind: "trash"; path: string; nodeId: string }
  /** New or changed in Drive: into the sandbox. */
  | { kind: "put"; path: string; nodeId: string }
  /** Gone from Drive: out of the sandbox. */
  | { kind: "delete"; path: string }
  /** Changed on both sides: Drive's goes into the sandbox, the agent's is kept as "<name> (agent)". */
  | { kind: "conflict"; path: string; nodeId: string | null }
  /** Gone from both: nothing to do but forget it. */
  | { kind: "forget"; path: string };

/** "site/index.html" → "site/index (agent).html". */
export function agentCopyName(path: string) {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash + 1), name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${dir}${name.slice(0, dot)} (agent)${name.slice(dot)}` : `${dir}${name} (agent)`;
}

export function planSync(previous: SyncRow[], tree: TreeFile[], drive: DriveFile[]): SyncAction[] {
  const was = new Map(previous.map((row) => [row.path, row]));
  const here = new Map(tree.map((file) => [file.path, file]));
  const there = new Map(drive.map((file) => [file.path, file]));
  const paths = [...new Set([...was.keys(), ...here.keys(), ...there.keys()])].sort();
  const actions: SyncAction[] = [];
  for (const path of paths) {
    const row = was.get(path), t = here.get(path), d = there.get(path);
    if (!row) {
      if (t && d) actions.push({ kind: "conflict", path, nodeId: d.nodeId });
      else if (t) actions.push({ kind: "upload", path });
      else if (d) actions.push({ kind: "put", path, nodeId: d.nodeId });
      continue;
    }
    const sandboxChanged = !t || t.sha1 !== row.sha1;
    const driveChanged = !d || d.nodeId !== row.nodeId || d.contentVersion !== row.contentVersion;
    if (!sandboxChanged && !driveChanged) continue;
    if (sandboxChanged && !driveChanged) {
      actions.push(t ? { kind: "update", path, nodeId: d!.nodeId } : { kind: "trash", path, nodeId: d!.nodeId });
    } else if (driveChanged && !sandboxChanged) {
      actions.push(d ? { kind: "put", path, nodeId: d.nodeId } : { kind: "delete", path });
    } else if (!t && !d) {
      actions.push({ kind: "forget", path });
    } else if (!t) {
      /* The agent removed it while someone edited it: the edit comes back. */
      actions.push({ kind: "put", path, nodeId: d!.nodeId });
    } else {
      /* Edited in the sandbox and edited (or removed) in Drive. */
      actions.push({ kind: "conflict", path, nodeId: d?.nodeId ?? null });
    }
  }
  return actions;
}
