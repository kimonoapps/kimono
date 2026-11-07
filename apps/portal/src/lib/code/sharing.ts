import "server-only";

import type { DatabaseSync } from "node:sqlite";
import { artifactOf, type Artifact } from "./artifacts";
import { CodeProblem, newId, sharedWorkspacesOf, workspaceFor, type Workspace } from "./model";

/*
 * Sharing a chat or an artifact (docs/kimono-ai.md, "Sharing").
 *
 * A chat's owner can invite people in the household: each may read it, or
 * write in it too. Someone who writes sends messages as themselves (their
 * own share of the plan), but the chat is still the owner's: its files,
 * memory, Drive permissions and connected apps. Only the owner answers
 * Kimono AI's requests for Drive, runs or stops its app, renames, moves,
 * shares or deletes it.
 *
 * A chat's link can also be turned on: anyone with it can read the chat,
 * without signing in; a signed-in person who opens a link that lets people
 * write joins the chat as a writer.
 *
 * An artifact has a link of its own that opens just that page: for the
 * people it was shared with, or, once made public, for anyone.
 */

export type Access = "owner" | "edit" | "read";
const rank: Record<Access, number> = { read: 1, edit: 2, owner: 3 };

/** A chat as one person sees it: whether it's theirs, or shared with them to read or write. */
export type SharedWorkspace = Workspace & { access: Access };

/** Who else is in each chat: the people it's shared with and its owner, leaving out [me]. Chats with nobody else aren't named. */
export function peopleIn(db: DatabaseSync, chats: { id: string; owner: string }[], me: string): Record<string, string[]> {
  if (!chats.length) return {};
  const ids = chats.map((c) => c.id);
  const rows = db.prepare(`SELECT workspace_id, username FROM chat_shares WHERE workspace_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at`).all(...ids) as { workspace_id: string; username: string }[];
  const shares = new Map<string, string[]>();
  for (const row of rows) shares.set(row.workspace_id, [...(shares.get(row.workspace_id) ?? []), row.username]);
  const out: Record<string, string[]> = {};
  const self = me.toLowerCase();
  for (const chat of chats) {
    const people = [...new Set([chat.owner, ...(shares.get(chat.id) ?? [])])].filter((who) => who && who !== self);
    if (people.length) out[chat.id] = people;
  }
  return out;
}

/** The access [username] has to chat [id], or [token] (its link) gives. Null when neither gives any. */
export function accessOf(db: DatabaseSync, id: string, username: string | null, token?: string | null): Access | null {
  const owner = (db.prepare("SELECT owner FROM workspaces WHERE id = ?").get(id) as { owner: string } | undefined)?.owner;
  if (!owner) return null;
  let found: Access | null = null;
  if (username && owner === username.toLowerCase()) return "owner";
  if (username) {
    const share = db.prepare("SELECT access FROM chat_shares WHERE workspace_id = ? AND username = ?").get(id, username.toLowerCase()) as { access: "read" | "edit" } | undefined;
    if (share) found = share.access;
  }
  if (token) {
    const link = db.prepare("SELECT access FROM chat_links WHERE workspace_id = ? AND token = ?").get(id, token) as { access: "read" | "edit" } | undefined;
    /* A link that lets people write still only lets someone signed in do it. */
    const given: Access | null = link ? (link.access === "edit" && username ? "edit" : "read") : null;
    if (given && (!found || rank[given] > rank[found])) found = given;
  }
  return found;
}

/** The chat, for someone who needs at least [need]: refused as if it weren't there when they have no access at all. */
export function workspaceAs(db: DatabaseSync, id: string, username: string | null, need: Access, token?: string | null): SharedWorkspace {
  const access = accessOf(db, id, username, token);
  if (!access) throw new CodeProblem("That workspace isn't here.", 404);
  if (rank[access] < rank[need]) throw new CodeProblem(need === "owner" ? "Only the person who started this chat can do that." : "You can read this chat, but not write in it.", 403);
  const owner = (db.prepare("SELECT owner FROM workspaces WHERE id = ?").get(id) as { owner: string }).owner;
  return { ...workspaceFor(db, id, owner), access };
}

/** Chats shared with [username], each with what they may do in it. */
export function sharedWithMe(db: DatabaseSync, username: string): SharedWorkspace[] {
  const access = new Map((db.prepare("SELECT workspace_id, access FROM chat_shares WHERE username = ?").all(username.toLowerCase()) as { workspace_id: string; access: Access }[]).map((r) => [r.workspace_id, r.access]));
  return sharedWorkspacesOf(db, username).map((w) => ({ ...w, access: access.get(w.id) ?? "read" }));
}

