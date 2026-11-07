/*
 * Asking for a person's Drive: the deciding, with no Drive or sandbox in
 * reach, so it can be tested on its own. The doing is in access.ts.
 */
import type { SyncAction } from "./sync";

export type Need = "read" | "change";
export type Grant = { id: string; username: string; workspaceId: string | null; spaceId: string; nodeId: string; need: Need };

/** Where granted files live in a sandbox, under /workspace; /files points here. */
export const filesRoot = ".kimono/files";

/** Change includes read. */
export const covers = (have: Need, want: Need) => have === "change" || want === "read";

/**
 * The grant that already allows [want] on a node, if any: one for this chat or
 * an always one, on the node itself or a folder above it. [chain] is the node
 * and every folder above it, nearest first.
 */
export function coveringGrant(grants: Grant[], username: string, workspaceId: string, chain: string[], want: Need): Grant | null {
  const lineage = new Set(chain);
  const fits = grants.filter((g) => g.username === username && (g.workspaceId === null || g.workspaceId === workspaceId) && lineage.has(g.nodeId) && covers(g.need, want));
  /* The nearest and strongest wins, so a chat's change on a folder beats an always read on the space. */
  fits.sort((a, b) => chain.indexOf(a.nodeId) - chain.indexOf(b.nodeId) || (a.need === b.need ? 0 : a.need === "change" ? -1 : 1));
  return fits[0] ?? null;
}

/** The strongest need any grant gives this chat on a node it has open. */
export function needOn(grants: Grant[], username: string, workspaceId: string, chain: string[]): Need | null {
  const read = coveringGrant(grants, username, workspaceId, chain, "read");
  if (!read) return null;
  return coveringGrant(grants, username, workspaceId, chain, "change") ? "change" : "read";
}

/** A Drive name made safe as one path segment. */
export function segment(name: string) {
  return name.replace(/[\u0000-\u001f\u007f/\\]/g, " ").replace(/^\.+/, "").trim().slice(0, 120) || "Untitled";
}

/** Where an opened node sits in the sandbox: .kimono/files/<space>/<path below the space's root>. */
export function openedDir(spaceName: string, namesBelowRoot: string[]) {
  return [filesRoot, segment(spaceName), ...namesBelowRoot.map(segment)].join("/");
}

/**
 * What to do on a read-only grant: the person's files come in and follow Drive,
 * and whatever the agent changed is put back from Drive; nothing it does goes out.
 * Files the agent added there stay in the sandbox and are never uploaded.
 */
export function readOnly(actions: SyncAction[]): SyncAction[] {
  const out: SyncAction[] = [];
  for (const action of actions) {
    switch (action.kind) {
      case "upload": break;
      case "update": case "trash": out.push({ kind: "put", path: action.path, nodeId: action.nodeId }); break;
      case "conflict": out.push(action.nodeId ? { kind: "put", path: action.path, nodeId: action.nodeId } : { kind: "delete", path: action.path }); break;
      default: out.push(action);
    }
  }
  return out;
}

/** The one line each message starts with: what the agent may ask for, and what is open to it. */
export function accessNote(spaces: string[], open: { dir: string; need: Need }[], notebooks: string[] = []) {
  const parts: string[] = [];
  parts.push(spaces.length ? `Drive spaces you can ask for: ${spaces.slice(0, 40).join(", ")}.` : "This person has no Drive spaces.");
  if (notebooks.length) parts.push(`Their notebooks in Kimono Notes, asked for the same way: ${notebooks.slice(0, 40).join(", ")}.`);
  if (open.length) parts.push(`Open to you now: ${open.slice(0, 40).map((o) => `/files/${o.dir.slice(filesRoot.length + 1)} (${o.need === "change" ? "read and change" : "read only"})`).join(", ")}.`);
  return parts.join(" ");
}
