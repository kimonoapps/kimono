/**
 * Finding skip intro, skip recap and the credits in the file itself, for
 * everything AniSkip doesn't cover (./markers.ts has the maths). The
 * packager reads the file through the Portal's relay; this decides what to
 * read and keeps what it found, per release (file name and size), so the
 * same file never needs reading twice.
 *
 * Play reads a release's chapters at once when it can (they're in the
 * file's head); everything slower runs in the background, one job at a
 * time: fingerprints of the opening and ending of this episode and one or
 * two others in its season, compared for what they share; then, for
 * credits still missing, the dark pictures near the end. A second release
 * of an episode already worked out only needs its opening fingerprinted, to
 * line it up with the first.
 */
import type { DatabaseSync } from "node:sqlite";
import { cached, keep } from "./model";
import {
  alignment, chapterMarkers, chooseMarkers, creditsFromFrames, creditsShare, endingWindow, introShare, lastChapterCredits, packPoints, printWindows,
  realFile, releaseKey, sharedSegment, shifted, unpackPoints, type Chapter, type Markers, type Print,
} from "./markers";
import type { Release } from "./releases";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type SkipDeps = {
  db: DatabaseSync;
  /** POSTs to the packager; null when it didn't answer or answered an error. */
  packager: (path: string, body: unknown, timeoutMs: number) => Promise<Json | null>;
  /** The address the packager reads a release from (the Portal's relay). */
  input: (release: Release) => string;
  /** The releases most likely played for another episode of the season, best first. */
  releasesOf: (season: number, episode: number) => Promise<Release[]>;
};

export type SkipTarget = {
  titleId: string;
  kind: "episode" | "film";
  season: number;
  episode: number;
  /** Episode numbers in this season, to find others to compare with. */
  seasonEpisodes: number[];
  release: Release;
  /** TMDB's runtime in minutes, for the guess when the file couldn't be read. */
  runtime: number | null;
};

/** What's known about one release. */
type Known = {
  duration: number | null;
  chapters: Chapter[];
  fingerprint?: Markers | null;
  frames?: number | null;
  /** Everything worth trying has been tried. */
  done?: boolean;
  ms?: number;
};

/** A release's fingerprints, for comparing with other episodes and other releases. */
type Prints = { titleId: string; season: number; episode: number; duration: number; head: { start: number; points: string }; tail: { start: number; points: string }; markers?: Markers | null };

const keepFor = 180 * 24 * 60 * 60 * 1000;
const knownKey = (rk: string) => `skips:release:${rk}`;
const printsKey = (rk: string) => `skips:prints:${rk}`;
const episodeKey = (titleId: string, season: number, episode: number) => `skips:episode:${titleId}:${season}:${episode}`;

const state = globalThis as unknown as { kimonoWatchSkips?: { queue: Promise<void>; queued: Set<string>; chapters: Map<string, Promise<Known | null>> } };
const work = (state.kimonoWatchSkips ??= { queue: Promise.resolve(), queued: new Set(), chapters: new Map() });

/**
 * The markers for a release as they stand: whatever is known, else its
 * chapters if they can be read within the time given, else a guess; and
 * the slower work started in the background.
 */
export async function skipsFor(deps: SkipDeps, target: SkipTarget, waitMs: number, base: Markers | null = null): Promise<Markers> {
  const rk = releaseKey(target.release);
  let known = cached<Known>(deps.db, knownKey(rk));
  if (!known && waitMs > 0) known = await Promise.race([readChapters(deps, target), new Promise<null>((done) => setTimeout(() => done(null), waitMs))]);
  if (!known?.done) analyseLater(deps, target);
  return answer(target, known, base);
}

/** Starts the background work for a release without waiting (prepare, for the next episode). */
export function analyseLater(deps: SkipDeps, target: SkipTarget) {
  const rk = releaseKey(target.release);
  if (work.queued.has(rk) || cached<Known>(deps.db, knownKey(rk))?.done) return;
  work.queued.add(rk);
  work.queue = work.queue.then(() => analyse(deps, target)).catch((error) => {
    console.warn("Watch couldn't work out skips:", error instanceof Error ? error.message : error);
  }).finally(() => { work.queued.delete(rk); });
}

