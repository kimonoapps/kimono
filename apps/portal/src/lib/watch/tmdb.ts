/**
 * TMDB: titles, seasons, episodes, images, age ratings, trending and search.
 * Images reach the apps through Kimono (./images.ts), never from TMDB.
 * One request per title brings everything a title page needs
 * (append_to_response); episodes come a season at a time, when opened.
 *
 * The mapping from TMDB's answers to the catalog is pure and tested in
 * scripts/test-watch.mjs; the requests are the thin part at the end.
 */
import { titleId, WatchProblem, type Episode, type Season, type Shelf, type Title, type TitleKind } from "./model";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** TMDB's ratings, from any country, on one scale. */
export function kimonoAge(certification: string): string {
  const c = certification.trim().toUpperCase();
  if (!c) return "";
  if (/^(G|TV-Y|TV-G|TV-Y7(-FV)?|PG|TV-PG|U|ALL|0|6|7|A)$/.test(c)) return "7+";
  if (/^(PG-13|TV-14|12A?|13|14|12\+)$/.test(c)) return "13+";
  if (/^(R|15|16|M|MA15\+)$/.test(c)) return "16+";
  if (/^(TV-MA|NC-17|18|R18\+?|X)$/.test(c)) return "18+";
  const n = Number(c.replace(/\D/g, ""));
  if (n) return n >= 18 ? "18+" : n >= 15 ? "16+" : n >= 12 ? "13+" : "7+";
  return "";
}

function certificationOf(details: Json, kind: TitleKind, region: string): string {
  if (kind === "series") {
    const ratings: Json[] = details.content_ratings?.results ?? [];
    return (ratings.find((r) => r.iso_3166_1 === region) ?? ratings.find((r) => r.iso_3166_1 === "US") ?? ratings[0])?.rating ?? "";
  }
  const countries: Json[] = details.release_dates?.results ?? [];
  const country = countries.find((r) => r.iso_3166_1 === region) ?? countries.find((r) => r.iso_3166_1 === "US");
  return (country?.release_dates as Json[] | undefined)?.find((d) => d.certification)?.certification ?? "";
}

/** A logo in the viewer's language, else one without words, else any. */
function logoOf(details: Json): string | null {
  const logos: Json[] = details.images?.logos ?? [];
  return (logos.find((l) => l.iso_639_1 === "en") ?? logos.find((l) => !l.iso_639_1) ?? logos[0])?.file_path ?? null;
}

/** A full title from TMDB's details. Whether it is anime is decided elsewhere (the anime map). */
export function titleFromTmdb(details: Json, kind: TitleKind, region: string, now = Date.now(), shelf?: Shelf): Title {
  const date: string = kind === "movie" ? details.release_date ?? "" : details.first_air_date ?? "";
  const cast: Json[] = (kind === "series" ? details.aggregate_credits?.cast : details.credits?.cast) ?? [];
  const animation = (details.genres ?? []).some((g: Json) => g.id === 16) && (details.origin_country ?? details.production_countries?.map((c: Json) => c.iso_3166_1) ?? []).includes("JP");
  return {
    id: titleId(kind, Number(details.id)), kind, tmdbId: Number(details.id),
    imdbId: details.external_ids?.imdb_id || details.imdb_id || null, anilistId: null, malId: null,
    name: String(details.title ?? details.name ?? ""), overview: String(details.overview ?? ""),
    year: date ? Number(date.slice(0, 4)) || null : null,
    age: kimonoAge(certificationOf(details, kind, region)),
    genres: (details.genres ?? []).map((g: Json) => String(g.name)),
    moods: [],
    shelf: shelf ?? (animation ? "Anime" : kind === "movie" ? "Film" : "Series"),
    poster: details.poster_path ?? null, backdrop: details.backdrop_path ?? null, logo: logoOf(details),
    runtime: kind === "movie" ? details.runtime ?? null : details.episode_run_time?.[0] ?? details.last_episode_to_air?.runtime ?? null,
    popularity: Number(details.popularity ?? 0),
    status: String(details.status ?? ""),
    nextAirDate: details.next_episode_to_air?.air_date ?? null,
    seasonCount: kind === "series" ? Number(details.number_of_seasons ?? 0) : 0,
    cast: cast.slice(0, 6).map((c) => String(c.name)),
    originalLanguage: String(details.original_language ?? ""),
    keywords: ((kind === "movie" ? details.keywords?.keywords : details.keywords?.results) ?? []).slice(0, 25).map((k: Json) => ({ id: Number(k.id), name: String(k.name) })),
    fetchedAt: now,
  };
}

