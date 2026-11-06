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

/*
 * Composio's Instant tools run on Composio's own provider accounts and are
 * charged to its balance, so nobody connects anything. Every Instant tool is
 * allowed (an empty policy); each person has a monthly allowance for them (media.ts).
 */
export const instantPolicy = {};

/* The session's settings are part of what it was made with: change them, and old sessions are made again. */
const sessionVersion = "4";
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
      instant: instantPolicy,
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
    /* A new session starts with Instant on; media.ts closes it again if this month's allowance is spent. */
    db.prepare(`INSERT INTO tool_sessions (username, key_hash, session_id, mcp_url, checked_at, instant) VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT (username) DO UPDATE SET key_hash = excluded.key_hash, session_id = excluded.session_id, mcp_url = excluded.mcp_url, checked_at = excluded.checked_at, instant = 1`)
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

/* ── one app in full: what it is, and what Kimono AI can do with it ── */

export type AppDetails = Look & { app: string; description: string; categories: string[]; tools: { name: string; description: string }[]; toolCount: number | null };
const details = new Map<string, { found: AppDetails; at: number }>();

/** A tool's own words, cut to its first sentence, without Composio's notes to the agent. */
const firstSentence = (text: string) => {
  const words = text.replace(/^\s*\[[^\]]*\]\s*/, "").replace(/^Tool to (\w)/, (_, c: string) => c.toUpperCase());
  const sentence = words.split(/(?<=\.)\s/)[0].replace(/\s*(\.\.\.|…)$/, "").trim();
  return sentence.length <= 160 ? sentence : `${sentence.slice(0, 160).replace(/\s+\S*$/, "")}…`;
};

/** A tool's name from its slug: GOOGLECALENDAR_FIND_FREE_SLOTS is "Find free slots". */
const nameFromSlug = (toolkit: string, slug: string) => {
  const words = slug.replace(new RegExp(`^${toolkit}_`, "i"), "").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

type CatalogTool = { slug: string; description?: string; tags?: string[]; is_deprecated?: boolean; toolkit?: { slug?: string } };

/**
 * Every tool a toolkit has. Kimono's key may not list tools directly, so this
 * asks a session of its own, open to that one toolkit with all its tools
 * loaded, which lists them in full. Nobody's connections are in it.
 */
async function allTools(key: string, slug: string): Promise<{ name: string; description: string }[]> {
  const made = await call(key, "/tool_router/session", {
    method: "POST",
    body: JSON.stringify({ user_id: "kimono:catalog", toolkits: { enable: [slug] }, preload: { tools: "all" }, workbench: { enable: false } }),
  }).catch(() => null);
  const session = made?.ok ? ((await made.json()) as Answer).session_id : undefined;
  if (!session) return [];
  const found: CatalogTool[] = [];
  let cursor: string | null = null;
  do {
    const url = new URL(`${api()}/tool_router/session/${encodeURIComponent(session)}/tools`);
    url.searchParams.set("limit", "500");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(15_000), cache: "no-store" }).catch(() => null);
    if (!response?.ok) break;
    const page = (await response.json()) as { items?: CatalogTool[]; next_cursor?: string | null };
    found.push(...(page.items ?? []));
    cursor = page.next_cursor || null;
  } while (cursor && found.length < 2000);
  /* Composio marks the tools people reach for most; those come first. */
  const important = (t: CatalogTool) => t.tags?.includes("important") ? 0 : 1;
  return found
    .filter((t) => t.slug && (t.toolkit?.slug ?? "").toLowerCase() === slug && !t.is_deprecated)
    .sort((x, y) => important(x) - important(y) || x.slug.localeCompare(y.slug))
    .map((t) => ({ name: nameFromSlug(slug, t.slug), description: firstSentence(t.description ?? "") }));
}

