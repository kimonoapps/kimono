/**
 * 観 Kimono Watch — the catalog and everyone's place in it.
 *
 * Nothing here is a file on disk. A title is TMDB's (movies and series),
 * with AniList and MyAnimeList filling in what TMDB lacks for anime (its
 * genres and tags, and which episodes are filler or recap). Titles arrive
 * lazily: the first time anyone opens, searches for or is shown one, it is
 * fetched and kept, and refreshed when it goes stale (sooner while a show is
 * still airing). Streams are never stored: they are found when someone
 * presses play (./streams.ts).
 *
 * Progress, My list and settings are per person (their Kimono username).
 *
 * Pure logic over SQLite, tested in scripts/test-watch.mjs.
 */
import type { DatabaseSync } from "node:sqlite";

export type TitleKind = "movie" | "series";
/** Movies, series and anime: anime is a series or movie that AniList knows. */
export type Shelf = "Film" | "Series" | "Anime";

export type Title = {
  /** "movie-603", "tv-1399": TMDB's kind and id. */
  id: string;
  kind: TitleKind;
  tmdbId: number;
  imdbId: string | null;
  anilistId: number | null;
  malId: number | null;
  name: string;
  overview: string;
  year: number | null;
  /** Kimono's scale: "7+", "13+", "16+", "18+", or "" when nobody rated it. */
  age: string;
  genres: string[];
  /** Words for how it feels ("Eerie", "Cosy"), from AniList's tags or left empty. */
  moods: string[];
  shelf: Shelf;
  /** TMDB image paths, e.g. "/abc.jpg"; see imageUrl. */
  poster: string | null;
  backdrop: string | null;
  logo: string | null;
  runtime: number | null;
  popularity: number;
  /** Series: "Returning Series", "Ended", …; the next episode's air date while airing. */
  status: string;
  nextAirDate: string | null;
  seasonCount: number;
  cast: string[];
  /** ISO 639-1, from TMDB: "ja" for most anime. Decides what "original audio" means. */
  originalLanguage: string;
  /** TMDB's themes ("time travel", "heist", "based on manga"): what Home learns taste from. */
  keywords: { id: number; name: string }[];
  /** First release (films: cinemas or wherever first; series: first episode), "2026-03-04". */
  releaseDate?: string | null;
  /** Films: the earliest digital, disc or TV release anywhere, past or announced. Null when TMDB has none. */
  homeDate?: string | null;
  /** Films: the earliest cinema release anywhere. Null when TMDB lists none (straight to streaming, events). */
  cinemaDate?: string | null;
  fetchedAt: number;
};

export type Season = { titleId: string; number: number; name: string; episodeCount: number; airDate: string | null; poster: string | null; fetchedAt: number };

export type Episode = {
  titleId: string; season: number; number: number;
  name: string; overview: string; still: string | null; runtime: number | null; airDate: string | null;
  /** MyAnimeList's flags, for anime. */
  filler: boolean; recap: boolean;
};

export type Progress = {
  titleId: string; season: number; episode: number;
  /** Seconds in, and the length of what was playing. */
  position: number; duration: number;
  updatedAt: number;
};

