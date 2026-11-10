/**
 * Skip intro, recap and credits: where they are in an episode, in seconds.
 *
 * Anime has AniSkip, a shared database of opening, ending and recap times
 * keyed by MyAnimeList id and episode. Episodes are matched the way filler
 * flags are (flagFillers in ./index.ts): a MyAnimeList entry that is
 * exactly one TMDB season counts from 1 in it; one long entry for the whole
 * show counts from the very first episode.
 *
 * Everything else, and anime AniSkip doesn't know, is found from the file
 * itself (./skips.ts runs it, the packager reads the file):
 *
 *   1. chapters named Opening, Recap, Ending and so on (exact when there);
 *   2. audio fingerprints across a season: the stretch two episodes share
 *      near the start is the intro, near the end the credits;
 *   3. for credits still missing: the last stretch of dark pictures, then
 *      the last chapter, then a guess (the last 2% of an episode), marked
 *      so the players show the next-episode card more softly.
 *
 * The matching, maths and choosing are pure, tested in scripts/test-watch.mjs.
 */
import { createHash } from "node:crypto";
import type { AnimeEntry } from "./anime";
import type { Episode } from "./model";

export type MarkerSource = "aniskip" | "chapters" | "fingerprint" | "guess";

export type Markers = {
  intro?: [number, number];
  recap?: [number, number];
  credits?: number;
  /** Where the markers came from (the best of them when they're mixed). */
  source?: MarkerSource;
  /** Credits are only a guess at the last moments: show next-episode softly. */
  creditsGuess?: true;
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const aniskipUrl = (base: string, malId: number, episode: number) =>
  `${base}/skip-times/${malId}/${episode}?types=op&types=ed&types=recap&episodeLength=0`;

/** Which MyAnimeList entry and episode a TMDB episode is, or null when the anime map can't say. Films are episode 1. */
export function aniskipEpisode(
  entries: Pick<AnimeEntry, "malId" | "season">[],
  episodes: Pick<Episode, "season" | "number">[],
  at: { season: number; episode: number },
  movieMalId?: number | null,
): { malId: number; episode: number } | null {
  if (at.season === 0 && at.episode === 0) return movieMalId ? { malId: movieMalId, episode: 1 } : null;
  const forSeason = entries.find((e) => e.season === at.season && e.malId);
  if (forSeason?.malId) return { malId: forSeason.malId, episode: at.episode };
  if (entries.length !== 1 || !entries[0].malId) return null;
  const ordered = episodes.filter((e) => e.season > 0).slice().sort((a, b) => a.season - b.season || a.number - b.number);
  const index = ordered.findIndex((e) => e.season === at.season && e.number === at.episode);
  return index < 0 ? null : { malId: entries[0].malId, episode: index + 1 };
}

const seconds = (n: unknown) => Math.max(0, Math.round(Number(n) * 10) / 10);

/** AniSkip's answer as markers: the first opening, recap and ending it has. Null when it has none. */
export function markersFrom(body: Json): Markers | null {
  if (!body?.found || !Array.isArray(body.results)) return null;
  const markers: Markers = {};
  for (const r of body.results as Json[]) {
    const start = seconds(r.interval?.startTime), end = seconds(r.interval?.endTime);
    if (!(end > start) && r.skipType !== "ed") continue;
    if (r.skipType === "op" && !markers.intro) markers.intro = [start, end];
    else if (r.skipType === "recap" && !markers.recap) markers.recap = [start, end];
    else if (r.skipType === "ed" && markers.credits === undefined) markers.credits = start;
  }
  return Object.keys(markers).length ? markers : null;
}

/* ───── Chapters ───── */

export type Chapter = { start: number; end: number; title: string };
type ChapterKind = "intro" | "recap" | "credits" | "preview" | "generic" | "other";

/** What a chapter's name says it is. "Opening credits" is the intro; "Chapter 3" or a bare time says nothing. */
export function chapterKind(title: string): ChapterKind {
  const t = title.trim().toLowerCase().replace(/[_.]+/g, " ").replace(/\s+/g, " ");
  if (!t || /^(chapter|chap|ch|part|scene|kapitel|chapitre|capitulo|capítulo)?\s*[#-]?\s*\d+$/.test(t) || /^\d{1,2}:\d{2}(:\d{2})?([ ,]\d+)?$/.test(t)) return "generic";
  if (/^(previously|recap|summary|last time|story so far|前回|あらすじ)/.test(t)) return "recap";
  if (/(opening|main) (titles?|credits?)|^(op|opening|intro|introduction|title sequence|titles?|theme( song)?|オープニング|ＯＰ)(\s*\d+)?$|^opening (song|theme)|^(op|intro)\b/.test(t)) return "intro";
  if (/(^|\b)(end(ing)?|closing|final) credits?|^(ed|ending|credits?|outro|end titles|エンディング|ＥＤ)(\s*\d+)?$|^(ed|ending|credits)\b/.test(t)) return "credits";
  if (/^(preview|next (episode|time)|trailer|next week|予告)/.test(t)) return "preview";
  return "other";
}

const tenth = (n: number) => Math.round(n * 10) / 10;

/**
 * Markers from named chapters: the first intro of 5 seconds to 3 minutes,
 * the first recap of up to 5 minutes, and credits where the first ending
 * (or, failing that, a preview) chapter starts in the second half.
 */
export function chapterMarkers(chapters: Chapter[], duration: number): Markers | null {
  const list = chapters.filter((c) => c.end > c.start).slice().sort((a, b) => a.start - b.start);
  const markers: Markers = {};
  const length = (c: Chapter) => c.end - c.start;
  const intro = list.find((c) => chapterKind(c.title) === "intro" && length(c) >= 5 && length(c) <= 180);
  if (intro) markers.intro = [tenth(intro.start), tenth(intro.end)];
  const recap = list.find((c) => chapterKind(c.title) === "recap" && length(c) >= 5 && length(c) <= 300);
  if (recap) markers.recap = [tenth(recap.start), tenth(recap.end)];
  const late = (c: Chapter) => !duration || c.start >= duration * 0.5;
  const credits = list.find((c) => chapterKind(c.title) === "credits" && late(c)) ?? list.find((c) => chapterKind(c.title) === "preview" && late(c));
  if (credits) markers.credits = tenth(credits.start);
  return Object.keys(markers).length ? markers : null;
}

/**
 * The last chapter as the credits, for discs whose chapters have no names:
 * when it starts in the last 15% and runs as long as credits do (films 1 to
 * 15 minutes, episodes 20 seconds to 4).
 */
export function lastChapterCredits(chapters: Chapter[], duration: number, kind: "episode" | "film"): number | null {
  if (chapters.length < 3 || !duration) return null;
  const last = chapters.slice().sort((a, b) => a.start - b.start).at(-1)!;
  const kindOf = chapterKind(last.title);
  if (kindOf !== "generic" && kindOf !== "other") return null;
  const length = Math.min(last.end || duration, duration) - last.start;
  const [low, high] = kind === "film" ? [60, 900] : [20, 240];
  return last.start >= duration * 0.85 && length >= low && length <= high ? tenth(last.start) : null;
}

/* ───── Audio fingerprints (Chromaprint, as Jellyfin's Intro Skipper uses them) ───── */

/** Seconds each Chromaprint point covers. */
export const printStep = 0.1238;

function bits(x: number) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}

export type Print = { start: number; points: number[] };
export type Shared = { a: [number, number]; b: [number, number] };
export type ShareOptions = { minSeconds: number; maxSeconds: number; maxBits?: number; maxGap?: number };

/**
 * The longest stretch of sound two fingerprints share, in each one's own
 * seconds: points line up at some shift and differ by at most a few bits,
 * with gaps of up to a few seconds forgiven. Shifts are found by points
 * that match exactly. Null when nothing shared is long enough, or when it is
 * too long to be an intro (the same episode twice).
 */
export function sharedSegment(a: Print, b: Print, options: ShareOptions): Shared | null {
  const maxBits = options.maxBits ?? 6, gap = Math.round((options.maxGap ?? 3.5) / printStep);
  const index = new Map<number, number[]>();
  b.points.forEach((p, j) => { const at = index.get(p); if (at) { if (at.length < 64) at.push(j); } else index.set(p, [j]); });
  const votes = new Map<number, number>();
  a.points.forEach((p, i) => { for (const j of index.get(p) ?? []) votes.set(j - i, (votes.get(j - i) ?? 0) + 1); });
  const shifts = [...votes].sort((x, y) => y[1] - x[1]).slice(0, 64).map(([shift]) => shift);
  let best: { from: number; to: number; shift: number } | null = null;
  for (const shift of shifts) {
    let from = -1, last = -1;
    const close = (to: number) => { if (from >= 0 && (!best || to - from > best.to - best.from)) best = { from, to, shift }; };
    for (let i = Math.max(0, -shift); i < a.points.length && i + shift < b.points.length; i++) {
      if (bits((a.points[i] ^ b.points[i + shift]) >>> 0) > maxBits) continue;
      if (from < 0 || i - last > gap) { close(last); from = i; }
      last = i;
    }
    close(last);
  }
  if (!best) return null;
  const { from, to, shift } = best as { from: number; to: number; shift: number };
  const seconds = (to - from + 1) * printStep;
  if (seconds < options.minSeconds || seconds > options.maxSeconds) return null;
  return {
    a: [tenth(a.start + from * printStep), tenth(a.start + (to + 1) * printStep)],
    b: [tenth(b.start + (from + shift) * printStep), tenth(b.start + (to + shift + 1) * printStep)],
  };
}

export const introShare: ShareOptions = { minSeconds: 15, maxSeconds: 130 };
export const creditsShare: ShareOptions = { minSeconds: 15, maxSeconds: 600 };

/**
 * How far another release of the same episode runs ahead of a known one, in
 * seconds (positive: later in the other), from their opening minutes; null
 * when they don't line up for at least half a minute (a different cut, or
 * sped up for PAL).
 */
export function alignment(known: Print, other: Print): number | null {
  const shared = sharedSegment(known, other, { minSeconds: 30, maxSeconds: Infinity });
  return shared ? tenth(shared.b[0] - shared.a[0]) : null;
}

/** Markers moved by an alignment, kept inside the file. */
export function shifted(markers: Markers, by: number, duration: number): Markers {
  const at = (t: number) => tenth(Math.min(Math.max(0, t + by), duration || Infinity));
  const out: Markers = {};
  if (markers.intro) out.intro = [at(markers.intro[0]), at(markers.intro[1])];
  if (markers.recap) out.recap = [at(markers.recap[0]), at(markers.recap[1])];
  if (markers.credits !== undefined) out.credits = at(markers.credits);
  return out;
}

/** Fingerprint points as base64 (little-endian 32-bit), for keeping. */
export function packPoints(points: number[]): string {
  const bytes = Buffer.alloc(points.length * 4);
  points.forEach((p, i) => bytes.writeUInt32LE(p >>> 0, i * 4));
  return bytes.toString("base64");
}
export function unpackPoints(packed: string): number[] {
  const bytes = Buffer.from(packed, "base64");
  const out: number[] = [];
  for (let i = 0; i + 4 <= bytes.length; i += 4) out.push(bytes.readUInt32LE(i));
  return out;
}

/** Where to fingerprint: the opening (for the intro) and the ending (for the credits), in seconds. */
export function printWindows(duration: number) {
  const head = Math.min(600, duration * 0.3);
  const tail = Math.min(300, duration * 0.2);
  return { head: { start: 0, length: tenth(head) }, tail: { start: tenth(Math.max(0, duration - tail)), length: tenth(tail) } };
}

/* ───── The ending, from the pictures ───── */

/** Where to look for credits in the pictures: the last 5 minutes of an episode; for films the last 12%, 5 to 15 minutes. */
export function endingWindow(duration: number, kind: "episode" | "film") {
  const length = kind === "film" ? Math.min(900, Math.max(300, duration * 0.12)) : Math.min(300, duration * 0.2);
  return { start: tenth(Math.max(0, duration - length)), length: tenth(length) };
}

/**
 * Credits from how dark the keyframes are near the end ([seconds, percent
 * of the picture that's black]): the earliest dark keyframe after which at
 * least 70% of the time is dark, for at least 20 seconds (a minute for
 * films). Moved back to where the sound went quiet just before, which is
 * where the story stopped. Null when the ending isn't dark (credits over
 * pictures).
 */
export function creditsFromFrames(frames: [number, number][], silences: [number, number][], end: number, kind: "episode" | "film"): number | null {
  const list = frames.filter(([t]) => t < end).slice().sort((x, y) => x[0] - y[0]);
  if (list.length < 3) return null;
  const minRun = kind === "film" ? 60 : 20;
  let dark = 0, total = 0, found: number | null = null;
  for (let i = list.length - 1; i >= 0; i--) {
    const [t, black] = list[i];
    const span = Math.min(60, (i + 1 < list.length ? list[i + 1][0] : end) - t); // still credits keep one keyframe a long while
    total += span;
    if (black >= 85) dark += span;
    if (black >= 85 && total >= minRun && dark / total >= 0.7) found = t;
  }
  if (found === null) return null;
  /* A run that's only the black after the last frame isn't credits. */
  if (end - found < minRun) return null;
  const quiet = silences.filter(([s]) => s >= found! - 8 && s <= found! + 1).sort((x, y) => x[0] - y[0])[0];
  return tenth(quiet ? quiet[0] : found);
}

/* ───── Choosing ───── */

/** A guess at where the credits start: the last 2% of an episode, the last 5% of a film. */
export const guessCredits = (duration: number, kind: "episode" | "film") => tenth(duration * (kind === "film" ? 0.95 : 0.98));

export type Found = {
  aniskip?: Markers | null;
  chapters?: Markers | null;
  fingerprint?: Markers | null;
  /** Credits from dark pictures (counts as fingerprinting: measured from the file). */
  frames?: number | null;
  /** Credits from an unnamed last chapter. */
  lastChapter?: number | null;
  duration?: number | null;
  kind: "episode" | "film";
};

/**
 * One answer from everything found, each part from the best source that has
 * it: AniSkip, then chapters, then fingerprints, then the guess. The source
 * is the best one used; creditsGuess says credits are only the guess.
 */
export function chooseMarkers(found: Found): Markers {
  const order: [MarkerSource, Markers | null | undefined][] = [
    ["aniskip", found.aniskip], ["chapters", found.chapters],
    ["fingerprint", { ...(found.fingerprint ?? {}), ...(found.fingerprint?.credits === undefined && found.frames != null ? { credits: found.frames } : {}) }],
    ["chapters", found.lastChapter != null ? { credits: found.lastChapter } : null],
  ];
  const out: Markers = {};
  const used = new Set<MarkerSource>();
  for (const [source, m] of order) {
    if (!m) continue;
    if (m.intro && !out.intro) { out.intro = m.intro; used.add(source); }
    if (m.recap && !out.recap) { out.recap = m.recap; used.add(source); }
    if (m.credits !== undefined && out.credits === undefined) { out.credits = m.credits; used.add(source); }
  }
  if (out.credits === undefined && found.duration && found.duration > 60) {
    out.credits = guessCredits(found.duration, found.kind);
    out.creditsGuess = true;
  }
  /* Nothing that contradicts itself: an intro or recap running into the credits goes. */
  if (out.credits !== undefined) {
    if (out.intro && out.intro[1] > out.credits) delete out.intro;
    if (out.recap && out.recap[1] > out.credits) delete out.recap;
  }
  const source = (["aniskip", "chapters", "fingerprint"] as const).find((s) => used.has(s)) ?? (out.creditsGuess ? "guess" : undefined);
  return source ? { ...out, source } : out;
}

/**
 * Whether what the relay served is the release itself, not a stand-in (a
 * short "unavailable" clip some sources send): it has sound, and its length
 * and size are near what was listed.
 */
export function realFile(read: { duration: number; size?: number; audio?: boolean }, listed: { bytes?: number | null; minutes?: number | null }): boolean {
  if (read.audio === false || !(read.duration > 60)) return false;
  if (listed.minutes && read.duration < listed.minutes * 60 * 0.5) return false;
  if (listed.bytes && read.size && read.size < listed.bytes * 0.5) return false;
  return true;
}

/** Which release a file is, the same however it was found: its file name and size. */
export function releaseKey(r: { filename?: string; name?: string; bytes?: number | null }): string {
  return createHash("sha256").update(`${(r.filename || r.name || "").trim().toLowerCase()}|${r.bytes ?? ""}`).digest("hex").slice(0, 24);
}

/* ───── Requests ───── */

/** AniSkip's markers for one episode: null when it has none, undefined when it didn't answer (so it isn't remembered). */
export async function aniskip(base: string, malId: number, episode: number): Promise<Markers | null | undefined> {
  try {
    const response = await fetch(aniskipUrl(base, malId, episode), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4_000) });
    if (response.status === 404) return null;
    if (!response.ok) return undefined;
    return markersFrom((await response.json()) as Json);
  } catch {
    return undefined;
  }
}
