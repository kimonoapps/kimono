/**
 * Home's rows beyond the personal ones: each a TMDB list or discovery query,
 * kept for hours, and ordered for the person looking. Rows that match what
 * they watch (by genre) move up, the rest keep a sensible house order, and a
 * shelf (Series, Films, Anime) keeps only its own rows.
 *
 * Pure, tested in scripts/test-watch-sources.mjs; the requests are made by
 * home() in ./index.ts.
 */
import type { Shelf } from "./model";

export type RowSpec = {
  id: string;
  title: string;
  /** TMDB path and query; {today} and {daysAgo:N} are filled in. */
  path: string;
  params: Record<string, string>;
  /** Hours a row's list is kept. */
  ttl: number;
  /** Which shelves it belongs on. */
  shelves: Shelf[];
  /** Genre names (as TMDB and AniList write them) that make it personal. */
  genres: string[];
};

const film: Shelf[] = ["Film"];
const series: Shelf[] = ["Series"];
const anime: Shelf[] = ["Anime"];
const popular = { sort_by: "popularity.desc", "vote_count.gte": "150" };

/** The house order: what's new and well loved first, then genres. */
export const rowCatalog: RowSpec[] = [
  { id: "new-episodes", title: "New episodes this week", path: "/tv/on_the_air", params: {}, ttl: 6, shelves: series, genres: [] },
  { id: "new-films", title: "New on Kimono", path: "/discover/movie", params: { sort_by: "popularity.desc", with_release_type: "4|5", "release_date.lte": "{today}", "release_date.gte": "{daysAgo:150}", "vote_count.gte": "40" }, ttl: 12, shelves: film, genres: [] },
  { id: "airing-anime", title: "Anime airing now", path: "/discover/tv", params: { with_genres: "16", with_origin_country: "JP", "air_date.gte": "{daysAgo:10}", "air_date.lte": "{today}", sort_by: "popularity.desc" }, ttl: 6, shelves: anime, genres: ["Animation"] },
  { id: "acclaimed-series", title: "Critically acclaimed series", path: "/tv/top_rated", params: {}, ttl: 48, shelves: series, genres: ["Drama"] },
  { id: "acclaimed-films", title: "Critically acclaimed films", path: "/movie/top_rated", params: {}, ttl: 48, shelves: film, genres: ["Drama"] },
  { id: "gems", title: "Hidden gems", path: "/discover/movie", params: { sort_by: "vote_average.desc", "vote_average.gte": "7.3", "vote_count.gte": "300", "vote_count.lte": "2500" }, ttl: 48, shelves: film, genres: [] },
  { id: "action-films", title: "Action and adventure", path: "/discover/movie", params: { ...popular, with_genres: "28|12" }, ttl: 24, shelves: film, genres: ["Action", "Adventure", "Action & Adventure"] },
  { id: "scifi-series", title: "Sci-fi and fantasy series", path: "/discover/tv", params: { ...popular, with_genres: "10765", without_genres: "16" }, ttl: 24, shelves: series, genres: ["Sci-Fi & Fantasy", "Science Fiction", "Fantasy", "Sci-Fi"] },
  { id: "thrillers", title: "Thrillers", path: "/discover/movie", params: { ...popular, with_genres: "53" }, ttl: 24, shelves: film, genres: ["Thriller", "Mystery", "Suspense"] },
  { id: "crime-series", title: "Crime series", path: "/discover/tv", params: { ...popular, with_genres: "80", without_genres: "16" }, ttl: 24, shelves: series, genres: ["Crime", "Mystery"] },
  { id: "comedy-series", title: "Comedy series", path: "/discover/tv", params: { ...popular, with_genres: "35", without_genres: "16" }, ttl: 24, shelves: series, genres: ["Comedy"] },
  { id: "comedy-films", title: "Comedies", path: "/discover/movie", params: { ...popular, with_genres: "35" }, ttl: 24, shelves: film, genres: ["Comedy"] },
  { id: "drama-series", title: "Drama series", path: "/discover/tv", params: { ...popular, with_genres: "18", without_genres: "16" }, ttl: 24, shelves: series, genres: ["Drama"] },
  { id: "anime-films", title: "Anime films", path: "/discover/movie", params: { with_genres: "16", with_original_language: "ja", sort_by: "popularity.desc", "vote_count.gte": "100" }, ttl: 48, shelves: anime, genres: ["Animation", "Fantasy"] },
  { id: "horror", title: "Horror", path: "/discover/movie", params: { ...popular, with_genres: "27" }, ttl: 24, shelves: film, genres: ["Horror", "Supernatural", "Psychological"] },
  { id: "scifi-films", title: "Science fiction films", path: "/discover/movie", params: { ...popular, with_genres: "878" }, ttl: 24, shelves: film, genres: ["Science Fiction", "Sci-Fi & Fantasy", "Sci-Fi", "Mecha"] },
  { id: "classic-anime", title: "Anime classics", path: "/discover/tv", params: { with_genres: "16", with_origin_country: "JP", "first_air_date.lte": "2012-12-31", sort_by: "vote_count.desc" }, ttl: 72, shelves: anime, genres: ["Animation"] },
  { id: "k-drama", title: "Korean dramas", path: "/discover/tv", params: { with_original_language: "ko", with_genres: "18", sort_by: "popularity.desc", "vote_count.gte": "50" }, ttl: 48, shelves: series, genres: ["Drama", "Romance"] },
  { id: "romance", title: "Romance", path: "/discover/movie", params: { ...popular, with_genres: "10749" }, ttl: 48, shelves: film, genres: ["Romance"] },
  { id: "documentaries", title: "Documentaries", path: "/discover/movie", params: { ...popular, with_genres: "99", "vote_count.gte": "60" }, ttl: 72, shelves: film, genres: ["Documentary"] },
  { id: "family", title: "For the whole family", path: "/discover/movie", params: { ...popular, with_genres: "10751" }, ttl: 48, shelves: film, genres: ["Family", "Kids"] },
];

/** A row's query with today's dates filled in. */
export function fillParams(params: Record<string, string>, now = Date.now()): Record<string, string> {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v === "{today}" ? day(now) : v.replace(/^\{daysAgo:(\d+)\}$/, (_, n) => day(now - Number(n) * 86_400_000))]));
}

/** How much someone watches each genre: their recent titles count most. */
export function genreTaste(recent: { genres: string[] }[]): Map<string, number> {
  const taste = new Map<string, number>();
  recent.slice(0, 20).forEach((t, i) => {
    const weight = 1 / (1 + i * 0.25);
    for (const g of t.genres) taste.set(g, (taste.get(g) ?? 0) + weight);
  });
  return taste;
}

/**
 * The rows for this person and shelf, in order: the house order nudged by
 * taste, so a horror fan sees Horror near the top while new things still
 * lead. A row's position moves by its taste, never past the first two.
 */
export function orderRows(catalog: RowSpec[], taste: Map<string, number>, shelf?: Shelf): RowSpec[] {
  const fits = catalog.filter((r) => !shelf || r.shelves.includes(shelf));
  const most = Math.max(1, ...taste.values());
  const scored = fits.map((r, i) => {
    const liked = Math.max(0, ...r.genres.map((g) => taste.get(g) ?? 0)) / most;
    return { r, at: i < 2 ? i - 10 : i - liked * 8 };
  });
  return scored.sort((a, b) => a.at - b.at).map(({ r }) => r);
}

/** A row needs this many titles that play, or it stays off Home. */
export const rowMinimum = 6;
