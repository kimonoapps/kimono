/**
 * Anime: which TMDB titles are anime, their AniList genres and tags, and
 * which episodes are filler or recap (MyAnimeList's flags, through Jikan).
 *
 * TMDB and the anime databases count differently: AniList and MyAnimeList
 * usually make each season (or cour) its own entry. Fribb's anime-lists map
 * connects them, with the TVDB/TMDB season an entry belongs to when known.
 *
 * The matching is pure and tested in scripts/test-watch.mjs.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type AnimeEntry = { anilistId: number | null; malId: number | null; kitsuId: number | null; season: number | null; type: string };

const idOf = (raw: unknown, key: "tv" | "movie"): number | null => {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  if (raw && typeof raw === "object" && key in raw) return idOf((raw as Record<string, unknown>)[key], key);
  return null;
};

export type AnimeMap = { byTmdbTv: Map<number, AnimeEntry[]>; byTmdbMovie: Map<number, AnimeEntry[]>; byTvdb: Map<number, AnimeEntry[]>; byImdb: Map<string, AnimeEntry[]> };

/** Indexes Fribb's list. Entries without an AniList or MyAnimeList id are useless here and skipped. */
export function indexAnimeMap(entries: Json[]): AnimeMap {
  const map: AnimeMap = { byTmdbTv: new Map(), byTmdbMovie: new Map(), byTvdb: new Map(), byImdb: new Map() };
  const add = <K>(index: Map<K, AnimeEntry[]>, key: K | null, entry: AnimeEntry) => { if (key === null || key === undefined) return; index.set(key, [...(index.get(key) ?? []), entry]); };
  for (const e of entries) {
    const anilistId = Number(e.anilist_id) || null, malId = Number(e.mal_id) || null;
    if (!anilistId && !malId) continue;
    const seasonRaw = e.season?.tmdb ?? e.season?.tvdb ?? null;
    const entry: AnimeEntry = { anilistId, malId, kitsuId: Number(e.kitsu_id) || null, season: seasonRaw === null ? null : Number(seasonRaw), type: String(e.type ?? "").toUpperCase() };
    const movie = entry.type === "MOVIE";
    add(movie ? map.byTmdbMovie : map.byTmdbTv, idOf(e.themoviedb_id, movie ? "movie" : "tv"), entry);
    add(map.byTvdb, idOf(e.thetvdb_id ?? e.tvdb_id, "tv"), entry);
    for (const imdb of [e.imdb_id].flat()) if (typeof imdb === "string" && /^tt\d+$/.test(imdb)) add(map.byImdb, imdb, entry);
  }
  return map;
}

/** The anime entries for a TMDB title, in season order: by TMDB id, else TVDB, else IMDb. */
export function animeEntriesFor(map: AnimeMap, t: { kind: "movie" | "series"; tmdbId: number; tvdbId?: number | null; imdbId?: string | null }): AnimeEntry[] {
  const found = (t.kind === "movie" ? map.byTmdbMovie.get(t.tmdbId) : map.byTmdbTv.get(t.tmdbId))
    ?? (t.tvdbId ? map.byTvdb.get(t.tvdbId) : undefined)
    ?? (t.imdbId ? map.byImdb.get(t.imdbId) : undefined)
    ?? [];
  /* Main entries before specials, OVAs and films that share the id. */
  const main = found.filter((e) => t.kind === "movie" ? e.type === "MOVIE" : e.type === "TV" || e.type === "ONA" || e.type === "");
  return (main.length ? main : found).slice().sort((a, b) => (a.season ?? 99) - (b.season ?? 99));
}

/** A Kitsu entry's episode count (null while it's airing) and first air date. */
export type KitsuPart = { kitsuId: number; episodes: number | null; startDate: string | null };

/**
 * Where a TMDB episode sits in Kitsu's counting, for searching by
 * `kitsu:<id>:<episode>`. Anime releases are numbered the way Kitsu (and
 * AniList, MyAnimeList) count, not the way TMDB groups seasons:
 *  - a season that is one Kitsu entry keeps its episode number;
 *  - a season split into parts (two cours) is cut by the parts' episode
 *    counts, in air order; only the last part may still be airing;
 *  - a show that is one long entry (One Piece) counts from its first episode.
 * Anything unclear is null, and the search goes by IMDb as for any show.
 */