/** A toolkit's description, categories and all its tools, kept a day; just its look when the API can't be reached. */
export async function toolkitDetails(key: string, raw: string, now = Date.now()): Promise<AppDetails> {
  const slug = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
  const cached = details.get(slug);
  if (cached && now - cached.at < day) return cached.found;
  const look = await toolkitLook(key, slug, now);
  let found: AppDetails = { ...look, app: slug, description: "", categories: [], tools: [], toolCount: null };
  if (key && slug) {
    const [toolkit, tools] = await Promise.all([
      fetch(`${v3()}/toolkits/${encodeURIComponent(slug)}`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(8_000), cache: "no-store" })
        .then((r) => r.ok ? r.json() : null, () => null) as Promise<{ meta?: { description?: string; categories?: { name?: string }[]; tools_count?: number } } | null>,
      allTools(key, slug),
    ]);
    found = {
      ...found,
      description: toolkit?.meta?.description ?? "",
      categories: (toolkit?.meta?.categories ?? []).map((c) => c.name ?? "").filter(Boolean).slice(0, 4),
      toolCount: tools.length || (typeof toolkit?.meta?.tools_count === "number" ? toolkit.meta.tools_count : null),
      tools,
    };
    if (toolkit && tools.length) details.set(slug, { found, at: now });
  }
  return found;
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
  return (await sessionToolkitPage(key, session, query)).items;
}

/** One page of the session's toolkits, and the cursor for the next (null at the end). */
async function sessionToolkitPage(key: string, session: string, query: Record<string, string>): Promise<{ items: SessionToolkit[]; next: string | null }> {
  const url = new URL(`${v3()}/tool_router/session/${encodeURIComponent(session)}/toolkits`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const response = await fetch(url, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(15_000), cache: "no-store" }).catch(() => null);
  if (!response?.ok) throw new ConnectionProblem("Connections can't be reached right now.");
  const page = (await response.json()) as { items?: SessionToolkit[]; next_cursor?: string | null };
  return { items: page.items ?? [], next: page.next_cursor || null };
}

const logoOf = (t: SessionToolkit) => t.meta?.logo?.startsWith("https://") ? t.meta.logo : `https://logos.composio.dev/api/${encodeURIComponent(t.slug)}`;

/** The apps the person has connected. */
export async function connections(db: DatabaseSync, key: string, username: string, origin: string): Promise<Connection[]> {
  const session = await sessionIdFor(db, key, username, origin);
  return (await sessionToolkits(key, session, { is_connected: "true", limit: "50" }))
    .filter((t) => t.connected_account?.id)
    .map((t) => ({ app: t.slug, name: t.name, logo: logoOf(t), account: t.connected_account!.id, status: t.connected_account!.status ?? "ACTIVE", since: t.connected_account!.created_at ?? null }));
}