function answer(target: SkipTarget, known: Known | null, base: Markers | null): Markers {
  const duration = known?.duration || (target.runtime ? target.runtime * 60 : null);
  return chooseMarkers({
    kind: target.kind, duration, aniskip: base,
    chapters: known ? chapterMarkers(known.chapters, duration ?? 0) : null,
    fingerprint: known?.fingerprint, frames: known?.frames,
    lastChapter: known ? lastChapterCredits(known.chapters, duration ?? 0, target.kind) : null,
  });
}

function readChapters(deps: SkipDeps, target: SkipTarget): Promise<Known | null> {
  const rk = releaseKey(target.release);
  const running = work.chapters.get(rk);
  if (running) return running;
  const reading = (async () => {
    const body = await deps.packager("/chapters", { input: deps.input(target.release) }, 45_000);
    if (!body || !Array.isArray(body.chapters)) return null;
    if (!realFile({ duration: Number(body.duration) || 0, size: Number(body.size) || undefined, audio: body.audio }, { bytes: target.release.bytes, minutes: target.runtime })) return null;
    const known: Known = {
      duration: Number(body.duration) || null,
      chapters: (body.chapters as Json[]).map((c) => ({ start: Number(c.start) || 0, end: Number(c.end) || 0, title: String(c.title ?? "") })),
    };
    /* Kept briefly until the rest is worked out, so a failed analysis is tried again another day. */
    keep(deps.db, knownKey(rk), known, 24 * 60 * 60 * 1000);
    return known;
  })().finally(() => work.chapters.delete(rk));
  work.chapters.set(rk, reading);
  return reading;
}

async function analyse(deps: SkipDeps, target: SkipTarget) {
  const rk = releaseKey(target.release);
  const started = Date.now();
  const known = cached<Known>(deps.db, knownKey(rk)) ?? (await readChapters(deps, target));
  if (!known?.duration) return;
  const fromChapters = chapterMarkers(known.chapters, known.duration);
  const needIntro = target.kind === "episode" && !fromChapters?.intro;
  const needCredits = fromChapters?.credits === undefined;
  if (target.kind === "episode" && (needIntro || needCredits) && known.fingerprint === undefined) {
    known.fingerprint = await fingerprintEpisode(deps, target, known.duration);
    if (known.fingerprint === undefined) return; // the packager failed: try again on a later play
  }
  if (needCredits && known.fingerprint?.credits === undefined && known.frames === undefined) {
    const window = endingWindow(known.duration, target.kind);
    const body = await deps.packager("/ending", { input: deps.input(target.release), ...window }, 25 * 60_000);
    if (!body || !Array.isArray(body.frames)) return;
    known.frames = creditsFromFrames(body.frames, body.silences ?? [], known.duration, target.kind);
  }
  known.done = true;
  known.ms = Date.now() - started;
  keep(deps.db, knownKey(rk), known, keepFor);
  const found = answer(target, known, null);
  console.info(`Watch skips for ${target.titleId} ${target.kind === "film" ? "" : `S${target.season}E${target.episode} `}in ${Math.round(known.ms / 1000)}s:`, JSON.stringify(found));
}

/* ───── Fingerprints ───── */

async function printRelease(deps: SkipDeps, release: Release, at: { titleId: string; season: number; episode: number }, duration: number | null, headOnly = false): Promise<Prints | null> {
  const rk = releaseKey(release);
  const kept = cached<Prints>(deps.db, printsKey(rk));
  if (kept && (headOnly || kept.tail.points)) return kept;
  if (!duration) {
    const body = await deps.packager("/chapters", { input: deps.input(release) }, 45_000);
    duration = Number(body?.duration) || null;
    if (!body || !duration || !realFile({ duration, size: Number(body.size) || undefined, audio: body.audio }, { bytes: release.bytes })) return null;
  }
  const windows = printWindows(duration);
  const take = async (w: { start: number; length: number }) => {
    const body = await deps.packager("/fingerprint", { input: deps.input(release), ...w }, 25 * 60_000);
    return body && Array.isArray(body.points) ? { start: Number(body.start) || w.start, points: packPoints(body.points as number[]) } : null;
  };
  const head = kept?.head ?? (await take(windows.head));
  if (!head) return null;
  const tail = headOnly ? { start: windows.tail.start, points: "" } : await take(windows.tail);
  if (!tail) return null;
  const prints: Prints = { ...at, duration, head, tail, markers: kept?.markers ?? null };
  keep(deps.db, printsKey(rk), prints, keepFor);
  const episodes = cached<string[]>(deps.db, episodeKey(at.titleId, at.season, at.episode)) ?? [];
  if (!episodes.includes(rk)) keep(deps.db, episodeKey(at.titleId, at.season, at.episode), [...episodes, rk].slice(-6), keepFor);
  return prints;
}