/** How a person treats filler: ask the first time one is next, then remember. */
export type FillerChoice = "ask" | "skip" | "watch";
export type Prefs = {
  fillers: FillerChoice;
  /** "auto" picks for the device and connection; the rest cap it. */
  quality: "auto" | "best" | "2160" | "1080" | "720" | "saver";
  /** The audio wanted: "original" (each title's own language) or a language (ISO 639-1). A show can have its own (tracks). */
  preferredLanguage: string;
  /** The audio when no copy has the preferred language. */
  fallbackLanguage: string;
  /** The language the person understands, worked out (never stored by a client): the preferred one, or the fallback while that's "original". What subtitles mean by "my language". */
  audioLanguage: string;
  /** Subtitles in this language; empty means the same as audioLanguage. */
  subtitleLanguage: string;
  /** "auto": subtitles when the audio isn't the person's language (and signs-only when it is). */
  subtitles: "auto" | "always" | "off";
  /** Anime episodes by season, or as one numbered run (One Piece 1–1100) the way fans count them. */
  animeEpisodes: "seasons" | "continuous";
  /** How subtitles look (text subtitles; styled anime ones keep their own look). */
  subtitleSize: "small" | "medium" | "large";
  subtitleBackground: "none" | "shadow" | "box";
  /** Silent previews on Home and title pages. */
  previews: boolean;
  /** Downloads: smaller, or closer to streaming quality. */
  downloadQuality: "standard" | "higher";
  autoplayNext: boolean;
  skipIntros: boolean;
  /** Friends see what this person is watching and how far they are (./friends.ts). */
  shareWatching: boolean;
};
export const defaultPrefs: Prefs = { fillers: "ask", quality: "auto", preferredLanguage: "original", fallbackLanguage: "en", audioLanguage: "en", subtitleLanguage: "", subtitles: "auto", animeEpisodes: "seasons", subtitleSize: "medium", subtitleBackground: "shadow", previews: true, downloadQuality: "standard", autoplayNext: true, skipIntros: false, shareWatching: true };

