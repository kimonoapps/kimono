import { readFileSync, statSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stateDir } from "./state";

/**
 * When each person last asked to be signed out everywhere.
 *
 * Portal sessions are signed cookies, so ending one means refusing it: a
 * session that signed in before this moment is no longer honoured. Checked on
 * every request, so the file is read once and re-read only when it changes.
 */
const epochPath = join(stateDir, "session-epochs.json");
let cached: { mtimeMs: number; epochs: Record<string, number> } | null = null;

function epochs(): Record<string, number> {
  try {
    const { mtimeMs } = statSync(epochPath);
    if (cached?.mtimeMs === mtimeMs) return cached.epochs;
    const parsed = JSON.parse(readFileSync(epochPath, "utf8")) as { epochs?: Record<string, number> };
    cached = { mtimeMs, epochs: parsed.epochs && typeof parsed.epochs === "object" ? parsed.epochs : {} };
    return cached.epochs;
  } catch {
    return {};
  }
}

/** Sessions for this person that signed in before this time are refused. */
export function signedOutBefore(username: string): number {
  const value = epochs()[username.toLowerCase()];
  return typeof value === "number" ? value : 0;
}

export async function signOutEverywhere(username: string, at = Date.now()) {
  const next = { ...epochs(), [username.toLowerCase()]: at };
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const temporary = `${epochPath}.new`;
  await writeFile(temporary, `${JSON.stringify({ epochs: next }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, epochPath);
  cached = null;
}

/* ─── single sessions ───
   Signing out ends one Portal session: its ID goes on this list until the
   moment the session would have expired anyway, so a copy of the cookie made
   before signing out is refused too. */
const revokedPath = join(stateDir, "revoked-sessions.json");
let revokedCache: { mtimeMs: number; revoked: Record<string, number> } | null = null;

function revoked(): Record<string, number> {
  try {
    const { mtimeMs } = statSync(revokedPath);
    if (revokedCache?.mtimeMs === mtimeMs) return revokedCache.revoked;
    const parsed = JSON.parse(readFileSync(revokedPath, "utf8")) as { revoked?: Record<string, number> };
    revokedCache = { mtimeMs, revoked: parsed.revoked && typeof parsed.revoked === "object" ? parsed.revoked : {} };
    return revokedCache.revoked;
  } catch {
    return {};
  }
}

export function isRevoked(sessionId: string): boolean {
  return Boolean(revoked()[sessionId]);
}

/** Refuses this session from now on. `expiresAt` (ms) is when the entry can be forgotten. */
export async function revokeSession(sessionId: string, expiresAt: number) {
  const now = Date.now();
  const kept = Object.fromEntries(Object.entries(revoked()).filter(([, until]) => until > now));
  kept[sessionId] = Math.max(expiresAt, now + 60_000);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const temporary = `${revokedPath}.new`;
  await writeFile(temporary, `${JSON.stringify({ revoked: kept }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, revokedPath);
  revokedCache = null;
}
