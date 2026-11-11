import "server-only";

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apiError } from "../api-v1";
import { secretName } from "../secret-name";
import { resolveSecrets } from "../secrets";
import { getPlatformSettings } from "../settings";
import { stateDir } from "../state";
import { anyPlayable, noteSearch, notePlayable, quietAfter, sourcesQuiet, playableOf, pool, shared, streamsKey, streamTtl, toCheck, visible } from "./ahead";
import { animeEntriesFor, animeMap, anilistMedia, jikanFillers, kitsuEpisode, kitsuParts, type KitsuPart } from "./anime";
import { watchAppId, watchConfig, type WatchConfig } from "./config";
import { absoluteNumbers, availability, badge, episodeLabel, episodeLayout, fillerAhead, nextEpisode, resumePoint, seasonTracker } from "./labels";
import {
  cached, episodesOf, finished, fraction, getTitle, getTitles, isStale, keep, listOf, markFillers, markSeasonFillers, migrate, parseTitleId,
  cleanDeviceId, cleanQuality, deviceQualityOf, prefsOf, progressOf, qualityFor, putEpisodes, putSeasons, putTitle, ratingOf, recentTitles, remindsOf, seasonsOf, staleAfter, sweepCache, showLayoutOf, tracksOf, WatchProblem, readState, writeState,
  type Episode, type Title,
} from "./model";
import { cachedImage, imageHeaders, imageRequest, imageUrl } from "./images";
import { aniskip, aniskipEpisode, chooseMarkers, type Markers } from "./markers";
import { analyseLater, skipsFor, type SkipDeps, type SkipTarget } from "./skips";
import { badges, bitrate, cleanDevice, describe, heightCap, qualityOptions, rank, type Release } from "./releases";

/** One file's size: by bitrate and runtime when known (a pack lists the whole season), else what the listing says. */
const sizeOf = (r: Release, minutes: number | null) => { const mbps = bitrate(r, minutes); return mbps && minutes ? Math.round((mbps * 1e6 / 8) * minutes * 60) : r.bytes; };
import { fetchUpstream, searchStreams, stremioId, videoType } from "./streams";
import { playerTracks, trackPlan, wantFor, withFallback } from "./languages";
import { meter, recordSpeed, sampleOf, speedsOf } from "./speed";
import { fillParams, planRows, rowMinimum, tasteOf, type PlannedRow } from "./rows";
import { ensureProvisioned, hasSources, provisioningOf, type NzbdavAccess } from "./provision";
import { lastError, noteError, probe, type Probe } from "./status";
import { fetchDetails, fetchSeason, seasonsFromTmdb, stubFromTmdb, titleFromTmdb, tmdb, episodesFromTmdb } from "./tmdb";
import { openStream, sealStream } from "./token";
import { screensOf } from "./screens";
import { migrateTogether } from "./together";
import { markDead, isDead } from "./dead";
import { framingOf, noteShape } from "./shape";
import { asked, endedBefore, endStreams, heard, streamLifeMs, playbackNeedsSource, tooMany, tooManyNote, tracked, verdict, waitOn, watchKey } from "./flow";
import { anything, castOf, displayAspect, probeAttempts, probeOutcome, ffmpegArgs, hlsPath, masterPlaylist, mediaPlaylist, openHls, planHls, screenFor, sealHls, sessionOf, startSegment, subtitlePlaylist, type HlsGrant, type HlsPlan, type PackagerJob, type Probe as HlsProbe } from "./hls";

export * from "./model";
export { askForScreens, decideScreens, moreScreens, mostScreens, screenAsks, screensOf, setScreens } from "./screens";

const root = join(stateDir, "watch");
const cache = globalThis as unknown as { kimonoWatch?: DatabaseSync; kimonoWatchSwept?: number };

let migrated = false;
export function watchDb(): DatabaseSync {
  if (!cache.kimonoWatch) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const opened = new DatabaseSync(join(root, "watch.db"));
    migrate(opened);
    migrateTogether(opened);
    cache.kimonoWatch = opened;
    migrated = true;
  }
  /* A hot reload keeps the connection but brings new code: bring the schema along. */
  if (!migrated) { migrate(cache.kimonoWatch); migrateTogether(cache.kimonoWatch); migrated = true; }
  if (!cache.kimonoWatchSwept || Date.now() - cache.kimonoWatchSwept > 60 * 60 * 1000) {
    cache.kimonoWatchSwept = Date.now();
    sweepCache(cache.kimonoWatch);
  }
  return cache.kimonoWatch;
}

async function config(): Promise<WatchConfig> {
  return watchConfig(await getPlatformSettings());
}

/** Runs a Watch request, turning refusals into the JSON errors /api/v1 answers with. */
export async function watch(work: (config: WatchConfig) => Promise<Response> | Response): Promise<Response> {
  try {
    const settings = await config();
    if (!settings.enabled) return apiError(404, "Watch isn't switched on.");
    return await work(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof WatchProblem) || error.status >= 500) { try { noteError(watchDb(), message); } catch { /* the database itself is the trouble */ } }
    if (error instanceof WatchProblem) return apiError(error.status, error.message);
    console.warn("Watch request failed:", message);
    return apiError(500, "Watch couldn't do that. Try again in a moment.");
  }
}

/* ───── Catalog ───── */

/** A title known only from a list goes in as it is; one already known keeps what it has. */
function seed(stub: Title | null): Title | null {
  if (!stub) return null;
  const known = getTitle(watchDb(), stub.id);
  /* A full title keeps what it has; one still known only from a list takes the newer list's facts. */
  if (known && known.fetchedAt > 0) return known;
  putTitle(watchDb(), stub);
  return stub;
}

/** The title in full: fetched the first time, refreshed when stale, the old copy kept if TMDB is down. */
export async function ensureTitle(cfg: WatchConfig, id: string): Promise<Title> {
  const { kind, tmdbId } = parseTitleId(id);
  const db = watchDb();
  const known = getTitle(db, id);
  if (known && !isStale(known)) return known;
  try {
    const details = await fetchDetails(cfg.tmdbToken, kind, tmdbId);
    const title = titleFromTmdb(details, kind, cfg.region);
    await enrichAnime(cfg, title, details);
    putTitle(db, title);
    if (kind === "series") putSeasons(db, id, seasonsFromTmdb(details));
    return title;
  } catch (error) {
    if (known && known.fetchedAt > 0) return known;
    throw error;
  }
}

async function enrichAnime(cfg: WatchConfig, title: Title, details: Record<string, unknown>) {
  const map = await animeMap(cfg.animeMapUrl, join(root, "anime-list.json"));
  if (!map) return;
  const tvdbId = Number((details.external_ids as { tvdb_id?: number } | undefined)?.tvdb_id) || null;
  const entries = animeEntriesFor(map, { kind: title.kind, tmdbId: title.tmdbId, tvdbId, imdbId: title.imdbId });
  if (!entries.length) { if (title.shelf === "Anime") title.shelf = title.kind === "movie" ? "Film" : "Series"; return; }
  title.shelf = "Anime";
  title.anilistId = entries[0].anilistId;
  title.malId = entries[0].malId;
  if (title.anilistId) {
    const media = await anilistMedia(cfg.anilistUrl, title.anilistId);
    if (media) {
      title.genres = [...new Set([...title.genres, ...media.genres])].slice(0, 6);
      title.moods = media.moods;
      title.malId ??= media.malId;
    }
  }
}

