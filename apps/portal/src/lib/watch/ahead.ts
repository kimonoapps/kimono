/**
 * Work done before anyone presses play, so play starts at once.
 *
 *  - Streams found ahead: opening a title page searches for the episode
 *    Resume would play, and the apps call /watch/prepare most of the way
 *    through an episode so the next one is already found. The releases are
 *    kept for 20 minutes (the same cache play reads), and a search already
 *    under way is joined rather than started twice.
 *  - Whether a title plays at all: a quiet check, at most hourly and a few
 *    titles at a time, of the titles on Home's rows. A title with nothing to
 *    stream is left off Home for a day.
 *
 * Pure logic over SQLite and promises, tested in scripts/test-watch.mjs.
 */
import type { DatabaseSync } from "node:sqlite";
import { cached, keep, readState, writeState } from "./model";

/** How long found streams are trusted: debrid links and Usenet results don't last much longer. */
export const streamTtl = 20 * 60 * 1000;
/** How long a title's "plays / doesn't play" is trusted. */
export const playableTtl = 24 * 60 * 60 * 1000;

/** The cache key for one film (season and episode 0) or episode's releases. */
export const streamsKey = (titleId: string, season: number, episode: number) => `streams2:${titleId}:${season}:${episode}`;

/**
 * Runs `work` once per key at a time: a second caller while it runs gets the
 * same promise. The key is forgotten when the work settles.
 */
export function shared<T>(running: Map<string, Promise<T>>, key: string, work: () => Promise<T>): Promise<T> {
  const already = running.get(key);
  if (already) return already;
  const started = work().finally(() => running.delete(key));
  running.set(key, started);
  return started;
}

/**
 * Works through `items` with at most `concurrency` at once. `work` answering
 * false counts as a failure; after `stopAfter` failures in a row the rest are
 * left alone (the service is down, so asking more would only pile up).
 * Resolves with how many were worked on.
 */
export async function pool<T>(items: T[], concurrency: number, work: (item: T) => Promise<boolean>, stopAfter = 3): Promise<number> {
  let next = 0, done = 0, failures = 0;
  const lane = async () => {
    while (next < items.length && failures < stopAfter) {
      const item = items[next++];
      const ok = await work(item).catch(() => false);
      done++;
      failures = ok ? 0 : failures + 1;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, lane));
  return done;
}

/* ───── Plays or not ───── */

const playableKey = (titleId: string) => `playable:${titleId}`;

/** True or false when checked within the day, null when nobody knows yet. */
export function playableOf(db: DatabaseSync, titleId: string, now = Date.now()): boolean | null {
  const verdict = cached<boolean>(db, playableKey(titleId), now);
  return typeof verdict === "boolean" ? verdict : null;
}

export function notePlayable(db: DatabaseSync, titleId: string, playable: boolean, now = Date.now()) {
  keep(db, playableKey(titleId), playable, playableTtl, now);
}

/*
 * A source that answers but finds nothing for anything (a debrid key that
 * stopped working, an addon that blocks the server) must not brand every
 * title "no copy". Searches that came back empty in a row are counted; past
 * a handful, empty answers stop counting as verdicts, and the ones already
 * given are forgotten, as they are when the sources change.
 */
export const quietAfter = 5;
export function noteSearch(db: DatabaseSync, empty: boolean): number {
  const streak = empty ? (readState<{ empty: number }>(db, "searches")?.empty ?? 0) + 1 : 0;
  writeState(db, "searches", { empty: streak, at: Date.now() });
  if (streak === quietAfter) forgetNoCopy(db);
  return streak;
}
/** Whether the sources have found nothing for several searches in a row. */
export const sourcesQuiet = (db: DatabaseSync) => (readState<{ empty: number }>(db, "searches")?.empty ?? 0) >= quietAfter;
/** Forgets every "no copy" verdict, so each title is asked about again. */
export function forgetNoCopy(db: DatabaseSync) {
  db.prepare("DELETE FROM cache WHERE key LIKE 'playable:%' AND body = 'false'").run();
}

/** Anything found that isn't junk means it plays. */
export const anyPlayable = (found: { junk: boolean }[]) => found.some((r) => !r.junk);

/** The titles to check this run: not checked within the day, each once, in the order Home shows them, at most `cap`. */
export function toCheck(ids: string[], verdict: (id: string) => boolean | null, cap: number): string[] {
  return [...new Set(ids)].filter((id) => verdict(id) === null).slice(0, Math.max(0, cap));
}

/** Home leaves out only what is known not to play; unchecked titles stay until the check gets to them. */
export const visible = <T extends { id: string }>(titles: T[], verdict: (id: string) => boolean | null) => titles.filter((t) => verdict(t.id) !== false);
