/**
 * Where someone is in a show, what comes next, and the small labels that say
 * so: "New episode", "3 episodes left in Season 2", the next one being filler.
 *
 * Pure logic, tested in scripts/test-watch.mjs.
 */
import { finished, fraction, type Episode, type FillerChoice, type Progress, type Title } from "./model";

export type EpisodeRef = { season: number; episode: number };
const key = (season: number, episode: number) => `${season}:${episode}`;
const byKey = (progress: Progress[]) => new Map(progress.map((p) => [key(p.season, p.episode), p]));

/** Aired by now (an episode with no date is taken as aired: TMDB leaves old ones blank). */
export const aired = (e: Pick<Episode, "airDate">, now = Date.now()) => !e.airDate || Date.parse(e.airDate) <= now;

/** The episode after this one that someone would watch, stepping over filler when they skip it. */
export function nextEpisode(episodes: Episode[], from: EpisodeRef, fillers: FillerChoice, now = Date.now()): (EpisodeRef & { skipped: number }) | null {
  const playable = episodes.filter((e) => e.season > 0 && aired(e, now));
  const at = playable.findIndex((e) => e.season === from.season && e.number === from.episode);
  let skipped = 0;
  for (let i = at + 1; i < playable.length; i++) {
    const e = playable[i];
    if (fillers === "skip" && e.filler) { skipped++; continue; }
    return { season: e.season, episode: e.number, skipped };
  }
  return null;
}

/** Filler right after this episode, for asking once ("Episodes 5–6 are filler"). Null when the next one isn't filler. */
export function fillerAhead(episodes: Episode[], from: EpisodeRef, now = Date.now()): { first: EpisodeRef; count: number; canon: EpisodeRef | null } | null {
  const playable = episodes.filter((e) => e.season > 0 && aired(e, now));
  const at = playable.findIndex((e) => e.season === from.season && e.number === from.episode);
  let i = at + 1;
  const first = playable[i];
  if (!first?.filler) return null;
  while (playable[i]?.filler) i++;
  const canon = playable[i];
  return { first: { season: first.season, episode: first.number }, count: i - at - 1, canon: canon ? { season: canon.season, episode: canon.number } : null };
}

/**
 * Where Resume goes: the episode last left part-way, or the one after the last
 * finished. Someone who hasn't started gets the first episode.
 */
export function resumePoint(episodes: Episode[], progress: Progress[], fillers: FillerChoice, now = Date.now()): EpisodeRef & { position: number; started: boolean } {
  const playable = episodes.filter((e) => e.season > 0 && aired(e, now));
  const first = playable.find((e) => !(fillers === "skip" && e.filler)) ?? playable[0];
  if (!progress.length || !first) return { season: first?.season ?? 1, episode: first?.number ?? 1, position: 0, started: false };
  const latest = [...progress].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!finished(latest)) return { season: latest.season, episode: latest.episode, position: latest.position, started: true };
  const next = nextEpisode(episodes, latest, fillers, now);
  if (next) return { season: next.season, episode: next.episode, position: 0, started: true };
  /* Caught up: point back at the last one. */
  return { season: latest.season, episode: latest.episode, position: 0, started: true };
}

/** "6 episodes left in Season 1", counting from where they are and leaving out filler they skip. */
export function seasonTracker(episodes: Episode[], progress: Progress[], at: EpisodeRef, fillers: FillerChoice, now = Date.now()) {
  const season = episodes.filter((e) => e.season === at.season);
  const seen = byKey(progress);
  const left = season.filter((e) => e.number >= at.episode && aired(e, now) && !(fillers === "skip" && e.filler)).length;
  const upcoming = season.filter((e) => !aired(e, now));
  return {
    season: at.season,
    left,
    /* One mark per episode: finished, how far into it, skipped (filler), or not aired yet. */
    marks: season.map((e) => {
      const p = seen.get(key(e.season, e.number));
      return { episode: e.number, state: p && finished(p) ? "done" as const : fillers === "skip" && e.filler ? "skip" as const : !aired(e, now) ? "upcoming" as const : "open" as const, fraction: fraction(p) };
    }),
    nextAirDate: upcoming[0]?.airDate ?? null,
  };
}

/** The label on a poster: only for people who watch the show, like the big services. */
export function badge(title: Pick<Title, "kind" | "status">, episodes: Pick<Episode, "season" | "number" | "airDate">[], watching: boolean, now = Date.now()): string | null {
  if (title.kind === "movie") return null;
  const day = 24 * 60 * 60 * 1000;
  const recent = episodes.filter((e) => e.airDate && now - Date.parse(e.airDate) >= 0 && now - Date.parse(e.airDate) < 7 * day);
  if (!recent.length) return null;
  if (recent.some((e) => e.number === 1 && e.season > 1)) return "New season";
  if (!watching) return null;
  return recent.length > 1 ? "New episodes" : "New episode";
}

/** A finished episode or film counts as finished; part-way is the fraction played. */
export { finished, fraction };