/** A season's episodes, fetched when first needed and refreshed like its title. Anime gets its filler flags too. */
export async function ensureSeason(cfg: WatchConfig, title: Title, season: number): Promise<Episode[]> {
  const db = watchDb();
  const known = seasonsOf(db, title.id).find((s) => s.number === season);
  if (!known) throw new WatchProblem("That season doesn't exist.", 404);
  if (Date.now() - known.fetchedAt > staleAfter(title)) {
    try {
      putEpisodes(db, title.id, season, episodesFromTmdb(await fetchSeason(cfg.tmdbToken, title.tmdbId, season)));
      if (title.shelf === "Anime") await flagFillers(cfg, title, season);
    } catch (error) {
      if (!known.fetchedAt) throw error;
    }
  }
  return episodesOf(db, title.id, season);
}

async function flagFillers(cfg: WatchConfig, title: Title, season: number) {
  const map = await animeMap(cfg.animeMapUrl, join(root, "anime-list.json"));
  const entries = map ? animeEntriesFor(map, { kind: "series", tmdbId: title.tmdbId, imdbId: title.imdbId }) : [];
  const db = watchDb();
  const forSeason = entries.find((e) => e.season === season && e.malId);
  if (forSeason?.malId) { markSeasonFillers(db, title.id, season, await jikanFillers(cfg.jikanUrl, forSeason.malId)); return; }
  /* One long-running entry for the whole show (Naruto, One Piece): MyAnimeList counts episodes from the very first. */
  if (entries.length === 1 && entries[0].malId) {
    const flags = await jikanFillers(cfg.jikanUrl, entries[0].malId);
    markFillers(db, title.id, flags.map((f) => ({ absolute: f.number, filler: f.filler, recap: f.recap })));
  }
}

/** Every season with its episodes; used for resume and next-episode decisions. */
async function allEpisodes(cfg: WatchConfig, title: Title): Promise<Episode[]> {
  const seasons = seasonsOf(watchDb(), title.id).filter((s) => s.number > 0);
  for (const s of seasons) await ensureSeason(cfg, title, s.number);
  return episodesOf(watchDb(), title.id);
}

/* ───── What the apps get ───── */

export type Card = { id: string; name: string; kind: Title["kind"]; shelf: Title["shelf"]; year: number | null; age: string; poster: string | null; backdrop: string | null; logo: string | null; badge?: string | null; top?: number };

/** The Portal's address as the apps reach it: stream and image addresses are built on it. */
export const portalOrigin = (request: Request) =>
  (process.env.KIMONO_PORTAL_URL || process.env.AUTH_URL?.replace(/\/api\/auth\/?$/, "") || new URL(request.url).origin).replace(/\/+$/, "");

/** A poster card; images are Kimono's addresses on `origin` (./images.ts). */
export function cardOf(t: Title, origin: string, extra: Partial<Card> = {}): Card {
  return {
    id: t.id, name: t.name, kind: t.kind, shelf: t.shelf, year: t.year, age: t.age,
    poster: imageUrl(origin, t.poster, "w500"), backdrop: imageUrl(origin, t.backdrop, "w780"), logo: imageUrl(origin, t.logo, "w500"), ...extra,
  };
}

/** What to say when a search finds nothing: in cinemas, not out, or no copy. */
const notFoundNote = (title: Title) => {
  const why = availability(title, false);
  return why.state === "missing" ? "We couldn't find a copy of this yet." : `${why.note}.`;
};

export async function titleView(cfg: WatchConfig, username: string, origin: string, id: string, seasonWanted?: number) {
  const db = watchDb();
  const title = await ensureTitle(cfg, id);
  const prefs = prefsOf(db, username);
  const progress = progressOf(db, username, id);
  const known = availability(title, playableOf(db, id) ?? undefined);
  /* Nothing to search, or sources that find nothing for anything: say that, not "no copy". */
  const available = known.state !== "missing" && known.state !== "ready" ? known
    : !hasSources(cfg) ? { state: "missing" as const, note: "Watch isn't connected to anything to stream from yet" }
      : known.state === "missing" && sourcesQuiet(db) ? { state: "missing" as const, note: "Watch's sources aren't finding anything right now" }
        : known;
  const base = {
    title: { ...cardOf(title, origin), overview: title.overview, genres: title.genres, moods: title.moods, cast: title.cast, runtime: title.runtime, status: title.status, nextAirDate: title.nextAirDate, backdropLarge: imageUrl(origin, title.backdrop, "w1280") },
    inList: listOf(db, username).includes(id), rating: ratingOf(db, username, id), reminding: remindsOf(db, username).includes(id),
    tracks: tracksOf(db, username, id),
    /* What this title plays in, this show's own choice or the settings, and the languages to offer for it. */
    language: (() => {
      const plan = trackPlan(title, prefs, tracksOf(db, username, id));
      const mine = prefs.audioLanguage || "en";
      return {
        audio: plan.audio, subtitles: !plan.subtitles ? "off" : plan.subtitles.kind === "signs" ? "signs" : plan.subtitles.language,
        original: title.originalLanguage || (title.shelf === "Anime" ? "ja" : mine), mine, subtitleLanguage: prefs.subtitleLanguage || mine,
        preferred: prefs.preferredLanguage, fallback: prefs.fallbackLanguage,
      };
    })(),
    /* "seasons" or "continuous" when this show has its own episode layout; null follows the default. */
    showEpisodes: showLayoutOf(db, username, id),
    /* Taken as playable until a search says otherwise, unless it isn't out at home yet. */
    playable: available.state === "ready",
    /* Why it can't play: "upcoming" | "cinemas" | "missing", and a few words to say so. */
    availability: available,
  };
  if (title.kind === "movie") {
    const p = progress.find((x) => x.season === 0 && x.episode === 0);
    findAhead(cfg, title, 0, 0);
    return { ...base, resume: p && !finished(p) ? { position: p.position, fraction: fraction(p) } : null };
  }
  const episodes = await allEpisodes(cfg, title);
  const resume = resumePoint(episodes, progress, prefs.fillers);
  findAhead(cfg, title, resume.season, resume.episode);
  const season = seasonWanted ?? resume.season;
  const seen = new Map(progress.map((p) => [`${p.season}:${p.episode}`, p]));
  const seasons = seasonsOf(db, id).filter((s) => s.number > 0);
  /* One season: no season anywhere. Anime counted in one run: every episode in one list, numbered from the first. */
  /* This show's own choice, else the person's default for anime. */
  const showLayout = showLayoutOf(db, username, id);
  const layout = episodeLayout(title.shelf, seasons.length, showLayout ?? prefs.animeEpisodes);
  const absolute = absoluteNumbers(episodes);
  const shown = layout === "continuous" ? episodes.filter((e) => e.season > 0) : episodes.filter((e) => e.season === season);
  /* In one run, what's left counts to the end of the show, not the season. */
  const flat = (e: { season: number; number: number }) => ({ season: 1, number: absolute.get(`${e.season}:${e.number}`) ?? e.number });
  const tracker = !resume.started ? null : layout === "continuous"
    ? seasonTracker(episodes.filter((e) => e.season > 0).map((e) => ({ ...e, ...flat(e) })), progress.map((p) => ({ ...p, season: 1, episode: flat({ season: p.season, number: p.episode }).number })), { season: 1, episode: flat({ season: resume.season, number: resume.episode }).number }, prefs.fillers)
    : seasonTracker(episodes, progress, resume, prefs.fillers);
  return {
    ...base,
    /* "single": hide the season picker and "Season 1"; "continuous": one list, no picker; "seasons": the picker. */
    layout,
    seasons: layout === "seasons" ? seasons.map((s) => ({ number: s.number, name: s.name, episodeCount: s.episodeCount, airDate: s.airDate })) : [],
    resume: { ...resume, label: episodeLabel(layout, resume.season, resume.episode, absolute.get(`${resume.season}:${resume.episode}`)) },
    tracker,
    badge: badge(title, episodes, progress.length > 0),
    hasFillers: episodes.some((e) => e.filler),
    fillers: prefs.fillers,
    season,
    episodes: shown.map((e) => ({
      season: e.season, number: e.number, absolute: absolute.get(`${e.season}:${e.number}`) ?? e.number,
      label: episodeLabel(layout, e.season, e.number, absolute.get(`${e.season}:${e.number}`)), name: e.name, overview: e.overview, still: imageUrl(origin, e.still, "w500"), runtime: e.runtime, airDate: e.airDate,
      filler: e.filler, recap: e.recap, fraction: fraction(seen.get(`${e.season}:${e.number}`)),
    })),
  };
}

