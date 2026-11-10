import "server-only";

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apiError } from "../api-v1";
import { secretName } from "../secret-name";
import { resolveSecrets } from "../secrets";
import { getPlatformSettings } from "../settings";
import { stateDir } from "../state";
import { anyPlayable, notePlayable, playableOf, pool, shared, streamsKey, streamTtl, toCheck, visible } from "./ahead";
import { animeEntriesFor, animeMap, anilistMedia, jikanFillers } from "./anime";
import { watchAppId, watchConfig, type WatchConfig } from "./config";
import { badge, fillerAhead, nextEpisode, resumePoint, seasonTracker } from "./labels";
import {
  cached, episodesOf, finished, fraction, getTitle, getTitles, isStale, keep, listOf, markFillers, markSeasonFillers, migrate, parseTitleId,
  cleanDeviceId, cleanQuality, deviceQualityOf, prefsOf, progressOf, qualityFor, putEpisodes, putSeasons, putTitle, ratingOf, recentTitles, remindsOf, seasonsOf, staleAfter, sweepCache, tracksOf, WatchProblem, readState, writeState,
  type Episode, type Title,
} from "./model";
import { cachedImage, imageHeaders, imageRequest, imageUrl } from "./images";
import { aniskip, aniskipEpisode, fingerprintMarkers, type Markers } from "./markers";
import { badges, cleanDevice, describe, heightCap, qualityOptions, rank, type Release } from "./releases";
import { fetchUpstream, findStreams, stremioId, videoType } from "./streams";
import { playerTracks, trackPlan, wantFor } from "./languages";
import { meter, recordSpeed, sampleOf, speedsOf } from "./speed";
import { ensureProvisioned, hasSources, provisioningOf, type NzbdavAccess } from "./provision";
import { lastError, noteError, probe, type Probe } from "./status";
import { fetchDetails, fetchSeason, seasonsFromTmdb, stubFromTmdb, titleFromTmdb, tmdb, episodesFromTmdb } from "./tmdb";
import { openStream, sealStream } from "./token";
import { migrateTogether } from "./together";
import { anything, castOf, ffmpegArgs, hlsPath, masterPlaylist, mediaPlaylist, openHls, planHls, screenFor, sealHls, sessionOf, subtitlePlaylist, type HlsGrant, type HlsPlan, type PackagerJob, type Probe as HlsProbe } from "./hls";

export * from "./model";

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
  if (known) return known;
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

