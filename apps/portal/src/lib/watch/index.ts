import "server-only";

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apiError } from "../api-v1";
import { secretName } from "../secret-name";
import { resolveSecrets } from "../secrets";
import { getPlatformSettings } from "../settings";
import { stateDir } from "../state";
import { animeEntriesFor, animeMap, anilistMedia, jikanFillers } from "./anime";
import { watchAppId, watchConfig, type WatchConfig } from "./config";
import { badge, fillerAhead, nextEpisode, resumePoint, seasonTracker } from "./labels";
import {
  cached, episodesOf, finished, fraction, getTitle, getTitles, isStale, keep, listOf, markFillers, markSeasonFillers, migrate, parseTitleId,
  prefsOf, progressOf, putEpisodes, putSeasons, putTitle, ratingOf, recentTitles, remindsOf, seasonsOf, staleAfter, sweepCache, WatchProblem,
  type Episode, type Title,
} from "./model";
import { badges, cleanDevice, describe, rank } from "./releases";
import { findStreams, stremioId, upstreamRequest } from "./streams";
import { ensureProvisioned, type NzbdavAccess } from "./provision";
import { fetchDetails, fetchSeason, imageUrl, seasonsFromTmdb, stubFromTmdb, titleFromTmdb, tmdb, episodesFromTmdb } from "./tmdb";
import { openStream, sealStream } from "./token";

export * from "./model";

const root = join(stateDir, "watch");
const cache = globalThis as unknown as { kimonoWatch?: DatabaseSync; kimonoWatchSwept?: number };

export function watchDb(): DatabaseSync {
  if (!cache.kimonoWatch) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const opened = new DatabaseSync(join(root, "watch.db"));
    migrate(opened);
    cache.kimonoWatch = opened;
  }
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
    if (error instanceof WatchProblem) return apiError(error.status, error.message);
    console.warn("Watch request failed:", error instanceof Error ? error.message : error);
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

export function cardOf(t: Title, extra: Partial<Card> = {}): Card {
  return {
    id: t.id, name: t.name, kind: t.kind, shelf: t.shelf, year: t.year, age: t.age,
    poster: imageUrl(t.poster, "w500"), backdrop: imageUrl(t.backdrop, "w780"), logo: imageUrl(t.logo, "w500"), ...extra,
  };
}