const hours = (n: number) => n * 60 * 60 * 1000;

async function tmdbList(cfg: WatchConfig, key: string, path: string, params: Record<string, string>, ttl: number): Promise<Title[]> {
  const db = watchDb();
  const ids = cached<string[]>(db, key);
  if (ids) return getTitles(db, ids);
  const body = await tmdb(cfg.tmdbToken, path, params).catch(() => null);
  if (!body) return [];
  const titles = ((body.results ?? []) as Record<string, unknown>[]).map((item) => seed(stubFromTmdb(item))).filter((t): t is Title => Boolean(t));
  keep(db, key, titles.map((t) => t.id), ttl);
  return titles;
}

/** How this person sees a show's episodes (./labels.ts episodeLayout), and each episode's name on screen. */
export function namer(db: DatabaseSync, title: Title, prefs: ReturnType<typeof prefsOf>, username?: string) {
  const layout = episodeLayout(title.shelf, seasonsOf(db, title.id).filter((s) => s.number > 0).length, (username ? showLayoutOf(db, username, title.id) : null) ?? prefs.animeEpisodes);
  const absolute = absoluteNumbers(episodesOf(db, title.id));
  const label = (season: number, episode: number) => episodeLabel(layout, season, episode, absolute.get(`${season}:${episode}`));
  /* An episode reference with its label added, e.g. play's next. */
  const named = <T extends { season: number; episode: number }>(ref: T | null) => (ref ? { ...ref, label: label(ref.season, ref.episode) } : null);
  return { layout, label, named };
}

/** Rows Home serves per page while scrolling; a page stops early rather than wait on too many lists. */
const pageRows = 8;
const pageTries = 16;

/**
 * Home, endless: the first page leads with Continue watching, the Top 10 and
 * the newest rows; every page after follows this person's plan (./rows.ts
 * planRows): what they watch a lot, as genres and themes, series, films and
 * anime, and "Because you watched" for their recent titles. `cursor` is where
 * the next page starts; null when the plan has run out.
 */
export async function home(cfg: WatchConfig, username: string, origin: string, shelf?: Title["shelf"], cursor = 0) {
  const db = watchDb();
  const ok = (t: Title) => !shelf || t.shelf === shelf;
  const prefs = prefsOf(db, username);
  const recent = recentTitles(db, username, 30);
  const recentTitlesList = getTitles(db, recent.map((p) => p.titleId));
  const mine = getTitles(db, listOf(db, username));
  const recentShows = [...new Map(recentTitlesList.map((t) => [t.id, t])).values()].filter(ok);
  /* The plan is kept half an hour so pages stay consistent while someone scrolls. */
  const planKey = `plan:${username}:${shelf ?? "all"}`;
  const plan = (cursor > 0 && cached<PlannedRow[]>(db, planKey)) || planRows(tasteOf([...recentTitlesList, ...mine]), recentShows.length, shelf);
  keep(db, planKey, plan, 30 * 60 * 1000);
  const plays = (titles: Title[]) => visible(titles.filter(ok), (id) => playableOf(db, id));
  type Row = { id: string; title: string; kind: string; items: Card[] };
  const cards = (id: string, title: string, titles: Title[]): Row | null => {
    const items = plays(titles).map((t) => cardOf(t, origin));
    return items.length >= rowMinimum ? { id, title, kind: "cards", items } : null;
  };
  const listFor = (r: PlannedRow): Promise<Title[]> => "similar" in r
    ? (recentShows[r.similar] ? tmdbList(cfg, `similar:${recentShows[r.similar].id}`, `/${recentShows[r.similar].kind === "movie" ? "movie" : "tv"}/${recentShows[r.similar].tmdbId}/recommendations`, {}, hours(24)) : Promise.resolve([]))
    : tmdbList(cfg, `row:${r.id}:${new Date().toISOString().slice(0, 10)}`, r.path, fillParams(r.params), hours(r.ttl));
  const rowFor = (r: PlannedRow, titles: Title[]) => cards(r.id, "similar" in r ? `Because you watched ${recentShows[r.similar]?.name ?? ""}` : r.title, titles);

  /* Walk the plan from the cursor, a few lists at a time, until the page is full. */
  const rows: Row[] = [];
  let at = cursor;
  const fetched: Title[] = [];
  while (rows.length < pageRows && at < plan.length && at - cursor < pageTries) {
    const batch = plan.slice(at, Math.min(plan.length, at + Math.min(4, pageRows - rows.length + 2)));
    at += batch.length;
    const lists = await Promise.all(batch.map(listFor));
    lists.forEach((titles, i) => { fetched.push(...titles); const row = rowFor(batch[i], titles); if (row) rows.push(row); });
  }
  const next = at < plan.length ? at : null;
  if (cursor > 0) {
    checkPlayable(cfg, fetched.filter(ok).map((t) => t.id));
    return { featured: null, rows, next };
  }

  /* The first page: personal and popular rows ahead of the plan. */
  const continuing = recent.flatMap((p) => {
    const t = recentTitlesList.find((x) => x.id === p.titleId);
    if (!t || !ok(t)) return [];
    if (t.kind === "movie" && finished(p)) return [];
    const label = t.kind === "series" ? namer(db, t, prefs, username).label(p.season, p.episode) : null;
    return [{ ...cardOf(t, origin), season: p.season, episode: p.episode, label, fraction: fraction(p), left: Math.max(0, Math.round((p.duration - p.position) / 60)) }];
  }).slice(0, 12);
  const [trending, anime, films, series] = await Promise.all([
    tmdbList(cfg, "trending:all:week", "/trending/all/week", {}, hours(6)),
    tmdbList(cfg, "discover:anime", "/discover/tv", { with_genres: "16", with_origin_country: "JP", sort_by: "popularity.desc" }, hours(12)),
    tmdbList(cfg, "trending:movie:week", "/trending/movie/week", {}, hours(6)),
    /* Popular series without talk, news, reality and soap shows (TMDB's trending TV is mostly those), which have nothing to stream. */
    tmdbList(cfg, "discover:popular-series", "/discover/tv", { sort_by: "popularity.desc", "vote_count.gte": "200", without_genres: "10763,10764,10766,10767,16" }, hours(12)),
  ]);
  /* Rows from TMDB leave out what is known not to play; someone's own rows show everything they chose. */
  checkPlayable(cfg, [...trending, ...series, ...anime, ...films, ...fetched].filter(ok).map((t) => t.id));
  const top = plays(trending).slice(0, 10);
  const lead = [
    continuing.length ? { id: "continue", title: "Continue watching", kind: "continue", items: continuing } : null,
    top.length ? { id: "top", title: "Top 10 today", kind: "top", items: top.map((t, i) => cardOf(t, origin, { top: i + 1 })) } : null,
    ...rows.slice(0, 3),
    !shelf || shelf === "Series" ? cards("series", "Popular series", series) : null,
    ...rows.slice(3, 5),
    !shelf || shelf === "Anime" ? cards("anime", "Popular anime", anime) : null,
    mine.length ? { id: "list", title: "My list", kind: "cards", items: mine.filter(ok).map((t) => cardOf(t, origin)) } : null,
    !shelf || shelf === "Film" ? cards("films", "Popular films", films) : null,
    ...rows.slice(5),
  ].filter((row): row is Row => Boolean(row) && row!.items.length > 0);

  const featured = top.find((t) => t.backdrop) ?? null;
  return { featured: featured ? { ...cardOf(featured, origin), backdropLarge: imageUrl(origin, featured.backdrop, "w1280"), overview: featured.overview } : null, rows: lead, next };
}

