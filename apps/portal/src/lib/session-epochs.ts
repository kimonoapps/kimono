import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { serialize, writeFileAtomic } from "./serial";
import { stateDir } from "./state";

/*
 * Both lists are checked on every request. Only this process writes them, so
 * each is read from disk once and then kept in memory, changed in place by the
 * writes below: no file is touched on the way to answering a request.
 */
type Held<T> = { value: T | null; loading: Promise<T> | null };
async function load<T>(held: Held<T>, path: string, pick: (parsed: Record<string, unknown>) => T, empty: () => T): Promise<T> {
  if (held.value) return held.value;
  held.loading ??= readFile(path, "utf8").then(
    (text) => pick(JSON.parse(text) as Record<string, unknown>),
    () => empty(),
  ).catch(() => empty()).then((value) => { held.value ??= value; held.loading = null; return held.value; });
  return held.loading;
}
const record = (value: unknown) => value && typeof value === "object" ? value as Record<string, number> : {};

/**
 * When each person last asked to be signed out everywhere.
 *
 * Portal sessions are signed cookies, so ending one means refusing it: a
 * session that signed in before this moment is no longer honoured.
 */
const epochPath = join(stateDir, "session-epochs.json");
type Epochs = { at: Record<string, number>; kept: Record<string, string> };
const epochsHeld: Held<Epochs> = { value: null, loading: null };
const epochs = () => load(epochsHeld, epochPath, (parsed) => ({ at: record(parsed.epochs), kept: kept(parsed.kept) }), (): Epochs => ({ at: {}, kept: {} }));
const kept = (value: unknown) => value && typeof value === "object" ? value as Record<string, string> : {};

/** Sessions for this person that signed in before this time are refused. */
export async function signedOutBefore(username: string): Promise<number> {
  const value = (await epochs()).at[username.toLowerCase()];
  return typeof value === "number" ? value : 0;
}

/** Whether a session that began at [signedInAt] is still honoured: the one that signed everyone else out is. */
export async function honouredSince(username: string, signedInAt: number, sessionId: string | undefined): Promise<boolean> {
  const held = await epochs();
  const key = username.toLowerCase();
  const at = held.at[key];
  if (typeof at !== "number" || signedInAt >= at) return true;
  return Boolean(sessionId) && held.kept[key] === sessionId;
}

/** Refuses every session this person has; [keep] names the one that asked, which stays in. */
export function signOutEverywhere(username: string, at = Date.now(), keep?: string) {
  return serialize(epochPath, async () => {
    const key = username.toLowerCase();
    const current = await epochs();
    const next: Epochs = { at: { ...current.at, [key]: at }, kept: { ...current.kept } };
    if (keep) next.kept[key] = keep;
    else delete next.kept[key];
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await writeFileAtomic(epochPath, `${JSON.stringify({ epochs: next.at, kept: next.kept }, null, 2)}\n`, 0o600);
    epochsHeld.value = next;
  });
}

/* ─── single sessions ───
   Signing out ends one Portal session: its ID goes on this list until the
   moment the session would have expired anyway, so a copy of the cookie made
   before signing out is refused too. */
const revokedPath = join(stateDir, "revoked-sessions.json");
const revokedHeld: Held<Record<string, number>> = { value: null, loading: null };
const revoked = () => load(revokedHeld, revokedPath, (parsed) => record(parsed.revoked), (): Record<string, number> => ({}));

export async function isRevoked(sessionId: string): Promise<boolean> {
  return Boolean((await revoked())[sessionId]);
}

/** Refuses this session from now on. `expiresAt` (ms) is when the entry can be forgotten. */
export function revokeSession(sessionId: string, expiresAt: number) {
  return serialize(revokedPath, async () => {
    const now = Date.now();
    const kept = Object.fromEntries(Object.entries(await revoked()).filter(([, until]) => until > now));
    kept[sessionId] = Math.max(expiresAt, now + 60_000);
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await writeFileAtomic(revokedPath, `${JSON.stringify({ revoked: kept }, null, 2)}\n`, 0o600);
    revokedHeld.value = kept;
  });
}