export async function titleView(cfg: WatchConfig, username: string, id: string, seasonWanted?: number) {
  const db = watchDb();
  const title = await ensureTitle(cfg, id);
  const prefs = prefsOf(db, username);
  const progress = progressOf(db, username, id);
  const base = {
    title: { ...cardOf(title), overview: title.overview, genres: title.genres, moods: title.moods, cast: title.cast, runtime: title.runtime, status: title.status, nextAirDate: title.nextAirDate, backdropLarge: imageUrl(title.backdrop, "w1280") },
    inList: listOf(db, username).includes(id), rating: ratingOf(db, username, id), reminding: remindsOf(db, username).includes(id),
  };
  if (title.kind === "movie") {
    const p = progress.find((x) => x.season === 0 && x.episode === 0);
    return { ...base, resume: p && !finished(p) ? { position: p.position, fraction: fraction(p) } : null };
  }
  const episodes = await allEpisodes(cfg, title);
  const resume = resumePoint(episodes, progress, prefs.fillers);
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
      number: e.number, name: e.name, overview: e.overview, still: imageUrl(e.still, "w500"), runtime: e.runtime, airDate: e.airDate,
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
export async function home(cfg: WatchConfig, username: string, shelf?: Title["shelf"]) {
  const db = watchDb();
  const ok = (t: Title) => !shelf || t.shelf === shelf;
  const recent = recentTitles(db, username, 30);
  const recentTitlesList = getTitles(db, recent.map((p) => p.titleId));
  const continuing = recent.flatMap((p) => {
    const t = recentTitlesList.find((x) => x.id === p.titleId);
    if (!t || !ok(t)) return [];
    if (t.kind === "movie" && finished(p)) return [];
    return [{ ...cardOf(t), season: p.season, episode: p.episode, fraction: fraction(p), left: Math.max(0, Math.round((p.duration - p.position) / 60)) }];
  }).slice(0, 12);

  const trending = await tmdbList(cfg, "trending:all:week", "/trending/all/week", {}, hours(6));
  const top = trending.filter(ok).slice(0, 10);
  const anime = await tmdbList(cfg, "discover:anime", "/discover/tv", { with_genres: "16", with_origin_country: "JP", sort_by: "popularity.desc" }, hours(12));
  const films = await tmdbList(cfg, "trending:movie:week", "/trending/movie/week", {}, hours(6));
  const series = await tmdbList(cfg, "trending:tv:week", "/trending/tv/week", {}, hours(6));
  const last = recentTitlesList[0];
  const similar = last ? await tmdbList(cfg, `similar:${last.id}`, `/${last.kind === "movie" ? "movie" : "tv"}/${last.tmdbId}/recommendations`, {}, hours(24)) : [];
  const mine = getTitles(db, listOf(db, username));

  const rows = [
    continuing.length && { id: "continue", title: "Continue watching", kind: "continue", items: continuing },
    top.length && { id: "top", title: "Top 10 today", kind: "top", items: top.map((t, i) => cardOf(t, { top: i + 1 })) },
    { id: "series", title: "Popular series", kind: "cards", items: series.filter(ok).map((t) => cardOf(t)) },
    last && similar.length && { id: "similar", title: `Because you watched ${last.name}`, kind: "cards", items: similar.filter(ok).map((t) => cardOf(t)) },
    { id: "anime", title: "Anime", kind: "cards", items: anime.filter(ok).map((t) => cardOf(t)) },
    { id: "films", title: "Films for tonight", kind: "cards", items: films.filter(ok).map((t) => cardOf(t)) },
    mine.length && { id: "list", title: "My list", kind: "cards", items: mine.filter(ok).map((t) => cardOf(t)) },
  ].filter((row): row is { id: string; title: string; kind: string; items: Card[] } => Boolean(row) && (row as { items: unknown[] }).items.length > 0);

  const featured = top.find((t) => t.backdrop) ?? null;
  return { featured: featured ? { ...cardOf(featured), backdropLarge: imageUrl(featured.backdrop, "w1280"), overview: featured.overview } : null, rows };
}

export async function search(cfg: WatchConfig, query: string) {
  const q = query.trim().slice(0, 100);
  if (!q) return { results: (await tmdbList(cfg, "trending:all:week", "/trending/all/week", {}, hours(6))).slice(0, 12).map((t) => cardOf(t)) };
  const body = await tmdb(cfg.tmdbToken, "/search/multi", { query: q, include_adult: "false" });
  const titles = ((body.results ?? []) as Record<string, unknown>[]).map((item) => seed(stubFromTmdb(item))).filter((t): t is Title => Boolean(t));
  return { results: titles.slice(0, 30).map((t) => cardOf(t)) };
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
 * Picks what to play on this device and hands back a Kimono address for it,
 * with the other versions, where to start, and what comes after.
 */
export async function play(cfg: WatchConfig, username: string, origin: string, raw: Record<string, unknown>) {
  const db = watchDb();
  const title = await ensureTitle(cfg, String(raw.titleId ?? ""));
  if (!title.imdbId) throw new WatchProblem("There's no way to find streams for this one yet.", 404);
  const device = cleanDevice(raw.device);
  const prefs = prefsOf(db, username);
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

  const key = `streams:${title.id}:${season}:${episode}`;
  const found = cached<ReturnType<typeof rank>>(db, key)
    ?? await findStreams(await ensureProvisioned(db, cfg, await nzbdavAccess()), title.kind, stremioId(title.imdbId, season || undefined, episode || undefined));
  keep(db, key, found, 20 * 60 * 1000);
  const ranked = rank(found, device, prefs.quality, minutes, prefs.audioLanguage || "en");
  const wanted = typeof raw.version === "number" ? ranked[raw.version] : ranked[0];
  if (!wanted) throw new WatchProblem(found.length ? "Nothing here plays on this device yet." : "This isn't available to stream yet.", 404);

  const sealKey = await streamKey();
  const expiresAt = Date.now() + 6 * 60 * 60 * 1000;
  const address = (url: string) => `${origin}/api/v1/watch/stream/${sealStream(sealKey, { url, username, expiresAt })}`;
  const p = progressOf(db, username, title.id).find((x) => x.season === season && x.episode === episode);
  const next = title.kind === "series" ? nextEpisode(episodes, { season, episode }, prefs.fillers) : null;
  return {
    url: address(wanted.url),
    version: { index: ranked.indexOf(wanted), label: describe(wanted), badges: badges(wanted) },
    versions: ranked.slice(0, 8).map((r, index) => ({ index, label: describe(r) })),
    startAt: p && !finished(p) ? p.position : 0,
    next,
    /* Ask once when filler is up next and the person hasn't chosen. */
    fillerAhead: title.kind === "series" && prefs.fillers === "ask" ? fillerAhead(episodes, { season, episode }) : null,
    autoplayNext: prefs.autoplayNext,
  };
}

/** The stream itself: the sealed address opened, and the upstream bytes relayed with Range intact so seeking works. */
export async function relay(request: Request, token: string): Promise<Response> {
  const grant = openStream(await streamKey(), token);
  if (!grant) return new Response("This link has run out. Press play again.", { status: 410 });
  const headers = new Headers();
  for (const name of ["range", "if-range", "accept"]) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  const target = upstreamRequest(grant.url);
  if (target.authorization) headers.set("authorization", target.authorization);
  const upstream = await fetch(target.url, { method: request.method === "HEAD" ? "HEAD" : "GET", headers, redirect: "follow", signal: request.signal }).catch(() => null);
  if (!upstream || (!upstream.ok && upstream.status !== 206)) return new Response("The stream stopped answering. Try another version.", { status: 502 });
  const out = new Headers({ "cache-control": "private, no-store", "accept-ranges": "bytes" });
  for (const name of ["content-type", "content-length", "content-range", "last-modified", "etag"]) { const value = upstream.headers.get(name); if (value) out.set(name, value); }
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
}