/**
 * Checks whether the titles on Home's rows play at all, so Home can leave out
 * the ones that don't: at most hourly, 24 titles a run, two at a time, and
 * none after three failures in a row. A verdict lasts a day (./ahead.ts).
 */
function checkPlayable(cfg: WatchConfig, ids: string[]) {
  const run = globalThis as unknown as { kimonoWatchChecked?: number };
  if (!hasSources(cfg) || (run.kimonoWatchChecked && Date.now() - run.kimonoWatchChecked < hours(1))) return;
  run.kimonoWatchChecked = Date.now();
  const db = watchDb();
  const batch = toCheck(ids, (id) => playableOf(db, id), 24);
  if (!batch.length) return;
  pool(batch, 2, async (id) => {
    const title = await ensureTitle(cfg, id);
    if (!title.imdbId) { notePlayable(db, id, false); return true; }
    const first = title.kind === "series" ? 1 : 0;
    await releasesFor(cfg, title, first, first);
    return true;
  })
    .then((checked) => writeState(db, "playability", { at: Date.now(), checked, of: batch.length }))
    .catch(() => {});
}

export async function search(cfg: WatchConfig, origin: string, query: string) {
  const q = query.trim().slice(0, 100);
  if (!q) return { results: (await tmdbList(cfg, "trending:all:week", "/trending/all/week", {}, hours(6))).slice(0, 12).map((t) => cardOf(t, origin)) };
  const body = await tmdb(cfg.tmdbToken, "/search/multi", { query: q, include_adult: "false" });
  const titles = ((body.results ?? []) as Record<string, unknown>[]).map((item) => seed(stubFromTmdb(item))).filter((t): t is Title => Boolean(t));
  return { results: titles.slice(0, 30).map((t) => cardOf(t, origin)) };
}

/* ───── Playing ───── */

async function streamKey(): Promise<Buffer> {
  const name = secretName(watchAppId, "STREAM_KEY");
  return Buffer.from((await resolveSecrets([name]))[name], "hex");
}

/** A shape the apps measured as a copy played (they play the file, so the packager never probes it): kept for that copy, if the address is this person's. */
export async function noteShapeOf(username: string, address: string, aspect: number) {
  const played = openStream(await streamKey(), address.split("/stream/").pop()?.split(/[/?]/)[0] ?? "");
  if (played && played.username === username && aspect > 0.5 && aspect < 4) noteShape(watchDb(), played.url, aspect);
}

/** nzbdav's API key and WebDAV password: the server's (shared with nzbdav at deploy), else Kimono's own for a local nzbdav. */
async function nzbdavAccess(): Promise<NzbdavAccess> {
  const env = { key: process.env.KIMONO_WATCH_NZBDAV_KEY?.trim(), webdavPassword: process.env.KIMONO_WATCH_NZBDAV_WEBDAV_PASSWORD?.trim() };
  if (env.key && env.webdavPassword) return { key: env.key, webdavPassword: env.webdavPassword };
  const names = [secretName(watchAppId, "NZBDAV_KEY"), secretName(watchAppId, "NZBDAV_WEBDAV_PASSWORD")];
  const minted = await resolveSecrets(names);
  return { key: env.key || minted[names[0]], webdavPassword: env.webdavPassword || minted[names[1]] };
}


/**
 * One film's or episode's releases: from the cache, from a search already
 * under way (a title page or /prepare started it), or a new search, kept for
 * 20 minutes. Upstream addresses stay on the server.
 */
function releasesFor(cfg: WatchConfig, title: Title, season: number, episode: number): Promise<Release[]> {
  const db = watchDb();
  const key = streamsKey(title.id, season, episode);
  const known = cached<Release[]>(db, key);
  /* An empty answer is never reused: sources drop searches when busy, so it's asked again. */
  if (known?.length) return Promise.resolve(known);
  return shared(searching, key, async () => {
    const ids = [await kitsuIdFor(cfg, title, season, episode), title.imdbId ? stremioId(title.imdbId, season || undefined, episode || undefined) : null].filter((id): id is string => Boolean(id));
    if (!ids.length) throw new WatchProblem("There's no way to find streams for this one yet.", 404);
    const manifest = await ensureProvisioned(db, cfg, await nzbdavAccess());
    let found: Release[] = [], complete = false;
    /* Anime goes by Kitsu's numbering first; when that finds nothing, by IMDb like any show. */
    for (const id of ids) {
      let refused: boolean;
      ({ releases: found, complete, refused } = await searchStreams(manifest, title.kind, id));
      /*
       * Nothing at all: a busy source may have dropped it, or the search turned
       * it away for coming too often (its window is 15 seconds). Asked again,
       * after the window when refused, before it is believed.
       */
      for (const wait of refused ? [8000, 8000] : [2000]) {
        if (found.length) break;
        await new Promise((done) => setTimeout(done, wait));
        ({ releases: found, complete, refused } = await searchStreams(manifest, title.kind, id));
        if (!refused) break;
      }
      if (found.length) break;
    }
    /* Still nothing, and the search didn't finish: that's no answer, so it isn't kept and play doesn't say "no copy". */
    if (!found.length && !complete) throw new WatchProblem("Watch's sources are busy right now. Try again in a moment.", 503);
    keep(db, key, found, streamTtl);
    /* Anything found says the title plays. Nothing found says it doesn't, but only for a first episode or a film, and only when no source failed: a timeout is not an answer. */
    const streak = noteSearch(db, found.length === 0);
    if (anyPlayable(found)) notePlayable(db, title.id, true);
    else if (season <= 1 && episode <= 1 && complete && streak < quietAfter) notePlayable(db, title.id, false);
    return found;
  });
}
/** An anime episode's Stremio id by Kitsu ("kitsu:41982:3"), or null when its numbering there isn't clear. */
async function kitsuIdFor(cfg: WatchConfig, title: Title, season: number, episode: number): Promise<string | null> {
  if (title.shelf !== "Anime" || title.kind !== "series" || season <= 0) return null;
  const map = await animeMap(cfg.animeMapUrl, join(root, "anime-list.json"));
  const entries = map ? animeEntriesFor(map, { kind: "series", tmdbId: title.tmdbId, imdbId: title.imdbId }) : [];
  if (!entries.some((e) => e.kitsuId)) return null;
  const db = watchDb();
  /* The entries this episode could belong to; their lengths change while they air, so they're kept a day. */
  const ids = [...new Set(entries.filter((e) => e.kitsuId && (e.season === season || e.season === null)).map((e) => e.kitsuId!))].sort((a, b) => a - b);
  const partsKey = `kitsu:${ids.join(",")}`;
  let parts = cached<KitsuPart[]>(db, partsKey);
  if (!parts) {
    parts = await kitsuParts(cfg.kitsuUrl, ids);
    if (parts) keep(db, partsKey, parts, 24 * hours(1));
  }
  /* One long entry is counted from the very first episode, so every season has to be there. */
  const episodes = entries.length === 1 && entries[0].season === null ? await allEpisodes(cfg, title).catch(() => []) : [];
  const at = kitsuEpisode(entries, episodes, { season, episode }, parts ?? []);
  return at ? `kitsu:${at.kitsuId}:${at.episode}` : null;
}
const searching = ((globalThis as unknown as { kimonoWatchSearching?: Map<string, Promise<Release[]>> }).kimonoWatchSearching ??= new Map());