/** A page of apps the person could connect, found by name; what they already have says so. `next` asks for the page after. */
export async function findApps(db: DatabaseSync, key: string, username: string, origin: string, search: string, cursor?: string | null): Promise<{ apps: App[]; next: string | null }> {
  const session = await sessionIdFor(db, key, username, origin);
  const query: Record<string, string> = { limit: "24" };
  if (search.trim()) query.search = search.trim().slice(0, 80);
  if (cursor) query.cursor = cursor.slice(0, 200);
  const page = await sessionToolkitPage(key, session, query);
  return { next: page.next, apps: page.items.map((t) => ({ app: t.slug, name: t.name, logo: logoOf(t), description: t.meta?.description ?? "", connected: Boolean(t.connected_account?.id) })) };
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

/* ── Instant: what a person spent, and switching it off and on ── */

/** One Instant charge: when (ms) and how much, in millionths of a dollar. */
export type InstantCharge = { at: number; micros: number };
const spends = new Map<string, { from: number; spent: number; at: number; charges: InstantCharge[] }>();

type ExecutionLog = { timestamp?: string; metadata?: { credential_source?: string; instant_charge?: string } };

/**
 * What a person's Instant tools cost since `from`, in US dollars, from
 * Composio's execution logs (by their Composio user, so it spans every session
 * they had). Kept for `fresh` ms; null when the logs can't be read.
 */
export async function instantSpent(key: string, username: string, origin: string, from: number, now = Date.now(), fresh = 60_000): Promise<number | null> {
  if (!key) return null;
  const cached = spends.get(username);
  if (cached && cached.from === from && now - cached.at < fresh) return cached.spent;
  /* Millionths of a dollar, so adding up many small charges stays exact. */
  let micros = 0;
  const charges: InstantCharge[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const response = await call(key, "/logs/tool_execution", {
      method: "POST",
      body: JSON.stringify({ limit: 100, cursor, filters: [{ field: "user_id", operator: "==", value: composioUser(username, origin) }], time_range: { from, to: now } }),
    }).catch(() => null);
    if (!response?.ok) return cached?.from === from ? cached.spent : null;
    const answer = (await response.json()) as { logs?: ExecutionLog[]; next_cursor?: string | null };
    for (const log of answer.logs ?? []) {
      const charge = Number(log.metadata?.instant_charge);
      if (log.metadata?.credential_source !== "instant_account" || !Number.isFinite(charge) || charge <= 0) continue;
      const amount = Math.round(charge * 1_000_000);
      micros += amount;
      const at = Date.parse(log.timestamp ?? "");
      if (Number.isFinite(at)) charges.push({ at, micros: amount });
    }
    cursor = answer.next_cursor || null;
    if (!cursor || !(answer.logs ?? []).length) break;
  }
  const spent = micros / 1_000_000;
  spends.set(username, { from, spent, at: now, charges });
  return spent;
}

/** The person's Instant charges since `from`, as last read by instantSpent. */
export const instantCharges = (username: string, from: number): InstantCharge[] => {
  const cached = spends.get(username);
  return cached?.from === from ? cached.charges : [];
};

/** Whether the person's session may use Instant tools now, as Kimono last set it. */
export function instantOpen(db: DatabaseSync, username: string): boolean | null {
  const stored = db.prepare("SELECT instant FROM tool_sessions WHERE username = ?").get(username) as { instant?: number } | undefined;
  return stored ? stored.instant === 1 : null;
}

/** Opens or closes Instant on the person's session; Composio then holds to it, whatever the agent tries. */
export async function setInstant(db: DatabaseSync, key: string, username: string, open: boolean): Promise<boolean> {
  const stored = db.prepare("SELECT session_id, instant FROM tool_sessions WHERE username = ?").get(username) as { session_id?: string; instant?: number } | undefined;
  if (!key || !stored?.session_id) return false;
  if ((stored.instant === 1) === open) return true;
  const response = await call(key, `/tool_router/session/${encodeURIComponent(stored.session_id)}`, {
    method: "PATCH",
    body: JSON.stringify({ instant: open ? instantPolicy : false }),
  }).catch(() => null);
  if (!response?.ok) {
    console.warn(`Composio said ${response?.status ?? "nothing"} to switching Instant ${open ? "on" : "off"}`);
    return false;
  }
  db.prepare("UPDATE tool_sessions SET instant = ? WHERE username = ?").run(open ? 1 : 0, username);
  return true;
}

const instantKits = new Map<string, { yes: boolean; at: number }>();

/** Whether a toolkit has any Instant tools, as Composio's catalog says; kept a day. False when it can't be asked. */
export async function instantToolkit(key: string, raw: string, now = Date.now()): Promise<boolean> {
  const slug = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
  if (!key || !slug) return false;
  const cached = instantKits.get(slug);
  if (cached && now - cached.at < day) return cached.yes;
  const response = await call(key, `/toolkits/${encodeURIComponent(slug)}`).catch(() => null);
  if (!response?.ok) return cached?.yes ?? false;
  const yes = ((await response.json()) as { instant?: { supported?: boolean } | null }).instant?.supported === true;
  instantKits.set(slug, { yes, at: now });
  return yes;
}