export async function titleView(cfg: WatchConfig, username: string, origin: string, id: string, seasonWanted?: number) {
  const db = watchDb();
  const title = await ensureTitle(cfg, id);
  const prefs = prefsOf(db, username);
  const progress = progressOf(db, username, id);
  const base = {
    title: { ...cardOf(title, origin), overview: title.overview, genres: title.genres, moods: title.moods, cast: title.cast, runtime: title.runtime, status: title.status, nextAirDate: title.nextAirDate, backdropLarge: imageUrl(origin, title.backdrop, "w1280") },
    inList: listOf(db, username).includes(id), rating: ratingOf(db, username, id), reminding: remindsOf(db, username).includes(id),
    tracks: tracksOf(db, username, id),
    /* Taken as playable until a search says otherwise. */
    playable: Boolean(title.imdbId) && playableOf(db, id) !== false,
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
  return {
    ...base,
    seasons: seasonsOf(db, id).filter((s) => s.number > 0).map((s) => ({ number: s.number, name: s.name, episodeCount: s.episodeCount, airDate: s.airDate })),
    resume,
    tracker: resume.started ? seasonTracker(episodes, progress, resume, prefs.fillers) : null,
    badge: badge(title, episodes, progress.length > 0),
    hasFillers: episodes.some((e) => e.filler),
    fillers: prefs.fillers,
    season,
    episodes: episodes.filter((e) => e.season === season).map((e) => ({
      number: e.number, name: e.name, overview: e.overview, still: imageUrl(origin, e.still, "w500"), runtime: e.runtime, airDate: e.airDate,
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

/** Home: the rows, each a query over the catalog. */
export async function home(cfg: WatchConfig, username: string, origin: string, shelf?: Title["shelf"]) {
  const db = watchDb();
  const ok = (t: Title) => !shelf || t.shelf === shelf;
  const recent = recentTitles(db, username, 30);
  const recentTitlesList = getTitles(db, recent.map((p) => p.titleId));
  const continuing = recent.flatMap((p) => {
    const t = recentTitlesList.find((x) => x.id === p.titleId);
    if (!t || !ok(t)) return [];
    if (t.kind === "movie" && finished(p)) return [];
    return [{ ...cardOf(t, origin), season: p.season, episode: p.episode, fraction: fraction(p), left: Math.max(0, Math.round((p.duration - p.position) / 60)) }];
  }).slice(0, 12);

  const trending = await tmdbList(cfg, "trending:all:week", "/trending/all/week", {}, hours(6));
  const anime = await tmdbList(cfg, "discover:anime", "/discover/tv", { with_genres: "16", with_origin_country: "JP", sort_by: "popularity.desc" }, hours(12));
  const films = await tmdbList(cfg, "trending:movie:week", "/trending/movie/week", {}, hours(6));
  const series = await tmdbList(cfg, "trending:tv:week", "/trending/tv/week", {}, hours(6));
  const last = recentTitlesList[0];
  const similar = last ? await tmdbList(cfg, `similar:${last.id}`, `/${last.kind === "movie" ? "movie" : "tv"}/${last.tmdbId}/recommendations`, {}, hours(24)) : [];
  const mine = getTitles(db, listOf(db, username));
  /* Rows from TMDB leave out what is known not to play; someone's own rows show everything they chose. */
  checkPlayable(cfg, [...trending, ...series, ...similar, ...anime, ...films].filter(ok).map((t) => t.id));
  const plays = (titles: Title[]) => visible(titles.filter(ok), (id) => playableOf(db, id));
  const top = plays(trending).slice(0, 10);

  const rows = [
    continuing.length && { id: "continue", title: "Continue watching", kind: "continue", items: continuing },
    top.length && { id: "top", title: "Top 10 today", kind: "top", items: top.map((t, i) => cardOf(t, origin, { top: i + 1 })) },
    { id: "series", title: "Popular series", kind: "cards", items: plays(series).map((t) => cardOf(t, origin)) },
    last && similar.length && { id: "similar", title: `Because you watched ${last.name}`, kind: "cards", items: plays(similar).map((t) => cardOf(t, origin)) },
    { id: "anime", title: "Anime", kind: "cards", items: plays(anime).map((t) => cardOf(t, origin)) },
    { id: "films", title: "Films for tonight", kind: "cards", items: plays(films).map((t) => cardOf(t, origin)) },
    mine.length && { id: "list", title: "My list", kind: "cards", items: mine.filter(ok).map((t) => cardOf(t, origin)) },
  ].filter((row): row is { id: string; title: string; kind: string; items: Card[] } => Boolean(row) && (row as { items: unknown[] }).items.length > 0);

  const featured = top.find((t) => t.backdrop) ?? null;
  return { featured: featured ? { ...cardOf(featured, origin), backdropLarge: imageUrl(origin, featured.backdrop, "w1280"), overview: featured.overview } : null, rows };
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
  if (known) return Promise.resolve(known);
  return shared(searching, key, async () => {
    if (!title.imdbId) throw new WatchProblem("There's no way to find streams for this one yet.", 404);
    const manifest = await ensureProvisioned(db, cfg, await nzbdavAccess());
    const found = await findStreams(manifest, title.kind, stremioId(title.imdbId, season || undefined, episode || undefined));
    keep(db, key, found, streamTtl);
    /* A first episode or a film with nothing to stream answers for the whole title; anything found does too. */
    if (anyPlayable(found) || (season <= 1 && episode <= 1)) notePlayable(db, title.id, anyPlayable(found));
    return found;
  });
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
  const [found] = await Promise.all([
    releasesFor(cfg, title, next.season, next.episode).catch(() => []),
    markersFor(cfg, title, episodesOf(db, title.id), next.season, next.episode).catch(() => null),
  ]);
  const device = cleanDevice(raw.device);
  const minutes = episodesOf(db, title.id, next.season).find((e) => e.number === next.episode)?.runtime ?? title.runtime;
  const plan = trackPlan(title, prefs, tracksOf(db, username, title.id));
  const quality = qualityFor(cleanQuality(raw.quality), deviceQualityOf(db, username, cleanDeviceId(raw.deviceId)), prefs);
  return { next, ready: rank(found, device, quality, minutes, wantFor(plan, title.originalLanguage), speedsOf(db)).length > 0 };
}

/**
 * Picks what to play on this device and hands back a Kimono address for it,
 * with the other versions, where to start, and what comes after.
 */
export async function play(cfg: WatchConfig, username: string, origin: string, raw: Record<string, unknown>) {
  const db = watchDb();
  const title = await ensureTitle(cfg, String(raw.titleId ?? ""));
  if (!title.imdbId) throw new WatchProblem("There's no way to find streams for this one yet.", 404);
  /* Casting picks for the receiver; the web player and receivers get HLS as well as the file (./hls.ts). */
  const cast = castOf(raw.cast);
  const asked = cleanDevice(raw.device);
  const device = screenFor(asked, cast);
  const hls = Boolean(cfg.packager.key) && (cast !== null || asked.client === "web");
  const prefs = prefsOf(db, username);
  /* Quality: picked in the player just now, else this device's own, else the person's. */
  const quality = qualityFor(cleanQuality(raw.quality), deviceQualityOf(db, username, cleanDeviceId(raw.deviceId)), prefs);
  const season = title.kind === "series" ? Number(raw.season) || 1 : 0;
  const episode = title.kind === "series" ? Number(raw.episode) || 1 : 0;
  let minutes = title.runtime;
  let episodes: Episode[] = [];
  if (title.kind === "series") {
    episodes = await allEpisodes(cfg, title);
    const e = episodes.find((x) => x.season === season && x.number === episode);
    if (!e) throw new WatchProblem("That episode doesn't exist.", 404);
    minutes = e.runtime ?? minutes;
  }

  const [found, markers] = await Promise.all([releasesFor(cfg, title, season, episode), markersFor(cfg, title, episodes, season, episode)]);
  /* Sub or dub: the person's choice for this show, else their settings; the release is picked to carry it. */
  const plan = trackPlan(title, prefs, tracksOf(db, username, title.id));
  let ranked = rank(found, device, quality, minutes, wantFor(plan, title.originalLanguage), speedsOf(db));
  /* Nothing the screen plays as it is: with HLS the packager can transcode anything. */
  if (!ranked.length && hls) ranked = rank(found, anything(device), quality, minutes, wantFor(plan, title.originalLanguage), speedsOf(db));
  const wanted = typeof raw.version === "number" ? ranked[raw.version] : ranked[0];
  if (!wanted) throw new WatchProblem(found.length ? "Nothing here plays on this device yet." : "This isn't available to stream yet.", 404);

  const sealKey = await streamKey();
  const expiresAt = Date.now() + 6 * 60 * 60 * 1000;
  const sealed = (r: { url: string; service: string }) => sealStream(sealKey, { url: r.url, username, expiresAt, source: r.service });
  const address = (r: { url: string; service: string }) => `${origin}/api/v1/watch/stream/${sealed(r)}`;
  const tracks = playerTracks(plan);
  const p = progressOf(db, username, title.id).find((x) => x.season === season && x.episode === episode);
  const next = title.kind === "series" ? nextEpisode(episodes, { season, episode }, prefs.fillers) : null;
  const hlsGrant: HlsGrant | null = hls ? {
    stream: sealed(wanted), username, expiresAt,
    screen: { codecs: device.codecs, hdr: device.hdr, dvProfiles: device.dvProfiles, maxHeight: heightCap(device, quality), passthrough: device.passthrough },
    audio: tracks.audio.tags,
    subtitles: tracks.subtitles ? { tags: tracks.subtitles.tags, kind: tracks.subtitles.kind, signsTitles: tracks.subtitles.signsTitles } : null,
    burn: raw.burnSubtitles === true,
  } : null;
  return {
    url: address(wanted),
    /* The same stream as HLS, for browsers, AirPlay and Chromecast; null for the native apps, which play the file. */
    hls: hlsGrant ? `${origin}/api/v1/watch/hls/${sealHls(sealKey, hlsGrant)}/main.m3u8` : null,
    /* The Quality menu: what's in effect and what else plays here. Switching calls play again with quality and the position. */
    quality: { current: quality, options: qualityOptions(ranked, device, hls) },
    version: { index: ranked.indexOf(wanted), label: describe(wanted), badges: badges(wanted), source: wanted.service },
    versions: ranked.slice(0, 12).map((r, index) => ({ index, label: describe(r), source: r.service })),
    startAt: p && !finished(p) ? p.position : 0,
    next,
    /* Ask once when filler is up next and the person hasn't chosen. */
    fillerAhead: title.kind === "series" && prefs.fillers === "ask" ? fillerAhead(episodes, { season, episode }) : null,
    autoplayNext: prefs.autoplayNext,
    /* Seconds: intro and recap as [start, end], credits as where they start. */
    markers: markers ?? {},
    skipIntros: prefs.skipIntros,
    /* Which audio and subtitle tracks to switch on, by the tags containers use. */
    tracks,
    languages: { audio: wanted.languages, subtitles: wanted.subtitles },
  };
}

/**
 * Where the intro, recap and credits are: AniSkip for anime, kept a week when
 * found and a day when not; nothing yet for the rest (fingerprintMarkers).
 */
async function markersFor(cfg: WatchConfig, title: Title, episodes: Episode[], season: number, episode: number): Promise<Markers | null> {
  if (title.shelf !== "Anime") return fingerprintMarkers(title.id, season, episode);
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
  const startedAt = performance.now();
  const upstream = await fetchUpstream(grant.url, { method: request.method === "HEAD" ? "HEAD" : "GET", headers, signal: request.signal });
  if (!upstream || (!upstream.ok && upstream.status !== 206)) return new Response("The stream stopped answering. Try another version.", { status: 502 });
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
  return new Response(body, { status: upstream.status, headers: out });
}

/* ───── HLS (./hls.ts) ───── */

type HlsSession = { id: string; plan: HlsPlan; spec: PackagerJob & { input: string; segments: number[]; duration: number; ahead: number }; at: number };
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
    const input = `${cfg.packager.input}/api/v1/watch/stream/${grant.stream}`;
    const ask = () => packagerFetch(cfg, "/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input }), signal: AbortSignal.timeout(75_000) }).catch(() => null);
    /* Once more when the packager isn't answering yet (it restarts with the server). */
    const answer = (await ask()) ?? (await new Promise((done) => setTimeout(done, 2000)), await ask());
    if (!answer?.ok) throw new WatchProblem("This stream couldn't be read. Try another version.", 502);
    const probe = (await answer.json()) as HlsProbe;
    const plan = planHls(probe, grant);
    const job = ffmpegArgs(plan, probe.hardware);
    const session: HlsSession = { id, plan, spec: { ...job, input, segments: plan.segments, duration: plan.duration, ahead: 45 }, at: Date.now() };
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
