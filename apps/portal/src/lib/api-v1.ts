import "server-only";

import { auth } from "@/auth";
import { unreachable } from "./account";

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
  const status = message === unreachable ? 502 : 400;
  return apiError(status, message || fallback);
}
