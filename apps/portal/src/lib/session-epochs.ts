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
