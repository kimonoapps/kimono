import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/*
 * People's own apps (Gmail, Calendar, Notion…) through Composio's Tool Router.
 * Each person has one session, made once and reused: it holds their connected
 * accounts and exposes one MCP server with Composio's own tools for finding
 * tools, connecting accounts and running them. Kimono has no code for any
 * one toolkit. The session's address and key go to the node with each ensure
 * and live only in its memory; the sandbox reaches them through the node's
 * gateway, never directly (docs/kimono-ai.md).
 */

const api = () => process.env.KIMONO_COMPOSIO_API || "https://backend.composio.dev/api/v3.1";
/* How long a stored session is trusted before Composio is asked whether it still knows it. */
const recheckAfter = 60 * 60 * 1000;

export type ToolSession = { url: string; headers: Record<string, string> };
type Stored = { session_id: string; mcp_url: string; key_hash: string; checked_at: number };
type Answer = { session_id?: string; mcp?: { type?: string; url?: string } };

/* The session's settings are part of what it was made with: change them, and old sessions are made again. */
const sessionVersion = "3";
const hashOf = (key: string) => createHash("sha256").update(`${sessionVersion}:${key}`).digest("hex").slice(0, 16);

/** Who a person is to Composio: stable, and distinct between Kimono servers sharing one Composio project. */
export function composioUser(username: string, origin: string) {
  return `kimono:${new URL(origin).host}:${username}`;
}