/** Starts finding an episode's streams without waiting; play reports any trouble when it comes to it. */
function findAhead(cfg: WatchConfig, title: Title, season: number, episode: number) {
  if (!title.imdbId || !hasSources(cfg)) return;
  releasesFor(cfg, title, season, episode).catch(() => {});
}

/**
 * What a Watch Together party plays after this episode: the host's way with
 * filler (skipping it only if they skip it; asking isn't for a party).
 */
export async function nextUp(cfg: WatchConfig, host: string, titleId: string, from: { season: number; episode: number }) {
  const title = await ensureTitle(cfg, titleId);
  if (title.kind === "movie") return null;
  const fillers = prefsOf(watchDb(), host).fillers === "skip" ? "skip" : "watch";
  return nextEpisode(await allEpisodes(cfg, title), from, fillers);
}

/**
 * Gets the next episode ready while this one plays: the apps send the one
 * playing (`{ titleId, season, episode, device }`) most of the way through,
 * and its streams are found now so the next play starts at once. Says which
 * episode that is and whether something on it plays on this device.
 */
export async function prepare(cfg: WatchConfig, username: string, raw: Record<string, unknown>) {
  const db = watchDb();
  const title = await ensureTitle(cfg, String(raw.titleId ?? ""));
  if (title.kind === "movie") return { next: null, ready: false };
  const prefs = prefsOf(db, username);
  const next = nextEpisode(await allEpisodes(cfg, title), { season: Number(raw.season) || 1, episode: Number(raw.episode) || 1 }, prefs.fillers);
  if (!next || !title.imdbId) return { next, ready: false };
  const episodes = episodesOf(db, title.id);
  const [found, fromAniskip] = await Promise.all([
    releasesFor(cfg, title, next.season, next.episode).catch(() => []),
    aniskipFor(cfg, title, episodes, next.season, next.episode).catch(() => null),
  ]);
  const device = cleanDevice(raw.device);
  const minutes = episodesOf(db, title.id, next.season).find((e) => e.number === next.episode)?.runtime ?? title.runtime;
  const plan = trackPlan(title, prefs, tracksOf(db, username, title.id));
  const quality = qualityFor(cleanQuality(raw.quality), deviceQualityOf(db, username, cleanDeviceId(raw.deviceId)), prefs);
  const ranked = rank(found, device, quality, minutes, wantFor(plan, title.originalLanguage, prefs.fallbackLanguage), speedsOf(db), framingOf(db, title));
  /* Work out the next episode's skips now, for the release it will most likely play. */
  if (ranked[0] && cfg.packager.key && !complete(fromAniskip)) {
    const pick = picker(cfg, title, episodes, device, quality, wantFor(plan, title.originalLanguage, prefs.fallbackLanguage));
    analyseLater(await skipDeps(cfg, username, pick), skipTarget(title, episodes, next.season, next.episode, ranked[0], minutes));
  }
  return { next: namer(db, title, prefs, username).named(next), ready: ranked.length > 0 };
}

/** A copy's name that holds across calls, for "try another copy" (the address itself never leaves the Portal). */
const copyKey = (r: { url: string }) => createHash("sha1").update(r.url).digest("base64url").slice(0, 12);

/**
 * Picks what to play on this device and hands back a Kimono address for it,
 * with the other versions, where to start, and what comes after.
 */