/* ── a chat's people and its link ── */

export type ChatSharing = { people: { username: string; access: "read" | "edit" }[]; link: { token: string; access: "read" | "edit" } | null };

export function chatSharing(db: DatabaseSync, id: string): ChatSharing {
  const people = db.prepare("SELECT username, access FROM chat_shares WHERE workspace_id = ? ORDER BY created_at").all(id) as { username: string; access: "read" | "edit" }[];
  const link = db.prepare("SELECT token, access FROM chat_links WHERE workspace_id = ?").get(id) as { token: string; access: "read" | "edit" } | undefined;
  return { people: people.map((p) => ({ username: p.username, access: p.access })), link: link ? { token: link.token, access: link.access } : null };
}

/** Invites [username] to read or write in the chat, changes what they may do, or (null) takes them off it. */
export function shareChat(db: DatabaseSync, workspace: Workspace, username: unknown, access: unknown, now = Date.now()): ChatSharing {
  if (typeof username !== "string" || !/^[A-Za-z0-9._@-]{1,150}$/.test(username)) throw new CodeProblem("Choose someone to share with.");
  const who = username.toLowerCase();
  if (who === workspace.owner) throw new CodeProblem("It's already yours.");
  if (access === null) db.prepare("DELETE FROM chat_shares WHERE workspace_id = ? AND username = ?").run(workspace.id, who);
  else if (access === "read" || access === "edit") {
    db.prepare("INSERT INTO chat_shares (workspace_id, username, access, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (workspace_id, username) DO UPDATE SET access = excluded.access").run(workspace.id, who, access, now);
  } else throw new CodeProblem("Choose whether they can read it or write in it.");
  return chatSharing(db, workspace.id);
}

/** Turns the chat's link on (anyone can read; "edit" lets signed-in people write too), or off (null). Turning it off and on makes a new link. */
export function setChatLink(db: DatabaseSync, workspace: Workspace, access: unknown): ChatSharing {
  if (access === null) db.prepare("DELETE FROM chat_links WHERE workspace_id = ?").run(workspace.id);
  else if (access === "read" || access === "edit") {
    db.prepare("INSERT INTO chat_links (workspace_id, token, access) VALUES (?, ?, ?) ON CONFLICT (workspace_id) DO UPDATE SET access = excluded.access").run(workspace.id, newId(16), access);
  } else throw new CodeProblem("Choose who the link is for.");
  return chatSharing(db, workspace.id);
}

/** What a chat link opens, if it's a chat's. */
export function chatOfLink(db: DatabaseSync, token: string): { workspaceId: string; access: "read" | "edit" } | null {
  const row = db.prepare("SELECT workspace_id, access FROM chat_links WHERE token = ?").get(token) as { workspace_id: string; access: "read" | "edit" } | undefined;
  return row ? { workspaceId: row.workspace_id, access: row.access } : null;
}

/** A signed-in person opened a chat's link: it's theirs to come back to, to read, or to write in when the link allows. */
export function joinByLink(db: DatabaseSync, token: string, username: string, now = Date.now()): SharedWorkspace {
  const link = chatOfLink(db, token);
  if (!link) throw new CodeProblem("This link doesn't work any more.", 404);
  const current = accessOf(db, link.workspaceId, username);
  if (current !== "owner" && (!current || rank[link.access] > rank[current])) {
    db.prepare("INSERT INTO chat_shares (workspace_id, username, access, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (workspace_id, username) DO UPDATE SET access = excluded.access").run(link.workspaceId, username.toLowerCase(), link.access, now);
  }
  return workspaceAs(db, link.workspaceId, username, "read");
}

/* ── an artifact's link ── */

export type ArtifactSharing = { token: string | null; public: boolean; people: string[] };

export function artifactSharing(db: DatabaseSync, workspaceId: string, name: string): ArtifactSharing {
  const link = db.prepare("SELECT token, public FROM artifact_links WHERE workspace_id = ? AND name = ?").get(workspaceId, name) as { token: string; public: number } | undefined;
  const people = (db.prepare("SELECT username FROM artifact_people WHERE workspace_id = ? AND name = ? ORDER BY created_at").all(workspaceId, name) as { username: string }[]).map((p) => p.username);
  return { token: link?.token ?? null, public: link?.public === 1, people };
}