async function call(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${api()}${path}`, {
    ...init,
    headers: { "x-api-key": key, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
}

async function create(key: string, username: string, origin: string): Promise<Answer> {
  const response = await call(key, "/tool_router/session", {
    method: "POST",
    body: JSON.stringify({
      user_id: composioUser(username, origin),
      /* Composio connects accounts itself: its tools hand the agent a link, and the link comes back here. */
      manage_connections: { enable: true, callback_url: `${origin}/code?connections=1` },
      /* No remote workbench: it runs code on Composio's machines with the internet, around "never the web". */
      workbench: { enable: false },
    }),
  });
  if (!response.ok) throw new Error(`Composio said ${response.status} to a new session`);
  return response.json() as Promise<Answer>;
}

/**
 * A person's tool session, or null when Composio isn't set up or can't be
 * reached (the agent then simply has no outside tools this turn).
 */
export async function toolSession(db: DatabaseSync, key: string, username: string, origin: string, now = Date.now()): Promise<ToolSession | null> {
  if (!key) return null;
  const keyHash = hashOf(key);
  const headers = { "x-api-key": key };
  try {
    const stored = db.prepare("SELECT session_id, mcp_url, key_hash, checked_at FROM tool_sessions WHERE username = ?").get(username) as Stored | undefined;
    if (stored && stored.key_hash === keyHash) {
      if (now - stored.checked_at < recheckAfter) return { url: stored.mcp_url, headers };
      const response = await call(key, `/tool_router/session/${encodeURIComponent(stored.session_id)}`);
      if (response.ok) {
        const answer = await response.json() as Answer;
        const url = answer.mcp?.url || stored.mcp_url;
        db.prepare("UPDATE tool_sessions SET mcp_url = ?, checked_at = ? WHERE username = ?").run(url, now, username);
        return { url, headers };
      }
      if (response.status !== 404 && response.status !== 400) return { url: stored.mcp_url, headers };
      /* Composio no longer knows it: make another. */
    }
    const answer = await create(key, username, origin);
    if (!answer.session_id || !answer.mcp?.url) throw new Error("Composio's answer had no session");
    db.prepare(`INSERT INTO tool_sessions (username, key_hash, session_id, mcp_url, checked_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (username) DO UPDATE SET key_hash = excluded.key_hash, session_id = excluded.session_id, mcp_url = excluded.mcp_url, checked_at = excluded.checked_at`)
      .run(username, keyHash, answer.session_id, answer.mcp.url, now);
    return { url: answer.mcp.url, headers };
  } catch (error) {
    console.warn("Composio session:", error instanceof Error ? error.message : error);
    return null;
  }
}

/* ── how a toolkit looks: its name and logo, as Composio has them ── */

type Look = { name: string; logo: string };
const looks = new Map<string, { look: Look; at: number }>();
const day = 24 * 60 * 60 * 1000;

/** "googlecalendar" → "Googlecalendar": only when Composio can't be asked. */
const plainName = (slug: string) => slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** A toolkit's display name and logo from Composio's toolkit API, kept a day; its logo service when the API can't be reached. */
export async function toolkitLook(key: string, raw: string, now = Date.now()): Promise<Look> {
  const slug = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
  const fallback = { name: plainName(slug), logo: `https://logos.composio.dev/api/${encodeURIComponent(slug)}` };
  if (!slug) return fallback;
  const cached = looks.get(slug);
  if (cached && now - cached.at < day) return cached.look;
  let look = fallback;
  if (key) {
    try {
      const response = await fetch(`${api().replace(/\/v3\.1$/, "/v3")}/toolkits/${encodeURIComponent(slug)}`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
      if (response.ok) {
        const toolkit = await response.json() as { name?: string; meta?: { logo?: string } };
        look = { name: toolkit.name || fallback.name, logo: toolkit.meta?.logo?.startsWith("https://") ? toolkit.meta.logo : fallback.logo };
      }
    } catch { /* the fallback will do */ }
  }
  looks.set(slug, { look, at: now });
  return look;
}

/* ── a person's connections, as Composio keeps them for their session ── */

export type Connection = { app: string; name: string; logo: string; account: string; status: string; since: string | null };
export type App = { app: string; name: string; logo: string; description: string; connected: boolean };
type SessionToolkit = { slug: string; name: string; meta?: { logo?: string; description?: string }; connected_account?: { id: string; status?: string; created_at?: string } | null };

export class ConnectionProblem extends Error {
  readonly status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

/* Session-scoped calls are in Composio's v3 API reference. */
const v3 = () => api().replace(/\/v3\.1$/, "/v3");

/** The person's session id, made (and stored) if they have none. */
async function sessionIdFor(db: DatabaseSync, key: string, username: string, origin: string): Promise<string> {
  if (!key) throw new ConnectionProblem("Connections aren't set up on this Kimono.", 409);
  const session = await toolSession(db, key, username, origin);
  const stored = db.prepare("SELECT session_id FROM tool_sessions WHERE username = ?").get(username) as { session_id?: string } | undefined;
  if (!session || !stored?.session_id) throw new ConnectionProblem("Connections can't be reached right now.");
  return stored.session_id;
}

async function sessionToolkits(key: string, session: string, query: Record<string, string>): Promise<SessionToolkit[]> {
  const url = new URL(`${v3()}/tool_router/session/${encodeURIComponent(session)}/toolkits`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const response = await fetch(url, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(15_000), cache: "no-store" }).catch(() => null);
  if (!response?.ok) throw new ConnectionProblem("Connections can't be reached right now.");
  return ((await response.json()) as { items?: SessionToolkit[] }).items ?? [];
}

const logoOf = (t: SessionToolkit) => t.meta?.logo?.startsWith("https://") ? t.meta.logo : `https://logos.composio.dev/api/${encodeURIComponent(t.slug)}`;

/** The apps the person has connected. */
export async function connections(db: DatabaseSync, key: string, username: string, origin: string): Promise<Connection[]> {
  const session = await sessionIdFor(db, key, username, origin);
  return (await sessionToolkits(key, session, { is_connected: "true", limit: "50" }))
    .filter((t) => t.connected_account?.id)
    .map((t) => ({ app: t.slug, name: t.name, logo: logoOf(t), account: t.connected_account!.id, status: t.connected_account!.status ?? "ACTIVE", since: t.connected_account!.created_at ?? null }));
}

/** Apps the person could connect, found by name; what they already have says so. */
export async function findApps(db: DatabaseSync, key: string, username: string, origin: string, search: string): Promise<App[]> {
  const session = await sessionIdFor(db, key, username, origin);
  const query: Record<string, string> = { limit: "24" };
  if (search.trim()) query.search = search.trim().slice(0, 80);
  return (await sessionToolkits(key, session, query)).map((t) => ({ app: t.slug, name: t.name, logo: logoOf(t), description: t.meta?.description ?? "", connected: Boolean(t.connected_account?.id) }));
}

/** A link where the person connects an app; it comes back to Connections when they're done. */
export async function connectLink(db: DatabaseSync, key: string, username: string, origin: string, app: string): Promise<string> {
  const slug = app.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
  if (!slug) throw new ConnectionProblem("Pick an app.", 400);
  const session = await sessionIdFor(db, key, username, origin);
  const response = await fetch(`${v3()}/tool_router/session/${encodeURIComponent(session)}/link`, {
    method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000), cache: "no-store",
    body: JSON.stringify({ toolkit: slug, callback_url: `${origin}/code?connections=1` }),
  }).catch(() => null);
  if (!response?.ok) throw new ConnectionProblem("That app can't be connected right now.");
  const link = ((await response.json()) as { redirect_url?: string }).redirect_url;
  if (!link?.startsWith("https://")) throw new ConnectionProblem("That app can't be connected right now.");
  return link;
}

/** Disconnects one of the person's own apps; an account that isn't theirs isn't found. */
export async function disconnect(db: DatabaseSync, key: string, username: string, origin: string, account: string) {
  const mine = await connections(db, key, username, origin);
  if (!mine.some((c) => c.account === account)) throw new ConnectionProblem("That connection isn't yours, or it's gone.", 404);
  const response = await fetch(`${v3()}/connected_accounts/${encodeURIComponent(account)}`, { method: "DELETE", headers: { "x-api-key": key }, signal: AbortSignal.timeout(15_000), cache: "no-store" }).catch(() => null);
  if (!response?.ok) throw new ConnectionProblem("That connection couldn't be removed right now.");
}
