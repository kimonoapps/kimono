import "server-only";

import { auth } from "@/auth";
import { unreachable } from "./account";
import { tooManyGuesses } from "./attempts";

/**
 * /api/v1 — the people's API, used by the account pages and the phone app.
 *
 * It answers in JSON, always: a success is the resource, a failure is
 * `{ error }` with a sentence a person can read. Today it accepts the Portal's
 * own session; the phone app's bearer token will be checked in this one place.
 */
export type ApiUser = { username: string; name?: string | null; email?: string | null; role: string };

export function apiError(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function apiUser(): Promise<ApiUser | null> {
  const session = await auth();
  if (!session?.user?.username) return null;
  return session.user;
}

export const unauthorized = () => apiError(401, "Sign in to Kimono first.");

export function failure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  /* The directory being down is the server's problem, not the request's. */
  const status = message === unreachable ? 502 : message === tooManyGuesses ? 429 : 400;
  return apiError(status, message || fallback);
}

/**
 * A browser request that changes something must come from Kimono's own pages.
 * The session cookie is already withheld from other sites; this refuses them
 * outright as well. Requests without browser headers (the phone app) pass to
 * the authentication check like any other.
 */
export function crossSite(request: Request): Response | null {
  if (request.headers.get("sec-fetch-site") === "cross-site") return apiError(403, "Requests from other sites aren't accepted.");
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  try {
    if (new URL(origin).host !== host) return apiError(403, "Requests from other sites aren't accepted.");
  } catch {
    return apiError(403, "Requests from other sites aren't accepted.");
  }
  return null;
}

/** Reads at most `max` bytes, refusing as soon as the body runs past it. */
export async function readLimited(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > max) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

/** A small JSON body, sent as JSON. Anything else is refused before it is parsed. */
export async function readJson(request: Request): Promise<{ body: unknown } | { response: Response }> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return { response: apiError(415, "Send JSON.") };
  const bytes = await readLimited(request, 16 * 1024);
  if (!bytes) return { response: apiError(413, "That request is too large.") };
  try {
    return { body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { response: apiError(400, "Send JSON.") };
  }
}