const unpack = (p: { start: number; points: string }): Print => ({ start: p.start, points: unpackPoints(p.points) });

/** Saves what a comparison found for another release, so playing it later needs nothing more. */
function remember(deps: SkipDeps, rk: string, prints: Prints, found: Markers) {
  const merged = { ...(prints.markers ?? {}), ...found };
  keep(deps.db, printsKey(rk), { ...prints, markers: merged }, keepFor);
  const known = cached<Known>(deps.db, knownKey(rk));
  if (known && !known.done) keep(deps.db, knownKey(rk), { ...known, fingerprint: { ...(known.fingerprint ?? {}), ...found } }, 24 * 60 * 60 * 1000);
}

/**
 * The intro and credits of an episode from fingerprints: lined up with
 * another release of it already worked out, else compared with up to two
 * other episodes of the season. Undefined when the packager failed.
 */
async function fingerprintEpisode(deps: SkipDeps, target: SkipTarget, duration: number): Promise<Markers | null | undefined> {
  const at = { titleId: target.titleId, season: target.season, episode: target.episode };
  const rk = releaseKey(target.release);

  /* Another release of this episode, already worked out: line them up. */
  const others = (cached<string[]>(deps.db, episodeKey(at.titleId, at.season, at.episode)) ?? []).filter((k) => k !== rk);
  for (const other of others) {
    const theirs = cached<Prints>(deps.db, printsKey(other));
    if (!theirs?.markers || !theirs.head.points) continue;
    const mine = await printRelease(deps, target.release, at, duration, true);
    if (!mine) return undefined;
    const by = alignment(unpack(theirs.head), unpack(mine.head));
    if (by !== null) {
      const found = shifted(theirs.markers, by, duration);
      remember(deps, rk, mine, found);
      return found;
    }
  }

  const mine = await printRelease(deps, target.release, at, duration);
  if (!mine) return undefined;
  if (mine.markers?.intro && mine.markers.credits !== undefined) return mine.markers;
  const found: Markers = { ...(mine.markers ?? {}) };
  const n = target.episode;
  const neighbours = [n + 1, n - 1, n + 2, n - 2].filter((e) => e !== n && target.seasonEpisodes.includes(e));
  let compared = 0;
  for (const e of neighbours) {
    if (compared >= 2 || (found.intro && found.credits !== undefined)) break;
    const otherAt = { ...at, episode: e };
    const keptKey = (cached<string[]>(deps.db, episodeKey(at.titleId, at.season, e)) ?? []).find((k) => cached<Prints>(deps.db, printsKey(k))?.tail.points);
    let theirs = keptKey ? cached<Prints>(deps.db, printsKey(keptKey)) : null;
    let theirKey = keptKey ?? null;
    if (!theirs) {
      /* The likeliest release that turns out to be a real file. */
      for (const release of (await deps.releasesOf(at.season, e).catch(() => [])).slice(0, 3)) {
        theirs = await printRelease(deps, release, otherAt, null);
        theirKey = releaseKey(release);
        if (theirs) break;
      }
      if (!theirs) continue;
    }
    compared++;
    const theirFound: Markers = {};
    if (!found.intro) {
      const shared = sharedSegment(unpack(mine.head), unpack(theirs.head), introShare);
      if (shared) { found.intro = shared.a; theirFound.intro = shared.b; }
    }
    if (found.credits === undefined && theirs.tail.points) {
      const shared = sharedSegment(unpack(mine.tail), unpack(theirs.tail), creditsShare);
      if (shared) { found.credits = shared.a[0]; theirFound.credits = shared.b[0]; }
    }
    if (theirKey && Object.keys(theirFound).length) remember(deps, theirKey, theirs, theirFound);
  }
  const result = Object.keys(found).length ? found : null;
  if (result) remember(deps, rk, mine, result);
  return result;
}