export async function play(cfg: WatchConfig, username: string, origin: string, raw: Record<string, unknown>) {
  const db = watchDb();
  const title = await ensureTitle(cfg, String(raw.titleId ?? ""));
  if (!title.imdbId) throw new WatchProblem("There's no way to find streams for this one yet.", 404);
  /* Not out yet: anything found under its name is something else. */
  const due = availability(title, undefined);
  if (due.state === "upcoming") throw new WatchProblem(`${due.note}.`, 404);
  /* Casting picks for the receiver; the web player and receivers get HLS as well as the file (./hls.ts). */
  const cast = castOf(raw.cast);
  const asked = cleanDevice(raw.device);
  /* A connection known to be slow lowers what's picked, unless a cast receiver (its own network) plays it. */
  const link = cast === null ? linkOf(username) : undefined;
  const device = { ...screenFor(asked, cast), ...(link ? { link } : {}) };
  const hls = Boolean(cfg.packager.key) && (cast !== null || asked.client === "web");
  const prefs = prefsOf(db, username);
  /* Quality: picked in the player just now, else this device's own, else the person's. */
  const quality = qualityFor(cleanQuality(raw.quality), deviceQualityOf(db, username, cleanDeviceId(raw.deviceId)), prefs);
  const season = title.kind === "series" ? Number(raw.season) || 1 : 0;
  const episode = title.kind === "series" ? Number(raw.episode) || 1 : 0;
  /* Two streams at once per person; what's already playing (a quality switch, another version) carries on. */
  const what = watchKey(title.id, season, episode);
  const screens = screensOf(db, username);
  if (tooMany(username, what, Date.now(), screens)) throw new WatchProblem(tooManyNote(screens), 429);
  let minutes = title.runtime;
  let episodes: Episode[] = [];
  if (title.kind === "series") {
    episodes = await allEpisodes(cfg, title);
    const e = episodes.find((x) => x.season === season && x.number === episode);
    if (!e) throw new WatchProblem("That episode doesn't exist.", 404);
    minutes = e.runtime ?? minutes;
  }

  const [found, fromAniskip] = await Promise.all([releasesFor(cfg, title, season, episode), aniskipFor(cfg, title, episodes, season, episode).catch(() => null)]);
  /* Sub or dub: the person's choice for this show, else their settings; the release is picked to carry it. */
  const plan = trackPlan(title, prefs, tracksOf(db, username, title.id));
  let ranked = rank(found, device, quality, minutes, wantFor(plan, title.originalLanguage, prefs.fallbackLanguage), speedsOf(db), framingOf(db, title));
  /* Nothing the screen plays as it is: with HLS the packager can transcode anything. */
  if (!ranked.length && hls) ranked = rank(found, anything(device), quality, minutes, wantFor(plan, title.originalLanguage, prefs.fallbackLanguage), speedsOf(db), framingOf(db, title));
  /* The ranking moves between calls (speeds are measured as things play), so "another copy" names the ones tried, not a place in the list. */
  const avoid = new Set(Array.isArray(raw.avoid) ? raw.avoid.filter((x): x is string => typeof x === "string") : []);
  const wanted = typeof raw.version === "number" ? ranked[raw.version] : ranked.find((r) => !avoid.has(copyKey(r)));
  if (!wanted && avoid.size && ranked.length) throw new WatchProblem("There's no other copy to try.", 404);
  if (!wanted) throw new WatchProblem(found.length ? "Nothing here plays on this device yet." : notFoundNote(title), 404);

  const markers = await markersFor(cfg, username, title, episodes, season, episode, wanted, minutes, fromAniskip,
    picker(cfg, title, episodes, device, quality, wantFor(plan, title.originalLanguage, prefs.fallbackLanguage)));

  const sealKey = await streamKey();
  const expiresAt = Date.now() + streamLifeMs;
  const sealed = (r: { url: string; service: string }) => sealStream(sealKey, { url: r.url, username, expiresAt, source: r.service, what });
  const address = (r: { url: string; service: string }) => `${origin}/api/v1/watch/stream/${sealed(r)}`;
  const tracks = playerTracks(withFallback(plan, prefs, wanted.languages, tracksOf(db, username, title.id)));
  const p = progressOf(db, username, title.id).find((x) => x.season === season && x.episode === episode);
  const next = title.kind === "series" ? nextEpisode(episodes, { season, episode }, prefs.fillers) : null;
  const names = namer(db, title, prefs, username);
  const ahead = title.kind === "series" && prefs.fillers === "ask" ? fillerAhead(episodes, { season, episode }) : null;
  const startAt = p && !finished(p) ? p.position : 0;
  const hlsGrant: HlsGrant | null = hls ? {
    stream: sealed(wanted), username, expiresAt,
    screen: { codecs: device.codecs, hdr: device.hdr, dvProfiles: device.dvProfiles, maxHeight: heightCap(device, quality), passthrough: device.passthrough },
    audio: tracks.audio.tags,
    subtitles: tracks.subtitles ? { tags: tracks.subtitles.tags, kind: tracks.subtitles.kind, signsTitles: tracks.subtitles.signsTitles } : null,
    burn: raw.burnSubtitles === true,
    /* A quality switch or another version carries on from where the player is; a fresh play from where they left off. */
    from: Number(raw.startAt) > 0 ? Number(raw.startAt) : startAt,
    skips: [markers.recap, markers.intro].filter((s): s is [number, number] => Array.isArray(s) && s.length === 2 && s[1] > s[0]),
  } : null;
  return {
    url: address(wanted),
    /* The same stream as HLS, for browsers, AirPlay and Chromecast; null for the native apps, which play the file. */
    hls: hlsGrant ? `${origin}/api/v1/watch/hls/${sealHls(sealKey, hlsGrant)}/main.m3u8` : null,
    /* The Quality menu: what's in effect and what else plays here. Switching calls play again with quality and the position. */
    quality: { current: quality, options: qualityOptions(ranked, device, hls) },
    /* bytes: about how big this episode's file is (a season pack's share, by its bitrate), for download sizes and progress. */
    version: { index: ranked.indexOf(wanted), key: copyKey(wanted), label: describe(wanted), badges: badges(wanted), source: wanted.service, bytes: sizeOf(wanted, minutes) },
    versions: ranked.slice(0, 12).map((r, index) => ({ index, key: copyKey(r), label: describe(r), source: r.service })),
    startAt,
    /* Episodes as this person sees them: layout, and labels like "S2:E3", "E27" or "E3". */
    ...(title.kind === "series" ? { layout: names.layout, label: names.label(season, episode) } : {}),
    next: names.named(next),
    /* Ask once when filler is up next and the person hasn't chosen. */
    fillerAhead: ahead ? { ...ahead, first: names.named(ahead.first), canon: names.named(ahead.canon) } : null,
    autoplayNext: prefs.autoplayNext,
    /* Seconds: intro and recap as [start, end], credits as where they start. */
    markers,
    skipIntros: prefs.skipIntros,
    /* Which audio and subtitle tracks to switch on, by the tags containers use; asked: the audio wanted before falling back. */
    tracks: { ...tracks, asked: plan.audio },
    languages: { audio: wanted.languages, subtitles: wanted.subtitles },
  };
}

/**
 * Where the intro, recap and credits are: AniSkip for anime, and what the
 * file itself says for the rest (./skips.ts), each part from the best
 * source that has it, with a guess at the credits when nothing does.
 */
async function markersFor(
  cfg: WatchConfig, username: string, title: Title, episodes: Episode[], season: number, episode: number,
  release: Release, minutes: number | null, fromAniskip: Markers | null, pick: SkipDeps["releasesOf"],
): Promise<Markers> {
  const kind = title.kind === "movie" ? "film" : "episode";
  if (complete(fromAniskip) || !cfg.packager.key) return chooseMarkers({ kind, aniskip: fromAniskip, duration: minutes ? minutes * 60 : null });
  try {
    return await skipsFor(await skipDeps(cfg, username, pick), skipTarget(title, episodes, season, episode, release, minutes), 1500, fromAniskip);
  } catch {
    return chooseMarkers({ kind, aniskip: fromAniskip, duration: minutes ? minutes * 60 : null });
  }
}

/** AniSkip already has the intro and the credits: nothing to work out. */
const complete = (m: Markers | null) => Boolean(m?.intro && m.credits !== undefined);

function skipTarget(title: Title, episodes: Episode[], season: number, episode: number, release: Release, minutes: number | null): SkipTarget {
  return {
    titleId: title.id, kind: title.kind === "movie" ? "film" : "episode", season, episode, release, runtime: minutes,
    seasonEpisodes: episodes.filter((e) => e.season === season).map((e) => e.number),
  };
}

/** The releases another episode would play on this device, best first: the ones worth fingerprinting. */
function picker(cfg: WatchConfig, title: Title, episodes: Episode[], device: ReturnType<typeof cleanDevice>, quality: ReturnType<typeof qualityFor>, want: ReturnType<typeof wantFor>) {
  return async (season: number, episode: number) => {
    const minutes = episodes.find((e) => e.season === season && e.number === episode)?.runtime ?? title.runtime;
    return rank(await releasesFor(cfg, title, season, episode), device, quality, minutes, want, speedsOf(watchDb()), framingOf(watchDb(), title));
  };
}

