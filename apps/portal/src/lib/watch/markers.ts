/**
 * Skip intro, recap and credits: where they are in an episode, in seconds.
 *
 * Anime has AniSkip, a shared database of opening, ending and recap times
 * keyed by MyAnimeList id and episode. Episodes are matched the way filler
 * flags are (flagFillers in ./index.ts): a MyAnimeList entry that is
 * exactly one TMDB season counts from 1 in it; one long entry for the whole
 * show counts from the very first episode.
 *
 * Everything else waits for a later job that finds the intro by matching
 * the audio across a season's episodes (fingerprintMarkers); until then there
 * are no markers outside anime.
 *
 * The matching and reading are pure, tested in scripts/test-watch.mjs.
 */
import type { AnimeEntry } from "./anime";
import type { Episode } from "./model";

export type Markers = { intro?: [number, number]; recap?: [number, number]; credits?: number };

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

/** The seam for films and series that aren't anime: an audio-fingerprint job fills this in later. */
export async function fingerprintMarkers(_titleId: string, _season: number, _episode: number): Promise<Markers | null> { // eslint-disable-line @typescript-eslint/no-unused-vars
  return null;
}
