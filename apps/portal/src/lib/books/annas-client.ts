import "server-only";

import { BooksProblem } from "./model";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/* Anna's turns away requests that name themselves as an app (from a server's address, at least), so it's asked as a browser would. */
export const annasUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type Session = { cookie: string; at: number };
const sessions = new Map<string, Session>();
const sessionLife = 6 * 60 * 60 * 1000;

/** A signed-in Anna's Archive connection. Its secret never leaves this origin. */
export function annasClient(base: string, secret: string) {
  const origin = new URL(base).origin;

  async function session(): Promise<string> {
    const known = sessions.get(origin);
    if (known && Date.now() - known.at < sessionLife) return known.cookie;
    const res = await fetch(`${origin}/account/`, {
      method: "POST",
      headers: { "user-agent": annasUserAgent, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key: secret }),
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    const cookies = res.headers.getSetCookie().map((c) => c.split(";", 1)[0]).filter(Boolean);
    if (!cookies.some((c) => c.startsWith("aa_account_id2="))) throw new BooksProblem(`Anna's Archive didn't sign in (${res.status}). Check its address and key.`);
    const cookie = cookies.join("; ");
    sessions.set(origin, { cookie, at: Date.now() });
    return cookie;
  }

  async function get(path: string, json: true): Promise<Json | null>;
  async function get(path: string, json: false): Promise<string | null>;
  async function get(path: string, json: boolean): Promise<string | Json | null> {
    const res = await fetch(`${origin}${path}`, {
      headers: { "user-agent": annasUserAgent, cookie: await session(), accept: json ? "application/json" : "text/html" },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) { sessions.delete(origin); throw new BooksProblem(`Anna's Archive refused (${res.status}).`); }
    if (!res.ok) throw new BooksProblem(`Anna's Archive: ${res.status}`);
    return json ? await res.json() as Json : await res.text();
  }

  return { origin, get };
}