/** How ./skips.ts reaches the packager and the Portal's relay. */
async function skipDeps(cfg: WatchConfig, username: string, releasesOf: SkipDeps["releasesOf"]): Promise<SkipDeps> {
  const sealKey = await streamKey();
  return {
    db: watchDb(),
    packager: async (path, body, timeoutMs) => {
      /* Fingerprints and the ending read minutes of the file: they wait while someone's play needs the source (./flow.ts). Chapters are only the head, read at play. */
      if (path !== "/chapters") for (const until = Date.now() + 20 * 60_000; playbackNeedsSource() && Date.now() < until;) await new Promise((done) => setTimeout(done, 3000));
      const response = await packagerFetch(cfg, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
      if (!response?.ok) { await response?.body?.cancel().catch(() => {}); return null; }
      try {
        const answer = JSON.parse((await response.text()).trim());
        return answer && typeof answer === "object" && !answer.error ? answer : null;
      } catch { return null; }
    },
    input: (r) => `${cfg.packager.input}/api/v1/watch/stream/${sealStream(sealKey, { url: r.url, username, expiresAt: Date.now() + 6 * 60 * 60 * 1000, source: r.service })}`,
    releasesOf,
  };
}

/** AniSkip's markers for anime, kept a week when found and a day when not; null for everything else. */
async function aniskipFor(cfg: WatchConfig, title: Title, episodes: Episode[], season: number, episode: number): Promise<Markers | null> {
  if (title.shelf !== "Anime") return null;
  const db = watchDb();
  const key = `markers:${title.id}:${season}:${episode}`;
  const known = cached<{ markers: Markers | null }>(db, key);
  if (known) return known.markers;
  const map = await animeMap(cfg.animeMapUrl, join(root, "anime-list.json"));
  const entries = map && title.kind === "series" ? animeEntriesFor(map, { kind: "series", tmdbId: title.tmdbId, imdbId: title.imdbId }) : [];
  const target = aniskipEpisode(entries, episodes, { season, episode }, title.malId);
  if (!target) return null;
  const markers = await aniskip(cfg.aniskipUrl, target.malId, target.episode);
  if (markers === undefined) return null;
  keep(db, key, { markers }, markers ? 7 * 24 * hours(1) : 24 * hours(1));
  return markers;
}

/** For admins: whether each service answers, how setup went, the background check, and the last error. */
export async function status(cfg: WatchConfig) {
  const db = watchDb();
  const tmdbProbe = async (): Promise<Probe> => {
    if (!cfg.tmdbToken) return { ok: false, ms: null, problem: "There's no TMDB key yet." };
    const started = Date.now();
    return tmdb(cfg.tmdbToken, "/configuration").then(
      () => ({ ok: true, ms: Date.now() - started, problem: null }),
      (error) => ({ ok: false, ms: null, problem: error instanceof Error ? error.message : "TMDB didn't answer." }),
    );
  };
  const usenet = Boolean(cfg.usenet.host);
  const [tmdbState, aiostreams, nzbdav] = await Promise.all([
    tmdbProbe(),
    probe(`${cfg.aiostreamsUrl}/api/v1/status`, "AIOStreams isn't answering"),
    usenet ? probe(`${cfg.nzbdavUrl}/api?mode=version`, "nzbdav isn't answering") : Promise.resolve(null),
  ]);
  return {
    tmdb: tmdbState,
    aiostreams,
    nzbdav: nzbdav ? { used: true, ...nzbdav } : { used: false, ok: false, ms: null, problem: null },
    sources: { usenet: usenet && Boolean(cfg.indexer.url), debrid: Boolean(cfg.debrid.service && cfg.debrid.key) },
    provisioning: provisioningOf(db),
    playability: readState<{ at: number; checked: number; of: number }>(db, "playability"),
    lastError: lastError(db),
    /* What each source has really managed lately, in megabits a second and milliseconds to the first byte. */
    speeds: speedsOf(db),
  };
}

/** An image from TMDB, by way of Kimono's disk: `/watch/image/w500/abc.jpg`. */
export async function image(size: string, path: string[]): Promise<Response> {
  const wanted = imageRequest(size, path);
  if (!wanted) return new Response("That isn't an image.", { status: 404 });
  const body = await cachedImage(join(root, "images"), wanted.size, wanted.file);
  if (!body) return new Response("That image isn't there.", { status: 404 });
  return new Response(new Uint8Array(body), { headers: imageHeaders(wanted.type, body.length) });
}

/** The stream itself: the sealed address opened, and the upstream bytes relayed with Range intact so seeking works. */
export async function relay(request: Request, token: string): Promise<Response> {
  const grant = openStream(await streamKey(), token);
  if (!grant) return new Response("This link has run out. Press play again.", { status: 410 });
  const headers = new Headers();
  for (const name of ["range", "if-range", "accept"]) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  /* Counted per person (./flow.ts); the server's own reads (skip markers) carry no "what" and aren't. The packager's reads
     don't keep a stream counted either: it can hold the file open long after the browser left. Its HLS parts' requests do. */
  const what = grant.what;
  const byPackager = new URL(request.url).searchParams.has("packager");
  if (what && endedBefore(grant.username, grant.expiresAt)) return new Response("This was stopped from another screen.", { status: 410 });
  if (what && request.method !== "HEAD" && !byPackager) {
    const screens = screensOf(watchDb(), grant.username);
    if (tooMany(grant.username, what, Date.now(), screens)) return new Response(tooManyNote(screens), { status: 429 });
    asked(grant.username, what);
  }
  const startedAt = performance.now();
  const opened = what ? waitOn(grant.username, what) : () => {};
  const upstream = await fetchUpstream(grant.url, { method: request.method === "HEAD" ? "HEAD" : "GET", headers, signal: request.signal }).finally(opened);
  /* 404 when the copy is gone (refused, or a stand-in clip): the packager passes over it; 502 when it may only be slow. */
  if (!upstream) return new Response("The stream stopped answering. Try another version.", { status: isDead(grant.url) ? 404 : 502 });
  if (!upstream.ok && upstream.status !== 206) {
    await upstream.body?.cancel().catch(() => {});
    const gone = upstream.status >= 400 && upstream.status < 500 && ![408, 416, 429].includes(upstream.status);
    return new Response("The stream stopped answering. Try another version.", { status: gone ? 404 : 502 });
  }
  const out = new Headers({ "cache-control": "private, no-store", "accept-ranges": "bytes" });
  for (const name of ["content-length", "content-range", "last-modified", "etag"]) { const value = upstream.headers.get(name); if (value) out.set(name, value); }
  const type = videoType(upstream.headers.get("content-type"), upstream.url || grant.url);
  if (type) out.set("content-type", type);
  if (request.method === "HEAD" || !upstream.body) return new Response(null, { status: upstream.status, headers: out });
  /* Time the opening burst for the source it came from; the picker reads it next time (./speed.ts). */
  const source = grant.source === "usenet" || grant.source === "debrid" ? grant.source : null;
  const body = source ? meter(upstream.body, startedAt, (bytes, firstByteMs, burstMs) => {
    const sample = sampleOf(bytes, firstByteMs, burstMs);
    if (sample) try { recordSpeed(watchDb(), source, sample); } catch { /* a figure missed is no reason to break playback */ }
  }) : upstream.body;
  return new Response(what ? tracked(body, grant.username, what) : body, { status: upstream.status, headers: out });
}

/**
 * Whether a stall is the server's or the connection's, for the film or
 * episode this person is playing: the player asks when it has been
 * buffering a few seconds and says which.
 */
export function health(username: string, raw: { titleId?: string | null; season?: string | null; episode?: string | null }) {
  const what = watchKey(String(raw.titleId ?? ""), Number(raw.season) || 0, Number(raw.episode) || 0);
  const found = verdict(username, what);
  /* Stalled on their own connection: what it carried is how fast it is. The next pick fits it. */
  if (found.slow === "connection" && found.mbps > 0) try { writeState(watchDb(), `link:${username.toLowerCase()}`, { mbps: found.mbps, at: Date.now() }); } catch { /* only a hint */ }
  return found;
}

/** This person's connection as last measured in a stall, for a few hours: a stall says what it carries. */
function linkOf(username: string): number | undefined {
  const link = readState<{ mbps: number; at: number }>(watchDb(), `link:${username.toLowerCase()}`);
  return link && Date.now() - link.at < 3 * 60 * 60 * 1000 && link.mbps > 0 ? link.mbps : undefined;
}

/* ───── HLS (./hls.ts) ───── */

type HlsSession = { id: string; plan: HlsPlan; spec: PackagerJob & { input: string; segments: number[]; duration: number; ahead: number; start: number; skips: { start: number; end: number }[] }; at: number };
const hlsSessions = ((globalThis as unknown as { kimonoWatchHls?: Map<string, HlsSession> }).kimonoWatchHls ??= new Map());
const hlsStarting = ((globalThis as unknown as { kimonoWatchHlsStarting?: Map<string, Promise<HlsSession>> }).kimonoWatchHlsStarting ??= new Map());

function packagerFetch(cfg: WatchConfig, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${cfg.packager.key}`);
  return fetch(`${cfg.packager.url}${path}`, { ...init, headers });
}

async function putSession(cfg: WatchConfig, session: HlsSession) {
  const put = await packagerFetch(cfg, `/sessions/${session.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(session.spec), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!put?.ok) throw new WatchProblem("The packager isn't answering. Try again in a moment.", 502);
}

/** The packager's session for an HLS address: probed and planned once, then kept while it plays. */
function hlsSession(cfg: WatchConfig, token: string, grant: HlsGrant): Promise<HlsSession> {
  const id = sessionOf(token);
  const known = hlsSessions.get(id);
  if (known) { known.at = Date.now(); return Promise.resolve(known); }
  return shared(hlsStarting, id, async () => {
    const input = `${cfg.packager.input}/api/v1/watch/stream/${grant.stream}?packager=1`;
    const ask = () => packagerFetch(cfg, "/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input }), signal: AbortSignal.timeout(160_000) }).catch(() => null);
    /* A slow source (Usenet's first byte, a debrid link still warming up) is asked again; only an unreadable one fails the play. */
    let answer: Response | null = null;
    for (let attempt = 0; attempt < probeAttempts; attempt++) {
      if (attempt) await new Promise((done) => setTimeout(done, 2000 * attempt));
      answer = await ask();
      const outcome = probeOutcome(answer?.status ?? null);
      if (outcome === "ok") break;
      await answer?.body?.cancel().catch(() => {});
      if (outcome === "unreadable") {
        const stream = openStream(await streamKey(), grant.stream);
        if (stream) markDead(stream.url);
        /* 404: gone for good, so the player moves to the next version at once rather than asking again (./source.ts). */
        throw new WatchProblem("This copy can't be played. Press play again for another.", 404);
      }
      answer = null;
    }
    if (!answer) throw new WatchProblem("This stream is slow to start. Try again in a moment.", 503);
    const probe = (await answer.json()) as HlsProbe;
    const plan = planHls(probe, grant);
    /* Its shape, so a cropped copy of a 4:3 show ranks below the real one next time. */
    const played = openStream(await streamKey(), grant.stream);
    if (played) noteShape(watchDb(), played.url, displayAspect(probe));
    const job = ffmpegArgs(plan, probe.hardware);
    const session: HlsSession = { id, plan, spec: { ...job, input, segments: plan.segments, duration: plan.duration, ahead: 45, start: startSegment(plan.segments, grant.from), skips: (grant.skips ?? []).map(([start, end]) => ({ start, end })) }, at: Date.now() };
    await putSession(cfg, session);
    for (const [key, s] of hlsSessions) if (Date.now() - s.at > 6 * 60 * 60 * 1000) hlsSessions.delete(key);
    hlsSessions.set(id, session);
    return session;
  });
}

const hlsHeaders = (type: string) => new Headers({
  "content-type": type, "cache-control": "private, no-store", "access-control-allow-origin": "*",
  "access-control-expose-headers": "content-length, content-range, accept-ranges",
});

/** An HLS address's playlists (made here) and segments (from the packager, with Range kept). Receivers fetch from other origins, so it answers any. */
export async function hlsRelay(request: Request, token: string, path: string[]): Promise<Response> {
  const grant = openHls(await streamKey(), token);
  if (!grant) return new Response("This link has run out. Press play again.", { status: 410, headers: hlsHeaders("text/plain") });
  return watch(async (cfg) => {
    if (!cfg.packager.key) return new Response("HLS isn't set up on this server.", { status: 404 });
    const session = await hlsSession(cfg, token, grant);
    const wanted = hlsPath(path, session.plan);
    if (!wanted) return new Response("That isn't part of this stream.", { status: 404, headers: hlsHeaders("text/plain") });
    const playlist = "application/vnd.apple.mpegurl";
    if (wanted.kind === "master") return new Response(masterPlaylist(session.plan), { headers: hlsHeaders(playlist) });
    if (wanted.kind === "playlist") {
      const n = Number(wanted.output.slice(1));
      const body = wanted.output[0] === "v" ? mediaPlaylist(session.plan, n) : subtitlePlaylist(session.plan, n);
      return new Response(body, { headers: hlsHeaders(playlist) });
    }
    /* A part asked for: whoever plays it is still watching (./flow.ts). */
    const stream = openStream(await streamKey(), grant.stream);
    const what = stream?.what ?? null;
    if (stream && what && endedBefore(grant.username, stream.expiresAt)) return new Response("This was stopped from another screen.", { status: 410, headers: hlsHeaders("text/plain") });
    if (what && request.method !== "HEAD") {
      const screens = screensOf(watchDb(), grant.username);
      if (tooMany(grant.username, what, Date.now(), screens)) return new Response(tooManyNote(screens), { status: 429, headers: hlsHeaders("text/plain") });
      asked(grant.username, what);
    }
    const headers = new Headers();
    const range = request.headers.get("range");
    if (range) headers.set("range", range);
    const fetchFile = () => packagerFetch(cfg, `/sessions/${session.id}/${wanted.output}/${wanted.file}`, { method: request.method === "HEAD" ? "HEAD" : "GET", headers, signal: request.signal }).catch(() => null);
    let upstream = await fetchFile();
    /* The packager restarted or let the session go idle: describe it again. */
    if (upstream?.status === 404 && upstream.headers.get("x-kimono-packager") === "no-session") {
      await upstream.body?.cancel().catch(() => {});
      await putSession(cfg, session);
      upstream = await fetchFile();
    }
    if (!upstream || (!upstream.ok && upstream.status !== 206)) {
      await upstream?.body?.cancel().catch(() => {});
      return new Response("This part of the stream isn't ready.", { status: upstream?.status === 404 ? 404 : 503, headers: hlsHeaders("text/plain") });
    }
    const out = hlsHeaders(wanted.file.endsWith(".vtt") ? "text/vtt; charset=utf-8" : "video/mp4");
    out.set("cache-control", "private, max-age=3600");
    out.set("accept-ranges", "bytes");
    for (const name of ["content-length", "content-range"]) { const value = upstream.headers.get(name); if (value) out.set(name, value); }
    return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
  });
}

/** Ends every stream this person has going, on any screen, so a new one can start. */
export function endMyStreams(username: string): { ended: number } {
  return { ended: endStreams(username) };
}

/** A player's progress report also says it's still watching (./flow.ts). */
export function stillWatching(username: string, titleId: string, season: number, episode: number) {
  heard(username, watchKey(titleId, season, episode));
}
