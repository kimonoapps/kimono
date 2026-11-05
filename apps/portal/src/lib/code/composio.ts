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

const hashOf = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 16);

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
      manage_connections: { enable: true, callback_url: `${origin}/code?connected=1` },
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
