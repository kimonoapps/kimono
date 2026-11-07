import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

/*
 * State files are read, changed and written back by whoever asks: two requests
 * doing that at once would each write their own copy and one change would be
 * lost. Work under one key waits for the work before it, one after another, in
 * the order it was asked for. The chains live on globalThis so a dev reload of
 * this module doesn't start a second set beside the first.
 */
const chains: Map<string, Promise<unknown>> = ((globalThis as { __kimonoSerial?: Map<string, Promise<unknown>> }).__kimonoSerial ??= new Map());

export function serialize<T>(key: string, work: () => Promise<T> | T): Promise<T> {
  const before = chains.get(key) ?? Promise.resolve();
  const turn = before.then(() => work(), () => work());
  const settled = turn.then(() => {}, () => {});
  chains.set(key, settled);
  /* The last one out leaves nothing behind. */
  void settled.then(() => { if (chains.get(key) === settled) chains.delete(key); });
  return turn;
}

/** Writes beside the file under a name no other writer shares, then swaps it in whole: a reader sees the old file or the new one, never half of one. */
export async function writeFileAtomic(path: string, data: string | Uint8Array, mode = 0o600) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.new`;
  try {
    await writeFile(temporary, data, { mode });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** One fetch for everyone who asks while it's under way. */
export function singleFlight<T>(work: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => (running ??= work().finally(() => { running = null; }));
}
