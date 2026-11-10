/**
 * Watch's health, for admins: whether TMDB, AIOStreams and nzbdav answer,
 * whether Kimono set up the streaming services and when, and the last thing
 * that went wrong. Read by GET /api/v1/watch/status.
 *
 * Reading probes and kept state is pure, tested in scripts/test-watch.mjs.
 */
import type { DatabaseSync } from "node:sqlite";
import { readState, writeState } from "./model";

export type Probe = { ok: boolean; ms: number | null; problem: string | null };

/** Any HTTP answer below 500 means the service is up (a 401 or 404 still came from it). */
export function probeOf(status: number | null, ms: number | null, down: string): Probe {
  if (status === null) return { ok: false, ms: null, problem: down };
  return status < 500 ? { ok: true, ms, problem: null } : { ok: false, ms, problem: `${down} (it answered ${status}).` };
}

export async function probe(url: string, down: string, init: RequestInit = {}): Promise<Probe> {
  const started = Date.now();
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5_000) }).catch(() => null);
  await response?.body?.cancel().catch(() => {});
  return probeOf(response ? response.status : null, response ? Date.now() - started : null, down);
}

/* ───── The last thing that went wrong ───── */

export type LastError = { message: string; at: number };

export function noteError(db: DatabaseSync, message: string, now = Date.now()) {
  writeState(db, "last-error", { message: message.slice(0, 500), at: now } satisfies LastError);
}
export const lastError = (db: DatabaseSync) => readState<LastError>(db, "last-error");