export function seasonsFromTmdb(details: Json): Omit<Season, "titleId" | "fetchedAt">[] {
  return ((details.seasons ?? []) as Json[]).map((s) => ({
    number: Number(s.season_number), name: String(s.name ?? `Season ${s.season_number}`), episodeCount: Number(s.episode_count ?? 0),
    airDate: s.air_date ?? null, poster: s.poster_path ?? null,
  }));
}

export function episodesFromTmdb(season: Json): Omit<Episode, "titleId" | "season">[] {
  return ((season.episodes ?? []) as Json[]).map((e) => ({
    number: Number(e.episode_number), name: String(e.name ?? `Episode ${e.episode_number}`), overview: String(e.overview ?? ""),
    still: e.still_path ?? null, runtime: e.runtime ?? null, airDate: e.air_date ?? null, filler: false, recap: false,
  }));
}

/** A title known only from a list or a search: enough for a poster, fetched in full when opened. */
export function stubFromTmdb(item: Json): Title | null {
  const kind: TitleKind | null = item.media_type === "movie" || item.title ? "movie" : item.media_type === "tv" || item.name ? "series" : null;
  if (!kind || item.media_type === "person" || !item.id) return null;
  const date: string = item.release_date ?? item.first_air_date ?? "";
  return {
    id: titleId(kind, Number(item.id)), kind, tmdbId: Number(item.id), imdbId: null, anilistId: null, malId: null,
    name: String(item.title ?? item.name ?? ""), overview: String(item.overview ?? ""), year: date ? Number(date.slice(0, 4)) || null : null,
    age: item.adult ? "18+" : "", genres: [], moods: [],
    /* Films carry no country in lists: Japanese-language animation counts as anime too. */
    shelf: (item.genre_ids ?? []).includes(16) && ((item.origin_country ?? []).includes("JP") || item.original_language === "ja") ? "Anime" : kind === "movie" ? "Film" : "Series",
    poster: item.poster_path ?? null, backdrop: item.backdrop_path ?? null, logo: null, runtime: null,
    popularity: Number(item.popularity ?? 0), status: "", nextAirDate: null, seasonCount: 0, cast: [], originalLanguage: String(item.original_language ?? ""), keywords: [], fetchedAt: 0,
  };
}

/* ───── Requests ───── */

export async function tmdb(token: string, path: string, params: Record<string, string> = {}): Promise<Json> {
  if (!token) throw new WatchProblem("Watch needs a TMDB key. Add one in Applications → Watch.", 503);
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const v3 = /^[a-f0-9]{32}$/i.test(token);
  if (v3) url.searchParams.set("api_key", token);
  const response = await fetch(url, { headers: { accept: "application/json", ...(v3 ? {} : { authorization: `Bearer ${token}` }) }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) throw new WatchProblem("That title isn't on TMDB.", 404);
  if (!response.ok) throw new WatchProblem("TMDB didn't answer. Try again in a moment.", 502);
  return response.json() as Promise<Json>;
}

export const fetchDetails = (token: string, kind: TitleKind, tmdbId: number) =>
  tmdb(token, `/${kind === "movie" ? "movie" : "tv"}/${tmdbId}`, {
    append_to_response: kind === "movie" ? "release_dates,external_ids,images,credits,keywords" : "content_ratings,external_ids,images,aggregate_credits,keywords",
    include_image_language: "en,null",
  });

export const fetchSeason = (token: string, tmdbId: number, season: number) => tmdb(token, `/tv/${tmdbId}/season/${season}`);