export class WatchProblem extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function migrate(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS titles (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, tmdb_id INTEGER NOT NULL, imdb_id TEXT, anilist_id INTEGER, mal_id INTEGER,
      name TEXT NOT NULL, overview TEXT NOT NULL DEFAULT '', year INTEGER, age TEXT NOT NULL DEFAULT '',
      genres TEXT NOT NULL DEFAULT '[]', moods TEXT NOT NULL DEFAULT '[]', shelf TEXT NOT NULL,
      poster TEXT, backdrop TEXT, logo TEXT, runtime INTEGER, popularity REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '', next_air_date TEXT, season_count INTEGER NOT NULL DEFAULT 0,
      cast_names TEXT NOT NULL DEFAULT '[]', fetched_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS titles_popularity ON titles (popularity DESC);
    CREATE TABLE IF NOT EXISTS seasons (
      title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE, number INTEGER NOT NULL,
      name TEXT NOT NULL, episode_count INTEGER NOT NULL, air_date TEXT, poster TEXT, fetched_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (title_id, number)
    );
    CREATE TABLE IF NOT EXISTS episodes (
      title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE, season INTEGER NOT NULL, number INTEGER NOT NULL,
      name TEXT NOT NULL, overview TEXT NOT NULL DEFAULT '', still TEXT, runtime INTEGER, air_date TEXT,
      filler INTEGER NOT NULL DEFAULT 0, recap INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (title_id, season, number)
    );
    CREATE TABLE IF NOT EXISTS progress (
      username TEXT NOT NULL, title_id TEXT NOT NULL, season INTEGER NOT NULL, episode INTEGER NOT NULL,
      position REAL NOT NULL, duration REAL NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (username, title_id, season, episode)
    );
    CREATE INDEX IF NOT EXISTS progress_recent ON progress (username, updated_at DESC);
    CREATE TABLE IF NOT EXISTS list (username TEXT NOT NULL, title_id TEXT NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY (username, title_id));
    CREATE TABLE IF NOT EXISTS ratings (username TEXT NOT NULL, title_id TEXT NOT NULL, rating TEXT NOT NULL, PRIMARY KEY (username, title_id));
    CREATE TABLE IF NOT EXISTS reminders (username TEXT NOT NULL, title_id TEXT NOT NULL, PRIMARY KEY (username, title_id));
    CREATE TABLE IF NOT EXISTS prefs (username TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS show_layout (username TEXT NOT NULL, title_id TEXT NOT NULL, episodes TEXT NOT NULL, PRIMARY KEY (username, title_id));
    CREATE TABLE IF NOT EXISTS tracks (username TEXT NOT NULL, title_id TEXT NOT NULL, audio TEXT NOT NULL, subtitles TEXT NOT NULL, PRIMARY KEY (username, title_id));
    CREATE TABLE IF NOT EXISTS device_prefs (username TEXT NOT NULL, device_id TEXT NOT NULL, quality TEXT NOT NULL, PRIMARY KEY (username, device_id));
  `);
  const columns = (db.prepare("PRAGMA table_info(titles)").all() as { name: string }[]).map((c) => c.name);
  if (!columns.includes("original_language")) db.exec("ALTER TABLE titles ADD COLUMN original_language TEXT NOT NULL DEFAULT ''");
  if (!columns.includes("keywords")) db.exec("ALTER TABLE titles ADD COLUMN keywords TEXT NOT NULL DEFAULT '[]'");
  for (const column of ["release_date", "home_date"]) if (!columns.includes(column)) db.exec(`ALTER TABLE titles ADD COLUMN ${column} TEXT`);
  if (!columns.includes("cinema_date")) {
    db.exec("ALTER TABLE titles ADD COLUMN cinema_date TEXT");
    /* Films kept before these dates existed are fetched again on next view (kept meanwhile). */
    db.exec("UPDATE titles SET fetched_at = 1 WHERE fetched_at > 0 AND kind = 'movie'");
  }
}

/* ───── Titles ───── */

export const titleId = (kind: TitleKind, tmdbId: number) => `${kind === "movie" ? "movie" : "tv"}-${tmdbId}`;
export function parseTitleId(id: string): { kind: TitleKind; tmdbId: number } {
  const match = /^(movie|tv)-(\d{1,10})$/.exec(id);
  if (!match) throw new WatchProblem("That isn't a title.", 404);
  return { kind: match[1] === "movie" ? "movie" : "series", tmdbId: Number(match[2]) };
}

type Row = Record<string, unknown>;
const list = (raw: unknown): string[] => { try { const v = JSON.parse(String(raw)); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };
const num = (raw: unknown) => (raw === null || raw === undefined ? null : Number(raw));

function keywordsOf(raw: unknown): { id: number; name: string }[] {
  try { const v = JSON.parse(String(raw ?? "[]")); return Array.isArray(v) ? v.filter((k) => k && typeof k.id === "number" && typeof k.name === "string") : []; } catch { return []; }
}

function titleFrom(row: Row): Title {
  return {
    id: String(row.id), kind: row.kind === "movie" ? "movie" : "series", tmdbId: Number(row.tmdb_id),
    imdbId: (row.imdb_id as string) || null, anilistId: num(row.anilist_id), malId: num(row.mal_id),
    name: String(row.name), overview: String(row.overview), year: num(row.year), age: String(row.age),
    genres: list(row.genres), moods: list(row.moods), shelf: row.shelf as Shelf,
    poster: (row.poster as string) || null, backdrop: (row.backdrop as string) || null, logo: (row.logo as string) || null,
    runtime: num(row.runtime), popularity: Number(row.popularity), status: String(row.status),
    nextAirDate: (row.next_air_date as string) || null, seasonCount: Number(row.season_count),
    cast: list(row.cast_names), originalLanguage: String(row.original_language ?? ""), keywords: keywordsOf(row.keywords),
    releaseDate: (row.release_date as string) || null, homeDate: (row.home_date as string) || null, cinemaDate: (row.cinema_date as string) || null, fetchedAt: Number(row.fetched_at),
  };
}

export function putTitle(db: DatabaseSync, t: Title) {
  db.prepare(`INSERT INTO titles (id, kind, tmdb_id, imdb_id, anilist_id, mal_id, name, overview, year, age, genres, moods, shelf, poster, backdrop, logo, runtime, popularity, status, next_air_date, season_count, cast_names, original_language, keywords, release_date, home_date, cinema_date, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET imdb_id=excluded.imdb_id, anilist_id=excluded.anilist_id, mal_id=excluded.mal_id, name=excluded.name, overview=excluded.overview,
      year=excluded.year, age=excluded.age, genres=excluded.genres, moods=excluded.moods, shelf=excluded.shelf, poster=excluded.poster, backdrop=excluded.backdrop,
      logo=excluded.logo, runtime=excluded.runtime, popularity=excluded.popularity, status=excluded.status, next_air_date=excluded.next_air_date,
      season_count=excluded.season_count, cast_names=excluded.cast_names, original_language=excluded.original_language, keywords=excluded.keywords,
      release_date=COALESCE(excluded.release_date, release_date), home_date=COALESCE(excluded.home_date, home_date), cinema_date=COALESCE(excluded.cinema_date, cinema_date), fetched_at=excluded.fetched_at`)
    .run(t.id, t.kind, t.tmdbId, t.imdbId, t.anilistId, t.malId, t.name, t.overview, t.year, t.age, JSON.stringify(t.genres), JSON.stringify(t.moods), t.shelf,
      t.poster, t.backdrop, t.logo, t.runtime, t.popularity, t.status, t.nextAirDate, t.seasonCount, JSON.stringify(t.cast), t.originalLanguage ?? "", JSON.stringify(t.keywords ?? []), t.releaseDate ?? null, t.homeDate ?? null, t.cinemaDate ?? null, t.fetchedAt);
}

export function getTitle(db: DatabaseSync, id: string): Title | null {
  const row = db.prepare("SELECT * FROM titles WHERE id = ?").get(id) as Row | undefined;
  return row ? titleFrom(row) : null;
}

export function getTitles(db: DatabaseSync, ids: string[]): Title[] {
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT * FROM titles WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Row[];
  const byId = new Map(rows.map((row) => [String(row.id), titleFrom(row)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** How long a title's facts are trusted: a day while it airs, a week once it has ended, a month for films. */
export function staleAfter(t: Pick<Title, "kind" | "status"> & Partial<Pick<Title, "releaseDate" | "homeDate" | "cinemaDate">>, now = Date.now()): number {
  const day = 24 * 60 * 60 * 1000;
  /* A film not out at home yet is asked about daily, so it plays the day it is. */
  if (t.kind === "movie") return (t.cinemaDate && !t.homeDate && now - Date.parse(t.cinemaDate) < 365 * day) || /plan|production/i.test(t.status) ? day : 30 * day;
  return /return|production|plan|pilot/i.test(t.status) ? day : 7 * day;
}
export const isStale = (t: Title, now = Date.now()) => now - t.fetchedAt > staleAfter(t);

/* ───── Seasons and episodes ───── */

export function putSeasons(db: DatabaseSync, id: string, seasons: Omit<Season, "titleId" | "fetchedAt">[]) {
  const keep = db.prepare("SELECT number, fetched_at FROM seasons WHERE title_id = ?").all(id) as Row[];
  const fetched = new Map(keep.map((row) => [Number(row.number), Number(row.fetched_at)]));
  db.prepare("DELETE FROM seasons WHERE title_id = ?").run(id);
  const insert = db.prepare("INSERT INTO seasons (title_id, number, name, episode_count, air_date, poster, fetched_at) VALUES (?,?,?,?,?,?,?)");
  for (const s of seasons) insert.run(id, s.number, s.name, s.episodeCount, s.airDate, s.poster, fetched.get(s.number) ?? 0);
}

export function seasonsOf(db: DatabaseSync, id: string): Season[] {
  return (db.prepare("SELECT * FROM seasons WHERE title_id = ? ORDER BY number").all(id) as Row[]).map((row) => ({
    titleId: id, number: Number(row.number), name: String(row.name), episodeCount: Number(row.episode_count),
    airDate: (row.air_date as string) || null, poster: (row.poster as string) || null, fetchedAt: Number(row.fetched_at),
  }));
}

export function putEpisodes(db: DatabaseSync, id: string, season: number, episodes: Omit<Episode, "titleId" | "season">[], now = Date.now()) {
  /* Filler and recap flags come from elsewhere and later: keep them across a refresh. */
  const flags = new Map((db.prepare("SELECT number, filler, recap FROM episodes WHERE title_id = ? AND season = ?").all(id, season) as Row[])
    .map((row) => [Number(row.number), { filler: Boolean(row.filler), recap: Boolean(row.recap) }]));
  db.prepare("DELETE FROM episodes WHERE title_id = ? AND season = ?").run(id, season);
  const insert = db.prepare("INSERT INTO episodes (title_id, season, number, name, overview, still, runtime, air_date, filler, recap) VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (const e of episodes) {
    const kept = flags.get(e.number);
    insert.run(id, season, e.number, e.name, e.overview, e.still, e.runtime, e.airDate, Number(e.filler || kept?.filler || false), Number(e.recap || kept?.recap || false));
  }
  db.prepare("UPDATE seasons SET fetched_at = ? WHERE title_id = ? AND number = ?").run(now, id, season);
}

export function episodesOf(db: DatabaseSync, id: string, season?: number): Episode[] {
  const rows = (season === undefined
    ? db.prepare("SELECT * FROM episodes WHERE title_id = ? AND season > 0 ORDER BY season, number").all(id)
    : db.prepare("SELECT * FROM episodes WHERE title_id = ? AND season = ? ORDER BY number").all(id, season)) as Row[];
  return rows.map((row) => ({
    titleId: id, season: Number(row.season), number: Number(row.number), name: String(row.name), overview: String(row.overview),
    still: (row.still as string) || null, runtime: num(row.runtime), airDate: (row.air_date as string) || null,
    filler: Boolean(row.filler), recap: Boolean(row.recap),
  }));
}

/** Marks filler and recap episodes by their absolute number across the show (how MyAnimeList counts). */
export function markFillers(db: DatabaseSync, id: string, flags: { absolute: number; filler: boolean; recap: boolean }[]) {
  const all = episodesOf(db, id);
  const update = db.prepare("UPDATE episodes SET filler = ?, recap = ? WHERE title_id = ? AND season = ? AND number = ?");
  const byAbsolute = new Map(flags.map((f) => [f.absolute, f]));
  all.forEach((e, index) => {
    const f = byAbsolute.get(index + 1);
    if (f) update.run(Number(f.filler), Number(f.recap), id, e.season, e.number);
  });
}

/** Marks filler and recap episodes of one season by their number in it (an anime entry that is exactly that season). */
export function markSeasonFillers(db: DatabaseSync, id: string, season: number, flags: { number: number; filler: boolean; recap: boolean }[]) {
  const update = db.prepare("UPDATE episodes SET filler = ?, recap = ? WHERE title_id = ? AND season = ? AND number = ?");
  for (const f of flags) update.run(Number(f.filler), Number(f.recap), id, season, f.number);
}

/* ───── Per person ───── */

export function saveProgress(db: DatabaseSync, username: string, p: Omit<Progress, "updatedAt">, now = Date.now()) {
  if (!(p.duration > 0) || p.position < 0) throw new WatchProblem("Send a position and a duration.");
  db.prepare(`INSERT INTO progress (username, title_id, season, episode, position, duration, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(username, title_id, season, episode) DO UPDATE SET position=excluded.position, duration=excluded.duration, updated_at=excluded.updated_at`)
    .run(username, p.titleId, p.season, p.episode, Math.min(p.position, p.duration), p.duration, now);
}

export function progressOf(db: DatabaseSync, username: string, titleId: string): Progress[] {
  return (db.prepare("SELECT * FROM progress WHERE username = ? AND title_id = ? ORDER BY season, episode").all(username, titleId) as Row[]).map(progressFrom);
}

function progressFrom(row: Row): Progress {
  return { titleId: String(row.title_id), season: Number(row.season), episode: Number(row.episode), position: Number(row.position), duration: Number(row.duration), updatedAt: Number(row.updated_at) };
}

/** Watched means within the last 7% or the last two minutes (the credits). */
export const finished = (p: Pick<Progress, "position" | "duration">) => p.duration > 0 && (p.position / p.duration > 0.93 || p.duration - p.position < 120);
export const fraction = (p?: Pick<Progress, "position" | "duration">) => (p && p.duration > 0 ? Math.min(1, p.position / p.duration) : 0);

/** The titles someone has been watching, most recent first, one entry per title. */
export function recentTitles(db: DatabaseSync, username: string, limit = 20): Progress[] {
  const rows = db.prepare(`SELECT * FROM progress p WHERE username = ? AND updated_at = (SELECT MAX(updated_at) FROM progress q WHERE q.username = p.username AND q.title_id = p.title_id)
    ORDER BY updated_at DESC LIMIT ?`).all(username, limit) as Row[];
  return rows.map(progressFrom);
}

export function listOf(db: DatabaseSync, username: string): string[] {
  return (db.prepare("SELECT title_id FROM list WHERE username = ? ORDER BY added_at DESC").all(username) as Row[]).map((row) => String(row.title_id));
}
export function setListed(db: DatabaseSync, username: string, titleId: string, on: boolean, now = Date.now()) {
  if (on) db.prepare("INSERT OR IGNORE INTO list (username, title_id, added_at) VALUES (?,?,?)").run(username, titleId, now);
  else db.prepare("DELETE FROM list WHERE username = ? AND title_id = ?").run(username, titleId);
}

export type Rating = "down" | "up" | "love";
export function setRating(db: DatabaseSync, username: string, titleId: string, rating: Rating | null) {
  if (rating === null) db.prepare("DELETE FROM ratings WHERE username = ? AND title_id = ?").run(username, titleId);
  else if (rating === "down" || rating === "up" || rating === "love") db.prepare("INSERT INTO ratings (username, title_id, rating) VALUES (?,?,?) ON CONFLICT(username, title_id) DO UPDATE SET rating = excluded.rating").run(username, titleId, rating);
  else throw new WatchProblem("Rate it down, up or love.");
}
export function ratingOf(db: DatabaseSync, username: string, titleId: string): Rating | null {
  const row = db.prepare("SELECT rating FROM ratings WHERE username = ? AND title_id = ?").get(username, titleId) as Row | undefined;
  return row ? (row.rating as Rating) : null;
}

export function setReminder(db: DatabaseSync, username: string, titleId: string, on: boolean) {
  if (on) db.prepare("INSERT OR IGNORE INTO reminders (username, title_id) VALUES (?,?)").run(username, titleId);
  else db.prepare("DELETE FROM reminders WHERE username = ? AND title_id = ?").run(username, titleId);
}
export const remindsOf = (db: DatabaseSync, username: string) => (db.prepare("SELECT title_id FROM reminders WHERE username = ?").all(username) as Row[]).map((row) => String(row.title_id));

export function prefsOf(db: DatabaseSync, username: string): Prefs {
  const row = db.prepare("SELECT body FROM prefs WHERE username = ?").get(username) as Row | undefined;
  if (!row) return { ...defaultPrefs };
  try { return cleanPrefs(fromSubDub(JSON.parse(String(row.body))), defaultPrefs); } catch { return { ...defaultPrefs }; }
}

/** Settings saved before preferred and fallback languages: the original unless films were set to "my language", falling back to that language. */
function fromSubDub(stored: Record<string, unknown>): Record<string, unknown> {
  if (!stored || typeof stored !== "object" || "preferredLanguage" in stored) return stored;
  const mine = typeof stored.audioLanguage === "string" && stored.audioLanguage ? stored.audioLanguage : "en";
  return { ...stored, preferredLanguage: stored.filmAudio === "mine" ? mine : "original", fallbackLanguage: mine };
}

export function cleanPrefs(raw: unknown, base: Prefs): Prefs {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Prefs, unknown>>;
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  const lang = (value: unknown, fallback: string) => (typeof value === "string" && /^([a-z]{2,3})?$/.test(value) ? value : fallback);
  const code = (value: unknown, fallback: string) => (typeof value === "string" && /^[a-z]{2,3}$/.test(value) ? value : fallback);
  const preferred = input.preferredLanguage === "original" ? "original" : code(input.preferredLanguage, base.preferredLanguage);
  /* "original": a copy without the preferred language plays in the title's own. Pointless when that's the preference. */
  const mine = code(base.audioLanguage, "en");
  const asked = input.fallbackLanguage === "original" ? "original" : code(input.fallbackLanguage, base.fallbackLanguage);
  const fallback = asked === "original" && preferred === "original" ? mine : asked;
  return {
    fillers: pick(input.fillers, ["ask", "skip", "watch"] as const, base.fillers),
    quality: pick(input.quality, ["auto", "best", "2160", "1080", "720", "saver"] as const, base.quality),
    preferredLanguage: preferred,
    fallbackLanguage: fallback,
    audioLanguage: preferred !== "original" ? preferred : fallback !== "original" ? fallback : mine,
    subtitleLanguage: lang(input.subtitleLanguage, base.subtitleLanguage),
    subtitles: pick(input.subtitles, ["auto", "always", "off"] as const, base.subtitles),
    animeEpisodes: pick(input.animeEpisodes, ["seasons", "continuous"] as const, base.animeEpisodes),
    subtitleSize: pick(input.subtitleSize, ["small", "medium", "large"] as const, base.subtitleSize),
    subtitleBackground: pick(input.subtitleBackground, ["none", "shadow", "box"] as const, base.subtitleBackground),
    previews: typeof input.previews === "boolean" ? input.previews : base.previews,
    downloadQuality: pick(input.downloadQuality, ["standard", "higher"] as const, base.downloadQuality),
    autoplayNext: typeof input.autoplayNext === "boolean" ? input.autoplayNext : base.autoplayNext,
    skipIntros: typeof input.skipIntros === "boolean" ? input.skipIntros : base.skipIntros,
    shareWatching: typeof input.shareWatching === "boolean" ? input.shareWatching : base.shareWatching,
  };
}

export function savePrefs(db: DatabaseSync, username: string, raw: unknown): Prefs {
  const prefs = cleanPrefs(raw, prefsOf(db, username));
  db.prepare("INSERT INTO prefs (username, body) VALUES (?,?) ON CONFLICT(username) DO UPDATE SET body = excluded.body").run(username, JSON.stringify(prefs));
  return prefs;
}

/* ───── Quality per device ───── */

export type Quality = Prefs["quality"];
const qualities = ["auto", "best", "2160", "1080", "720", "saver"] as const;
export const cleanQuality = (value: unknown): Quality | null => (qualities.includes(value as Quality) ? (value as Quality) : null);
/** An app's or browser's own id for itself: what quality is remembered by. */
export const cleanDeviceId = (value: unknown): string | null => (typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null);

export function deviceQualityOf(db: DatabaseSync, username: string, deviceId: string | null): Quality | null {
  if (!deviceId) return null;
  const row = db.prepare("SELECT quality FROM device_prefs WHERE username = ? AND device_id = ?").get(username, deviceId) as Row | undefined;
  return row ? cleanQuality(row.quality) : null;
}

/** null forgets the device's own choice: it follows the person's settings again. */
export function setDeviceQuality(db: DatabaseSync, username: string, deviceId: string, quality: Quality | null) {
  if (quality === null) db.prepare("DELETE FROM device_prefs WHERE username = ? AND device_id = ?").run(username, deviceId);
  else db.prepare("INSERT INTO device_prefs (username, device_id, quality) VALUES (?,?,?) ON CONFLICT(username, device_id) DO UPDATE SET quality = excluded.quality").run(username, deviceId, quality);
}

/** The quality a play uses: chosen just now, else this device's, else the person's. */
export const qualityFor = (oneOff: Quality | null, device: Quality | null, prefs: Prefs): Quality => oneOff ?? device ?? prefs.quality;

/** Settings as a device sees them: its own quality over the person's, and whether it has one. */
export function devicePrefsOf(db: DatabaseSync, username: string, deviceId: string | null) {
  const prefs = prefsOf(db, username);
  const own = deviceQualityOf(db, username, deviceId);
  return { ...prefs, quality: own ?? prefs.quality, device: deviceId ? { id: deviceId, quality: own } : null };
}

/** The tracks someone picked for a show in the player, kept so the next episode starts the same way. */
export type TrackChoice = { audio: string; subtitles: string };
export function setTracks(db: DatabaseSync, username: string, titleId: string, raw: unknown) {
  /* null forgets the choice: back to the person's settings. */
  if (raw === null) { db.prepare("DELETE FROM tracks WHERE username = ? AND title_id = ?").run(username, titleId); return; }
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const audio = typeof input.audio === "string" && /^[a-z]{2}$/.test(input.audio) ? input.audio : null;
  const subtitles = typeof input.subtitles === "string" && (/^[a-z]{2}$/.test(input.subtitles) || input.subtitles === "off" || input.subtitles === "signs") ? input.subtitles : null;
  if (!audio || !subtitles) throw new WatchProblem("Send an audio language and a subtitle language, signs or off.");
  db.prepare("INSERT INTO tracks (username, title_id, audio, subtitles) VALUES (?,?,?,?) ON CONFLICT(username, title_id) DO UPDATE SET audio = excluded.audio, subtitles = excluded.subtitles")
    .run(username, titleId, audio, subtitles);
}
/** One show's episode layout for this person, over their default for anime ("seasons" or "continuous"); null follows the default. */
export function setShowLayout(db: DatabaseSync, username: string, titleId: string, raw: unknown) {
  if (raw === null) { db.prepare("DELETE FROM show_layout WHERE username = ? AND title_id = ?").run(username, titleId); return; }
  if (raw !== "seasons" && raw !== "continuous") throw new WatchProblem("Episodes are by season or one list.");
  db.prepare("INSERT INTO show_layout (username, title_id, episodes) VALUES (?,?,?) ON CONFLICT(username, title_id) DO UPDATE SET episodes = excluded.episodes").run(username, titleId, raw);
}
export function showLayoutOf(db: DatabaseSync, username: string, titleId: string): "seasons" | "continuous" | null {
  const row = db.prepare("SELECT episodes FROM show_layout WHERE username = ? AND title_id = ?").get(username, titleId) as Row | undefined;
  return row?.episodes === "seasons" || row?.episodes === "continuous" ? row.episodes : null;
}

export function tracksOf(db: DatabaseSync, username: string, titleId: string): TrackChoice | null {
  const row = db.prepare("SELECT audio, subtitles FROM tracks WHERE username = ? AND title_id = ?").get(username, titleId) as Row | undefined;
  return row ? { audio: String(row.audio), subtitles: String(row.subtitles) } : null;
}

/* ───── A small cache for answers from elsewhere (trending lists, stream lookups) ───── */

export function cached<T>(db: DatabaseSync, key: string, now = Date.now()): T | null {
  const row = db.prepare("SELECT body, expires_at FROM cache WHERE key = ?").get(key) as Row | undefined;
  if (!row || Number(row.expires_at) < now) return null;
  try { return JSON.parse(String(row.body)) as T; } catch { return null; }
}
export function keep(db: DatabaseSync, key: string, body: unknown, ttlMs: number, now = Date.now()) {
  db.prepare("INSERT INTO cache (key, body, expires_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at")
    .run(key, JSON.stringify(body), now + ttlMs);
}
export function sweepCache(db: DatabaseSync, now = Date.now()) {
  db.prepare("DELETE FROM cache WHERE expires_at < ?").run(now);
}

/* ───── Kept state: setup, background runs, the last thing that went wrong ───── */

export function readState<T>(db: DatabaseSync, key: string): T | null {
  const row = db.prepare("SELECT body FROM state WHERE key = ?").get(key) as Row | undefined;
  try { return row ? JSON.parse(String(row.body)) as T : null; } catch { return null; }
}
export function writeState(db: DatabaseSync, key: string, body: unknown) {
  db.prepare("INSERT INTO state (key, body) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body").run(key, JSON.stringify(body));
}
