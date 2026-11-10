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

/** How far a plan goes: far enough to feel endless. */
const maxPlan = 300;

/** A row needs this many titles that play, or it stays off Home. */
export const rowMinimum = 6;

/* ───── Endless Home: rows from what someone watches most ───── */

type Kind = "series" | "film" | "anime";
const kindWord: Record<Kind, string> = { series: "series", film: "films", anime: "anime" };

/* TMDB's genre ids by the names catalogs use (TMDB's own, and AniList's for anime). */
const filmGenre: Record<string, string> = {
  Action: "28", Adventure: "12", "Action & Adventure": "28|12", Comedy: "35", Crime: "80", Documentary: "99", Drama: "18",
  Family: "10751", Fantasy: "14", History: "36", Horror: "27", Music: "10402", Mystery: "9648", Romance: "10749",
  "Science Fiction": "878", "Sci-Fi & Fantasy": "878|14", "Sci-Fi": "878", Thriller: "53", War: "10752", "War & Politics": "10752",
  Western: "37", Psychological: "53", Supernatural: "27|14", Suspense: "53", Mecha: "878", Sports: "18",
};
const seriesGenre: Record<string, string> = {
  Action: "10759", Adventure: "10759", "Action & Adventure": "10759", Comedy: "35", Crime: "80", Documentary: "99", Drama: "18",
  Family: "10751", Kids: "10762", Mystery: "9648", Thriller: "9648|80", Suspense: "9648", "Science Fiction": "10765",
  "Sci-Fi & Fantasy": "10765", Fantasy: "10765", "Sci-Fi": "10765", Supernatural: "10765", "War & Politics": "10768", War: "10768",
  Western: "37", Psychological: "9648", Mecha: "10765",
};
/* Genres too broad to say much about someone's taste on their own. */
const broad = new Set(["Animation", "Drama", "Action & Adventure", "Comedy"]);