function linkFor(db: DatabaseSync, workspaceId: string, name: string) {
  if (!artifactOf(db, workspaceId, name)) throw new CodeProblem("That artifact isn't here.", 404);
  db.prepare("INSERT INTO artifact_links (workspace_id, name, token, public) VALUES (?, ?, ?, 0) ON CONFLICT (workspace_id, name) DO NOTHING").run(workspaceId, name, newId(16));
}

/** Lets [username] open the artifact (true), or not any more (false). */
export function shareArtifact(db: DatabaseSync, workspace: Workspace, name: string, username: unknown, on: unknown, now = Date.now()): ArtifactSharing {
  if (typeof username !== "string" || !/^[A-Za-z0-9._@-]{1,150}$/.test(username)) throw new CodeProblem("Choose someone to share with.");
  linkFor(db, workspace.id, name);
  if (on === false) db.prepare("DELETE FROM artifact_people WHERE workspace_id = ? AND name = ? AND username = ?").run(workspace.id, name, username.toLowerCase());
  else db.prepare("INSERT OR IGNORE INTO artifact_people (workspace_id, name, username, created_at) VALUES (?, ?, ?, ?)").run(workspace.id, name, username.toLowerCase(), now);
  return artifactSharing(db, workspace.id, name);
}

/** Makes the artifact's link open for anyone (true), or only for the people it's shared with (false). */
export function setArtifactPublic(db: DatabaseSync, workspace: Workspace, name: string, on: unknown): ArtifactSharing {
  linkFor(db, workspace.id, name);
  db.prepare("UPDATE artifact_links SET public = ? WHERE workspace_id = ? AND name = ?").run(on === true ? 1 : 0, workspace.id, name);
  return artifactSharing(db, workspace.id, name);
}

/** The artifact a link opens, for [username] (null: someone not signed in). Refused as missing unless it's theirs, shared with them, or public. */
export function artifactByLink(db: DatabaseSync, token: string, username: string | null): Artifact & { workspaceId: string; owner: string; public: boolean } {
  const link = db.prepare("SELECT l.workspace_id, l.name, l.public, w.owner FROM artifact_links l JOIN workspaces w ON w.id = l.workspace_id WHERE l.token = ?").get(token) as { workspace_id: string; name: string; public: number; owner: string } | undefined;
  if (!link) throw new CodeProblem("This link doesn't work any more.", 404);
  const allowed = link.public === 1
    || (username !== null && (link.owner === username.toLowerCase()
      || Boolean(db.prepare("SELECT 1 FROM artifact_people WHERE workspace_id = ? AND name = ? AND username = ?").get(link.workspace_id, link.name, username.toLowerCase()))
      || Boolean(accessOf(db, link.workspace_id, username))));
  if (!allowed) throw new CodeProblem(username ? "This artifact wasn't shared with you." : "Sign in to open this artifact.", username ? 404 : 401);
  const found = artifactOf(db, link.workspace_id, link.name);
  if (!found) throw new CodeProblem("This link doesn't work any more.", 404);
  return { ...found, workspaceId: link.workspace_id, owner: link.owner, public: link.public === 1 };
}

/** Artifacts shared with [username]: their links, names and whose they are. */
export function artifactsSharedWith(db: DatabaseSync, username: string): { token: string; name: string; title: string; owner: string; updatedAt: number }[] {
  return (db.prepare(`SELECT l.token, a.name, a.title, w.owner, a.updated_at FROM artifact_people p
    JOIN artifact_links l ON l.workspace_id = p.workspace_id AND l.name = p.name
    JOIN artifacts a ON a.workspace_id = p.workspace_id AND a.name = p.name
    JOIN workspaces w ON w.id = p.workspace_id
    WHERE p.username = ? ORDER BY p.created_at DESC`).all(username.toLowerCase()) as { token: string; name: string; title: string; owner: string; updated_at: number }[])
    .map((r) => ({ token: r.token, name: r.name, title: r.title, owner: r.owner, updatedAt: r.updated_at }));
}

/** A sharing answer, with whether this Kimono lets links open for people not signed in. */
export function linksOn<T extends object>(config: { publicLinks: boolean }, sharing: T): T & { publicLinks: boolean } {
  return { ...sharing, publicLinks: config.publicLinks };
}
