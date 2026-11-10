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

export type AnimeEntry = { anilistId: number | null; malId: number | null; season: number | null; type: string };

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
    const entry: AnimeEntry = { anilistId, malId, season: seasonRaw === null ? null : Number(seasonRaw), type: String(e.type ?? "").toUpperCase() };
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