export function kitsuEpisode(
  entries: Pick<AnimeEntry, "kitsuId" | "season">[],
  episodes: { season: number; number: number }[],
  at: { season: number; episode: number },
  parts: KitsuPart[],
): { kitsuId: number; episode: number } | null {
  if (at.season <= 0 || at.episode <= 0) return null;
  const count = (id: number) => parts.find((p) => p.kitsuId === id);
  /* Past the entry's known length: the map is wrong for this show, so no guess. */
  const fits = (id: number, episode: number) => { const n = count(id)?.episodes; return n === null || n === undefined || episode <= n; };
  const inSeason = entries.filter((e) => e.season === at.season && e.kitsuId);
  if (inSeason.length === 1) return fits(inSeason[0].kitsuId!, at.episode) ? { kitsuId: inSeason[0].kitsuId!, episode: at.episode } : null;
  if (inSeason.length > 1) {
    const ordered = inSeason.map((e) => count(e.kitsuId!));
    if (ordered.some((p) => !p?.startDate)) return null;
    ordered.sort((a, b) => a!.startDate!.localeCompare(b!.startDate!));
    let before = 0;
    for (const [i, p] of ordered.entries()) {
      const last = i === ordered.length - 1;
      if (p!.episodes === null && !last) return null;
      if (last || at.episode <= before + p!.episodes!) {
        const episode = at.episode - before;
        return fits(p!.kitsuId, episode) ? { kitsuId: p!.kitsuId, episode } : null;
      }
      before += p!.episodes!;
    }
    return null;
  }
  if (entries.length !== 1 || entries[0].season !== null || !entries[0].kitsuId) return null;
  const ordered = episodes.filter((e) => e.season > 0).slice().sort((a, b) => a.season - b.season || a.number - b.number);
  const index = ordered.findIndex((e) => e.season === at.season && e.number === at.episode);
  return index < 0 || !fits(entries[0].kitsuId, index + 1) ? null : { kitsuId: entries[0].kitsuId, episode: index + 1 };
}

/** AniList tags that read as a mood, strongest first, leaving out spoilers. */
export function moodsFrom(tags: { name: string; rank: number; isGeneralSpoiler?: boolean; isMediaSpoiler?: boolean; category?: string }[], limit = 3): string[] {
  const feel = /^(Theme-(Drama|Comedy|Fantasy|Other)|Setting|Cast-Traits)/;
  return tags
    .filter((t) => t.rank >= 60 && !t.isGeneralSpoiler && !t.isMediaSpoiler && (!t.category || feel.test(t.category) || /Theme/.test(t.category)))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((t) => t.name);
}

/** Jikan's episode list as filler and recap flags by the entry's own episode number. */
export function fillerFlags(episodes: { mal_id: number; filler?: boolean; recap?: boolean }[]) {
  return episodes.filter((e) => e.filler || e.recap).map((e) => ({ number: Number(e.mal_id), filler: Boolean(e.filler), recap: Boolean(e.recap) }));
}

/* ───── Requests ───── */

const memory = globalThis as unknown as { kimonoAnimeMap?: { map: AnimeMap; loadedAt: number } };
const week = 7 * 24 * 60 * 60 * 1000;

/** The map, kept on disk for a week and in memory while the server runs. */
export async function animeMap(url: string, path: string): Promise<AnimeMap | null> {
  if (memory.kimonoAnimeMap && Date.now() - memory.kimonoAnimeMap.loadedAt < week) return memory.kimonoAnimeMap.map;
  let raw: string | null = null;
  const age = await stat(path).then((s) => Date.now() - s.mtimeMs).catch(() => Infinity);
  if (age > week) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (response.ok) {
        raw = await response.text();
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, raw, { mode: 0o600 });
      }
    } catch (error) {
      console.warn("Watch couldn't refresh the anime map:", error instanceof Error ? error.message : error);
    }
  }
  raw ??= await readFile(path, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const map = indexAnimeMap(JSON.parse(raw) as Json[]);
    memory.kimonoAnimeMap = { map, loadedAt: Date.now() };
    return map;
  } catch {
    return null;
  }
}

export async function anilistMedia(url: string, id: number): Promise<{ genres: string[]; moods: string[]; malId: number | null } | null> {
  const query = "query($id:Int){Media(id:$id){idMal genres tags{name rank category isGeneralSpoiler isMediaSpoiler}}}";
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ query, variables: { id } }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const media = ((await response.json()) as Json).data?.Media;
    if (!media) return null;
    return { genres: media.genres ?? [], moods: moodsFrom(media.tags ?? []), malId: media.idMal ?? null };
  } catch {
    return null;
  }
}

/** Kitsu's episode counts and air dates for some entries; null when Kitsu doesn't answer. */
export async function kitsuParts(base: string, ids: number[]): Promise<KitsuPart[] | null> {
  if (!ids.length) return [];
  const url = `${base}/anime?filter%5Bid%5D=${ids.join(",")}&fields%5Banime%5D=episodeCount,startDate&page%5Blimit%5D=20`;
  try {
    const response = await fetch(url, { headers: { accept: "application/vnd.api+json" }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    const data: Json[] = ((await response.json()) as Json).data ?? [];
    return data.map((d) => ({ kitsuId: Number(d.id), episodes: Number(d.attributes?.episodeCount) || null, startDate: d.attributes?.startDate ?? null }));
  } catch {
    return null;
  }
}

/** Every episode's flags for one MyAnimeList entry, page by page within Jikan's limits. */
export async function jikanFillers(base: string, malId: number) {
  const flags: ReturnType<typeof fillerFlags> = [];
  for (let page = 1; page <= 40; page++) {
    const response = await fetch(`${base}/anime/${malId}/episodes?page=${page}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!response?.ok) break;
    const body = (await response.json()) as Json;
    flags.push(...fillerFlags(body.data ?? []));
    if (!body.pagination?.has_next_page) break;
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  return flags;
}