/** A row's name for a genre: "Sci-Fi & Fantasy" → "Sci-fi and fantasy". */
export function genreName(g: string): string {
  const s = g.replace(/ & /g, " and ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type Taste = {
  genres: Map<string, number>;
  keywords: Map<number, { name: string; weight: number }>;
  kinds: Map<Kind, number>;
};

/** What someone watches a lot: genres, TMDB themes and kinds, recent titles counting most. */
export function tasteOf(titles: { genres: string[]; keywords?: { id: number; name: string }[]; shelf: Shelf; kind: "movie" | "series" }[]): Taste {
  const taste: Taste = { genres: new Map(), keywords: new Map(), kinds: new Map() };
  titles.slice(0, 40).forEach((t, i) => {
    const w = 1 / (1 + i * 0.2);
    for (const g of t.genres) if (g !== "Animation") taste.genres.set(g, (taste.genres.get(g) ?? 0) + (broad.has(g) ? w * 0.5 : w));
    for (const k of t.keywords ?? []) {
      const was = taste.keywords.get(k.id);
      taste.keywords.set(k.id, { name: k.name, weight: (was?.weight ?? 0) + w });
    }
    const kind: Kind = t.shelf === "Anime" ? "anime" : t.kind === "movie" ? "film" : "series";
    taste.kinds.set(kind, (taste.kinds.get(kind) ?? 0) + w);
  });
  return taste;
}

export type PlannedRow = RowSpec & { score: number } | { id: string; title: ""; similar: number; score: number };

function discover(kind: Kind, extra: Record<string, string>, page: number) {
  const base: { path: string; params: Record<string, string> } = kind === "film"
    ? { path: "/discover/movie", params: { sort_by: "popularity.desc", "vote_count.gte": "80" } }
    : kind === "anime"
      ? { path: "/discover/tv", params: { sort_by: "popularity.desc", with_origin_country: "JP", "vote_count.gte": "20" } }
      : { path: "/discover/tv", params: { sort_by: "popularity.desc", "vote_count.gte": "60", without_genres: "16,10763,10764,10766,10767" } };
  const params: Record<string, string> = { ...base.params, ...extra, ...(page > 1 ? { page: String(page) } : {}) };
  if (kind === "anime") params.with_genres = ["16", extra.with_genres].filter(Boolean).join(",");
  return { path: base.path, params };
}

/**
 * Home's whole plan for someone, as long as their taste allows: the house
 * rows, then every genre and theme they watch a lot as series, films and
 * anime (pages two and three as "More …"), and "Because you watched" rows
 * for many recent titles, sorted by how much each matters to them. Home
 * serves it a page at a time, so it scrolls on and on.
 */
export function planRows(taste: Taste, recentCount: number, shelf?: Shelf, catalog: RowSpec[] = rowCatalog): PlannedRow[] {
  const kinds: Kind[] = shelf === "Anime" ? ["anime"] : shelf === "Film" ? ["film"] : shelf === "Series" ? ["series"] : ["series", "film", "anime"];
  const kindTotal = [...taste.kinds.values()].reduce((a, b) => a + b, 0) || 1;
  /* Kinds someone never watches still appear, lower. */
  const kindWeight = (k: Kind) => 0.35 + (taste.kinds.get(k) ?? 0) / kindTotal;
  const top = Math.max(1, ...taste.genres.values(), ...[...taste.keywords.values()].map((k) => k.weight));
  const out: PlannedRow[] = [];
  const seen = new Set<string>();
  /* One row per name and per query: a taste row that matches a house row is the house row. */
  const add = (row: PlannedRow) => {
    const keys = [row.id, ...("path" in row ? [`t:${row.title.toLowerCase()}`, `q:${row.path}?${Object.entries(row.params).sort().map(([k, v]) => `${k}=${v}`).join("&")}`] : [])];
    if (keys.some((k) => seen.has(k))) return;
    keys.forEach((k) => seen.add(k));
    out.push(row);
  };

  orderRows(catalog, taste.genres, shelf).forEach((r, i) => add({ ...r, score: 1.2 - i * 0.04 }));
  for (const [g, weight] of [...taste.genres].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
    for (const k of kinds) {
      const id = k === "film" ? filmGenre[g] : seriesGenre[g];
      if (!id) continue;
      for (const page of [1, 2, 3]) {
        const q = discover(k, { with_genres: id }, page);
        add({ id: `genre-${k}-${g}-${page}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"), title: page === 1 ? `${genreName(g)} ${kindWord[k]}` : `${page === 2 ? "More" : "Even more"} ${genreName(g).toLowerCase()} ${kindWord[k]}`, ...q, ttl: 24, shelves: [k === "film" ? "Film" : k === "anime" ? "Anime" : "Series"], genres: [g], score: (weight / top) * kindWeight(k) * (page === 1 ? 1 : page === 2 ? 0.55 : 0.3) });
      }
    }
  }
  for (const [kid, { name, weight }] of [...taste.keywords].filter(([, k]) => k.weight >= top * 0.15).sort((a, b) => b[1].weight - a[1].weight).slice(0, 16)) {
    for (const k of kinds) {
      const q = discover(k, { with_keywords: String(kid) }, 1);
      add({ id: `theme-${k}-${kid}`, title: `${name.charAt(0).toUpperCase()}${name.slice(1)} ${kindWord[k]}`, ...q, ttl: 48, shelves: [k === "film" ? "Film" : k === "anime" ? "Anime" : "Series"], genres: [], score: (weight / top) * kindWeight(k) * 0.9 });
    }
  }
  for (let i = 0; i < Math.min(recentCount, 12); i++) add({ id: `similar-${i}`, title: "", similar: i, score: 1.1 - i * 0.12 });

  /* Then on and on: deeper pages of what they like most, strongest first, so Home doesn't run out. */
  const deep = [...taste.genres].sort((a, b) => b[1] - a[1]).slice(0, 8).flatMap(([g, weight]) => kinds.map((k) => ({ g, k, weight: (weight / top) * kindWeight(k) })))
    .filter(({ g, k }) => (k === "film" ? filmGenre[g] : seriesGenre[g]));
  const fallback: { g: string; k: Kind; weight: number }[] = deep.length ? deep : kinds.flatMap((k) => ["Drama", "Comedy", "Action & Adventure", "Mystery"].map((g) => ({ g, k, weight: 0.2 })));
  for (let page = 4; out.length < maxPlan && page <= 40; page++) {
    for (const { g, k, weight } of fallback) {
      if (out.length >= maxPlan) break;
      const q = discover(k, { with_genres: (k === "film" ? filmGenre[g] : seriesGenre[g])! }, page);
      add({ id: `genre-${k}-${g}-${page}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"), title: `${genreName(g)} ${kindWord[k]}, part ${page}`, ...q, ttl: 48, shelves: [k === "film" ? "Film" : k === "anime" ? "Anime" : "Series"], genres: [g], score: weight * 0.25 / page });
    }
  }

  /* Sorted by how much each matters, then spread so two rows of the same thing don't sit together. */
  const sorted = out.sort((a, b) => b.score - a.score);
  const spread: PlannedRow[] = [];
  const pending = [...sorted];
  while (pending.length) {
    const last = spread[spread.length - 1];
    const lastKey = last && "genres" in last ? last.genres[0] ?? last.id : null;
    const at = pending.findIndex((r) => !("genres" in r) || (r.genres[0] ?? r.id) !== lastKey);
    spread.push(...pending.splice(at < 0 ? 0 : at, 1));
  }
  return spread;
}
