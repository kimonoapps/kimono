import "server-only";

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apiError } from "../api-v1";
import { getPlatformSettings } from "../settings";
import { stateDir } from "../state";
import { annas } from "./annas";
import { annasFiles } from "./annas-files";
import { booksConfig, type BooksConfig } from "./config";
import { BooksProblem, dedupe, emptyBook, identity, merge, normalizeIsbn, sourceOf, type Book, type Rating, type Row, type ShelfItem, type ShelfState } from "./model";
import { googleBooks, hardcover, openLibrary, type LiveSource } from "./sources";
import { registerFileSource } from "./files";
import { registerTestFiles } from "./test-files";
import { registerConversions } from "./convert";
import { codeConfig } from "../code/config";

registerTestFiles();
/* A PDF is also offered as an EPUB, made with Kimono AI's Claude token when there is one (lib/books/convert). */
registerConversions({ bookFor: (key) => getBook(key), token: async () => codeConfig(await getPlatformSettings()).modelToken });
registerFileSource(annasFiles(async () => (await booksSettings()).annas));

export * from "./model";

/*
 * 本 Kimono Books, server side. Nothing is downloaded in bulk: a book is
 * looked up live the first time anyone needs it (Open Library, Google Books,
 * Hardcover, Anna's Archive's metadata), kept in books.db, and kept fresh:
 * records are checked again after a month, and a lookup that found nothing
 * is tried again after a day, a week, then monthly.
 */

const root = join(stateDir, "books");
const g = globalThis as unknown as { kimonoBooks?: DatabaseSync };

const DAY = 24 * 60 * 60 * 1000;
const staleAfter = 30 * DAY;
const searchFresh = 7 * DAY;
const retryAfter = (tries: number) => tries <= 1 ? DAY : tries === 2 ? 7 * DAY : 30 * DAY;

/* The schema, brought up to date whenever new code meets an open database
   (a hot reload keeps the connection, an update keeps the file). */
function migrate(db: DatabaseSync) {
  db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS records (
  key TEXT PRIMARY KEY, data TEXT NOT NULL, identity TEXT NOT NULL,
  readers INTEGER NOT NULL DEFAULT 0, checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS records_identity ON records (identity);
CREATE INDEX IF NOT EXISTS records_checked ON records (checked_at);
CREATE TABLE IF NOT EXISTS isbns (isbn TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY (isbn, key));
CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5 (key UNINDEXED, title, authors, genres, tokenize = 'unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS genres (key TEXT NOT NULL, genre TEXT NOT NULL, PRIMARY KEY (genre, key));
CREATE TABLE IF NOT EXISTS lookups (kind TEXT NOT NULL, query TEXT NOT NULL, found INTEGER NOT NULL, tries INTEGER NOT NULL, next_try INTEGER NOT NULL, PRIMARY KEY (kind, query));
CREATE TABLE IF NOT EXISTS shelf (
  username TEXT NOT NULL, key TEXT NOT NULL, state TEXT NOT NULL, fraction REAL NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (username, key)
);
CREATE INDEX IF NOT EXISTS shelf_recent ON shelf (username, updated_at DESC);
CREATE TABLE IF NOT EXISTS devices (
  username TEXT NOT NULL, device TEXT NOT NULL, model TEXT NOT NULL,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY (username, device)
);
`);
  /* Your own verdict, the same three as Watch: not for me, liked it, loved it. */
  const cols = (db.prepare("PRAGMA table_info(shelf)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("rating")) db.exec("ALTER TABLE shelf ADD COLUMN rating TEXT");
  /* And in your own words: a review, which your friends see beside your verdict. */
  if (!cols.includes("review")) db.exec("ALTER TABLE shelf ADD COLUMN review TEXT; ALTER TABLE shelf ADD COLUMN reviewed_at INTEGER;");
  db.exec("UPDATE OR IGNORE shelf SET username = lower(username) WHERE username != lower(username); UPDATE OR IGNORE devices SET username = lower(username) WHERE username != lower(username);");
}

let migrated = false;
export function booksDb(): DatabaseSync {
  if (!g.kimonoBooks) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    g.kimonoBooks = new DatabaseSync(join(root, "books.db"));
  }
  if (!migrated) { migrate(g.kimonoBooks); migrated = true; }
  return g.kimonoBooks;
}

/* ── Keeping records ───────────────────────────────────────────────────── */

const readBook = (data: string): Book => ({ ...emptyBook("", ""), ...JSON.parse(data) as Book });

export function getBook(key: string): Book | null {
  const row = booksDb().prepare("SELECT data FROM records WHERE key = ?").get(key) as { data: string } | undefined;
  return row ? readBook(row.data) : null;
}

function checkedAt(key: string): number {
  const row = booksDb().prepare("SELECT checked_at FROM records WHERE key = ?").get(key) as { checked_at: number } | undefined;
  return row?.checked_at ?? 0;
}

/** Keeps what a source said, filling in what was already known about the book. */
export function save(books: Book[]) {
  const db = booksDb();
  const now = Date.now();
  const put = db.prepare("INSERT INTO records (key, data, identity, readers, checked_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET data = excluded.data, identity = excluded.identity, readers = excluded.readers, checked_at = excluded.checked_at");
  const dropFts = db.prepare("DELETE FROM records_fts WHERE key = ?");
  const putFts = db.prepare("INSERT INTO records_fts (key, title, authors, genres) VALUES (?, ?, ?, ?)");
  const putIsbn = db.prepare("INSERT OR IGNORE INTO isbns (isbn, key) VALUES (?, ?)");
  const dropGenres = db.prepare("DELETE FROM genres WHERE key = ?");
  const putGenre = db.prepare("INSERT OR IGNORE INTO genres (key, genre) VALUES (?, ?)");
  db.exec("BEGIN");
  try {
    for (const fresh of books) {
      const known = getBook(fresh.key);
      const book = known ? { ...merge(fresh, known), description: fresh.description || known.description } : fresh;
      put.run(book.key, JSON.stringify(book), identity(book), book.readers, now);
      dropFts.run(book.key);
      putFts.run(book.key, `${book.title} ${book.subtitle}`, book.authors.join(" "), book.genres.join(" "));
      for (const isbn of book.isbns) putIsbn.run(isbn, book.key);
      dropGenres.run(book.key);
      for (const genre of book.genres) putGenre.run(book.key, genre.toLowerCase());
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/* ── Sources ───────────────────────────────────────────────────────────── */

export function sourcesFor(config: BooksConfig): LiveSource[] {
  const out: LiveSource[] = [openLibrary];
  if (config.googleKey) out.push(googleBooks(config.googleKey));
  if (config.hardcoverToken) out.push(hardcover(config.hardcoverToken));
  if (config.annas) out.push(annas(config.annas.url, config.annas.key));
  return out;
}

/** Asks every source at once; what any of them finds is kept. */
async function ask(sources: LiveSource[], call: (s: LiveSource) => Promise<Book[]>): Promise<{ books: Book[]; failed: boolean }> {
  const results = await Promise.allSettled(sources.map((s) => call(s)));
  const books: Book[] = [];
  let failures = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") books.push(...r.value);
    else { failures++; console.warn(`books: ${sources[i].name}: ${r.reason instanceof Error ? r.reason.message : r.reason}`); }
  });
  if (books.length) save(books);
  return { books, failed: failures === sources.length };
}

function due(kind: string, query: string): boolean {
  const row = booksDb().prepare("SELECT next_try FROM lookups WHERE kind = ? AND query = ?").get(kind, query) as { next_try: number } | undefined;
  return !row || Date.now() >= row.next_try;
}

function note(kind: string, query: string, found: boolean) {
  const db = booksDb();
  const row = db.prepare("SELECT tries FROM lookups WHERE kind = ? AND query = ?").get(kind, query) as { tries: number } | undefined;
  const tries = found ? 0 : (row?.tries ?? 0) + 1;
  const wait = found ? (kind === "search" ? searchFresh : staleAfter) : retryAfter(tries);
  db.prepare("INSERT INTO lookups (kind, query, found, tries, next_try) VALUES (?, ?, ?, ?, ?) ON CONFLICT (kind, query) DO UPDATE SET found = excluded.found, tries = excluded.tries, next_try = excluded.next_try")
    .run(kind, query, found ? 1 : 0, tries, Date.now() + wait);
}

/* ── Lookups ───────────────────────────────────────────────────────────── */

function keysForIsbn(isbn: string): string[] {
  return (booksDb().prepare("SELECT key FROM isbns WHERE isbn = ?").all(isbn) as { key: string }[]).map((r) => r.key);
}

/** Every book with this ISBN, asking the sources when nothing kept is fresh. */
export async function byIsbn(config: BooksConfig, raw: string): Promise<Book[]> {
  const isbn = normalizeIsbn(raw);
  if (!isbn) throw new BooksProblem("That isn't an ISBN.", 400);
  const keys = keysForIsbn(isbn);
  const fresh = keys.some((k) => Date.now() - checkedAt(k) < staleAfter);
  if (!fresh && due("isbn", isbn)) {
    const { books, failed } = await ask(sourcesFor(config), (s) => s.byIsbn(isbn).then((found) => found.map((b) => ({ ...b, isbns: [...new Set([isbn, ...b.isbns])] }))));
    if (!failed) note("isbn", isbn, books.length + keys.length > 0);
  }
  return dedupe(keysForIsbn(isbn).map(getBook).filter((b): b is Book => Boolean(b)));
}

const ftsQuery = (q: string) => q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0).slice(0, 8).map((w) => `"${w}"*`).join(" ");

function searchKept(q: string, limit: number): Book[] {
  const match = ftsQuery(q);
  if (!match) return [];
  const rows = booksDb().prepare(`SELECT r.data FROM records_fts f JOIN records r ON r.key = f.key
WHERE records_fts MATCH ? ORDER BY (bm25(records_fts, 0, 10, 4, 1) - log(r.readers + 2)) LIMIT ?`).all(match, limit * 3) as { data: string }[];
  return rows.map((r) => readBook(r.data));
}

const words = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

/** Whether any of these books is the one asked for: every word typed is in its title, subtitle or authors. */
function matches(query: string, books: Book[]): boolean {
  const asked = words(query);
  if (!asked.length) return true;
  return books.some((b) => {
    const has = new Set(words(`${b.title} ${b.subtitle} ${b.authors.join(" ")}`));
    return asked.every((w) => has.has(w));
  });
}

/** Search: what's kept, plus the sources when that's thin or a week old. */
export async function search(config: BooksConfig, q: string, limit = 30): Promise<Book[]> {
  const query = q.trim().slice(0, 200);
  if (!query) return [];
  if (normalizeIsbn(query)) return byIsbn(config, query);
  const kept = dedupe(searchKept(query, limit));
  const key = query.toLowerCase();
  if (kept.length < limit / 2 || due("search", key)) {
    /* Anna's knows the books nothing else does. It's asked alongside the
       others every time; the answer waits for it only when they found
       nothing that matches what was typed (they always find something), and
       otherwise it lands in the kept records for the next search. */
    const sources = sourcesFor(config);
    const annasSource = sources.find((s) => s.name === "Anna's Archive");
    const fromAnnas = annasSource ? ask([annasSource], (s) => s.search(query, 8)) : null;
    let { books, failed } = await ask(sources.filter((s) => s !== annasSource), (s) => s.search(query, limit));
    if (fromAnnas && !matches(query, books)) {
      const more = await fromAnnas;
      books = [...books, ...more.books];
      failed = failed && more.failed;
    }
    if (!failed) note("search", key, books.length > 0);
  }
  return dedupe(searchKept(query, limit)).filter((b) => b.cover || b.isbns.length || b.authors.length || b.key.startsWith("aa:")).slice(0, limit);
}

/** A book's page: the record, filled in from its source when it's thin, and more like it. */
export async function bookPage(config: BooksConfig, key: string): Promise<{ book: Book; byAuthor: Book[]; similar: Book[] }> {
  if (!sourceOf(key)) throw new BooksProblem("No such book.", 404);
  let book = getBook(key);
  if (!book) {
    /* An address from elsewhere (a link, the e-reader): look it up by what the key says. */
    if (key.startsWith("ol:")) {
      const found = await openLibrary.query({ q: `key:/works/${key.slice(3)}`, limit: "1" }).catch(() => []);
      if (found.length) save(found);
    } else if (key.startsWith("aa:isbndb:")) {
      await byIsbn(config, key.slice("aa:isbndb:".length)).catch(() => []);
    }
    book = getBook(key);
    if (!book) throw new BooksProblem("No such book.", 404);
  }
  /* Thin: no description or genres yet. Open Library's work page has both. */
  if (key.startsWith("ol:") && (!book.description || !book.genres.length)) {
    const work = await openLibrary.work(key.slice(3)).catch(() => null);
    if (work) {
      book = { ...book, description: book.description || work.description, genres: book.genres.length ? book.genres : work.genres, cover: book.cover ?? work.cover };
      save([book]);
    }
  }
  /* Found on Anna's search page: the record has the cover, ISBNs and description. Once a month at most. */
  if (key.startsWith("aa:") && !book.description && !book.cover && config.annas && due("record", key)) {
    const full = await annas(config.annas.url, config.annas.key).record(key.slice(3)).catch(() => null);
    if (full) { book = merge(book, full); save([book]); }
    note("record", key, Boolean(full));
  }
  /* The same book from the other sources fills in what this one lacks. */
  const twins = (booksDb().prepare("SELECT data FROM records WHERE identity = ? AND key != ?").all(identity(book), key) as { data: string }[]).map((r) => readBook(r.data));
  for (const twin of twins) book = merge(book, twin);
  /* Only Open Library has spoken: ask the others, by title and author, for a
     proper summary and genres (Open Library's description is often a passage
     from the book). Once a month at most per book. */
  const heard = twins.some((t) => /^(hc|gb):/.test(t.key)) || /^(hc|gb):/.test(key);
  if (!heard && due("fill", key)) {
    const others = sourcesFor(config).filter((s) => s.name === "Hardcover" || s.name === "Google Books");
    const q = `${book.title} ${book.authors[0] ?? ""}`.trim();
    const { books, failed } = others.length ? await ask(others, (s) => s.search(q, 5)) : { books: [], failed: true };
    for (const b of books) if (identity(b) === identity(book)) book = merge(book, b);
    if (!failed) note("fill", key, books.some((b) => identity(b) === identity(book!)));
  }
  const large = book.cover?.replace("-M.jpg", "-L.jpg") ?? null;
  const author = book.authors[0];
  const byAuthor = author ? dedupe(searchKept(author, 20)).filter((b) => b.key !== key && identity(b) !== identity(book!) && b.authors.includes(author) && b.cover).slice(0, 12) : [];
  const genre = book.genres[0]?.toLowerCase();
  const similar = genre ? dedupe((booksDb().prepare(`SELECT r.data FROM genres x JOIN records r ON r.key = x.key WHERE x.genre = ? AND x.key != ? ORDER BY r.readers DESC LIMIT 40`).all(genre, key) as { data: string }[])
    .map((r) => readBook(r.data))).filter((b) => b.cover && !b.authors.some((a) => book!.authors.includes(a)) && identity(b) !== identity(book!)).slice(0, 16) : [];
  return { book: { ...book, cover: large }, byAuthor, similar };
}

/* ── Home ──────────────────────────────────────────────────────────────── */

const shelves: { id: string; title: string; subject: string }[] = [
  { id: "fantasy", title: "Fantasy", subject: "fantasy" },
  { id: "science-fiction", title: "Science fiction", subject: "science_fiction" },
  { id: "mystery", title: "Mystery & crime", subject: "mystery_and_detective_stories" },
  { id: "romance", title: "Romance", subject: "romance" },
  { id: "thriller", title: "Thrillers", subject: "thrillers" },
  { id: "classics", title: "Classics", subject: "classic_literature" },
  { id: "history", title: "History", subject: "history" },
  { id: "lives", title: "Lives", subject: "biography" },
  { id: "manga", title: "Manga", subject: "manga" },
  { id: "philosophy", title: "Philosophy", subject: "philosophy" },
  { id: "poetry", title: "Poetry", subject: "poetry" },
  { id: "young-adult", title: "Young adult", subject: "young_adult_fiction" },
];

const homeCache = globalThis as unknown as { kimonoBooksHome?: { rows: Row[]; at: number } };
const homeFresh = 6 * 60 * 60 * 1000;

/** Home's shelves: trending this week, then genres, most read first. A book sits on one genre shelf. */
export async function homeRows(): Promise<Row[]> {
  const cached = homeCache.kimonoBooksHome;
  if (cached && Date.now() - cached.at < homeFresh) return cached.rows;
  const [trending, ...byGenre] = await Promise.allSettled([openLibrary.trending(), ...shelves.map((s) => openLibrary.subject(s.subject, 30))]);
  const rows: Row[] = [];
  const all: Book[] = [];
  if (trending.status === "fulfilled") { all.push(...trending.value); rows.push({ id: "trending", title: "Trending this week", books: dedupe(trending.value).slice(0, 24) }); }
  const seen = new Set<string>();
  byGenre.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    all.push(...r.value);
    const books = dedupe(r.value).filter((b) => b.cover && !seen.has(identity(b)));
    for (const b of books) seen.add(identity(b));
    if (books.length >= 6) rows.push({ id: shelves[i].id, title: shelves[i].title, books: books.slice(0, 24) });
  });
  if (all.length) save(all);
  if (rows.length) homeCache.kimonoBooksHome = { rows, at: Date.now() };
  return rows.length ? rows : cached?.rows ?? [];
}

/* ── Shelves ───────────────────────────────────────────────────────────── */

type ShelfRow = { key: string; state: ShelfState; fraction: number; updated_at: number; rating: Rating | null };

/* Usernames are matched without case, as the rest of Kimono does. */
const who = (username: string) => username.trim().toLowerCase();

export function listShelf(username: string): ShelfItem[] {
  username = who(username);
  const rows = booksDb().prepare("SELECT key, state, fraction, updated_at, rating FROM shelf WHERE username = ? ORDER BY updated_at DESC").all(username) as ShelfRow[];
  return rows.flatMap((r) => {
    const b = getBook(r.key);
    return b ? [{ key: r.key, title: b.title, authors: b.authors, cover: b.cover, year: b.year, isbn: b.isbns[0] ?? null, state: r.state, fraction: r.fraction, rating: r.rating ?? null, updatedAt: new Date(r.updated_at).toISOString() }] : [];
  });
}

export type Mine = { state: ShelfState; fraction: number; rating: Rating | null; review: string | null; reviewedAt: string | null };

export function shelfStateOf(username: string, key: string): Mine | null {
  username = who(username);
  const row = booksDb().prepare("SELECT state, fraction, rating, review, reviewed_at FROM shelf WHERE username = ? AND key = ?").get(username, key) as
    { state: ShelfState; fraction: number; rating: Rating | null; review: string | null; reviewed_at: number | null } | undefined;
  return row ? { state: row.state, fraction: row.fraction, rating: row.rating ?? null, review: row.review ?? null, reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null } : null;
}

export const REVIEW_MAX = 5000;

/** What you thought, in your own words (null takes it back). Reviewing a book you hadn't shelved puts it on Read. */
export function setReview(username: string, key: string, review: string | null) {
  username = who(username);
  if (!getBook(key)) throw new BooksProblem("No such book.", 404);
  const text = review?.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim() || null;
  if (text && text.length > REVIEW_MAX) throw new BooksProblem(`A review can be up to ${REVIEW_MAX} characters.`, 400);
  const now = Date.now();
  booksDb().prepare(`INSERT INTO shelf (username, key, state, fraction, added_at, updated_at, review, reviewed_at) VALUES (?, ?, 'read', 1, ?, ?, ?, ?)
ON CONFLICT (username, key) DO UPDATE SET review = excluded.review, reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at`).run(username, key, now, now, text, text ? now : null);
}

/** How much you liked it. Rating a book you hadn't shelved puts it on Read. */
export function setRating(username: string, key: string, rating: Rating | null) {
  username = who(username);
  if (!getBook(key)) throw new BooksProblem("No such book.", 404);
  const now = Date.now();
  booksDb().prepare(`INSERT INTO shelf (username, key, state, fraction, added_at, updated_at, rating) VALUES (?, ?, 'read', 1, ?, ?, ?)
ON CONFLICT (username, key) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`).run(username, key, now, now, rating);
}

export function setShelf(username: string, key: string, state: ShelfState | null) {
  username = who(username);
  const db = booksDb();
  if (!state) { db.prepare("DELETE FROM shelf WHERE username = ? AND key = ?").run(username, key); return; }
  if (!getBook(key)) throw new BooksProblem("No such book.", 404);
  const now = Date.now();
  const fraction = state === "read" ? 1 : state === "want" ? 0 : null;
  db.prepare(`INSERT INTO shelf (username, key, state, fraction, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (username, key) DO UPDATE SET state = excluded.state, fraction = coalesce(?, shelf.fraction), updated_at = excluded.updated_at`)
    .run(username, key, state, fraction ?? 0, now, now, fraction);
}

/** Reading progress, from the web, the phone or the e-reader: reading until the end, then read. */
export async function setProgress(config: BooksConfig, username: string, ref: { key?: string; isbn?: string }, fraction: number) {
  username = who(username);
  let key = ref.key && getBook(ref.key) ? ref.key : null;
  if (!key && ref.isbn) key = (await byIsbn(config, ref.isbn))[0]?.key ?? null;
  if (!key) throw new BooksProblem("No such book.", 404);
  const f = Math.min(Math.max(fraction, 0), 1);
  const state: ShelfState = f >= 0.98 ? "read" : "reading";
  const now = Date.now();
  booksDb().prepare(`INSERT INTO shelf (username, key, state, fraction, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (username, key) DO UPDATE SET state = excluded.state, fraction = excluded.fraction, updated_at = excluded.updated_at`)
    .run(username, key, state, f, now, now);
  return { key, state, fraction: f };
}

/* ── Friends ───────────────────────────────────────────────────────────── */

export type FriendOnBook = { username: string; name: string; picture: string | null; state: ShelfState; fraction: number; rating: Rating | null; review: string | null; reviewedAt: string | null; updatedAt: string };
export type FriendReading = FriendOnBook & { book: Book };

/** Your friends who keep Books on their profile: only they are shown. */
async function visibleFriends(viewer: string) {
  const [{ friendsOfUser, friendsDb, people, personIn }, { hiddenAppsOf }] = await Promise.all([import("../friends"), import("../friends/model")]);
  const everyone = await people();
  return friendsOfUser(who(viewer)).filter((u) => !hiddenAppsOf(friendsDb(), u).includes("books")).map((u) => personIn(everyone, u));
}

type FriendRow = { username: string; key: string; state: ShelfState; fraction: number; rating: Rating | null; review: string | null; reviewed_at: number | null; updated_at: number };
const friendView = (r: FriendRow) => ({ state: r.state, fraction: r.fraction, rating: r.rating ?? null, review: r.review ?? null, reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null, updatedAt: new Date(r.updated_at).toISOString() });

/** Which of your friends have this book (any edition of it) on their shelf, and what they made of it. */
export async function friendsOnBook(viewer: string, key: string): Promise<FriendOnBook[]> {
  const friends = await visibleFriends(viewer);
  const book = getBook(key);
  if (!friends.length || !book) return [];
  const keys = (booksDb().prepare("SELECT key FROM records WHERE identity = ?").all(identity(book)) as { key: string }[]).map((r) => r.key);
  const marks = `(${keys.map(() => "?").join(",")})`;
  const names = `(${friends.map(() => "?").join(",")})`;
  const rows = booksDb().prepare(`SELECT username, key, state, fraction, rating, review, reviewed_at, updated_at FROM shelf WHERE key IN ${marks} AND username IN ${names} ORDER BY updated_at DESC`)
    .all(...keys, ...friends.map((f) => f.username)) as FriendRow[];
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    if (seen.has(r.username)) return [];
    seen.add(r.username);
    const p = friends.find((f) => f.username === r.username)!;
    return [{ ...p, ...friendView(r) }];
  });
}

/** What your friends have been reading lately, newest first: one entry per book. */
export async function friendsReading(viewer: string, limit = 24): Promise<FriendReading[]> {
  const friends = await visibleFriends(viewer);
  if (!friends.length) return [];
  const names = `(${friends.map(() => "?").join(",")})`;
  const rows = booksDb().prepare(`SELECT username, key, state, fraction, rating, review, reviewed_at, updated_at FROM shelf WHERE username IN ${names} AND state != 'want' AND (rating IS NULL OR rating != 'down') ORDER BY updated_at DESC LIMIT 200`)
    .all(...friends.map((f) => f.username)) as FriendRow[];
  const out: FriendReading[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const book = getBook(r.key);
    if (!book || seen.has(identity(book))) continue;
    seen.add(identity(book));
    const p = friends.find((f) => f.username === r.username)!;
    out.push({ ...p, ...friendView(r), book });
    if (out.length >= limit) break;
  }
  return out;
}

/* ── Kimono Read devices ───────────────────────────────────────────────── */

export type ReadDevice = { device: string; model: string; firstSeen: string; lastSeen: string };

/**
 * A Kimono Read e-reader says so on every call: `X-Kimono-Device:
 * kimono-read/<model>; id=<device id>`. Whoever it's signed in as owns one,
 * which their profile shows with a badge.
 */
export function noteDevice(request: Request, username: string) {
  username = who(username);
  const header = request.headers.get("x-kimono-device") ?? "";
  const m = /^kimono-read\/([a-z0-9._-]{1,32})(?:;\s*id=([A-Za-z0-9._:-]{1,64}))?$/i.exec(header.trim());
  if (!m) return;
  const now = Date.now();
  booksDb().prepare(`INSERT INTO devices (username, device, model, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
ON CONFLICT (username, device) DO UPDATE SET model = excluded.model, last_seen = excluded.last_seen`)
    .run(username, m[2] ?? m[1], m[1].toLowerCase(), now, now);
}

export function readDevices(username: string): ReadDevice[] {
  username = who(username);
  const rows = booksDb().prepare("SELECT device, model, first_seen, last_seen FROM devices WHERE username = ? ORDER BY first_seen").all(username) as { device: string; model: string; first_seen: number; last_seen: number }[];
  return rows.map((r) => ({ device: r.device, model: r.model, firstSeen: new Date(r.first_seen).toISOString(), lastSeen: new Date(r.last_seen).toISOString() }));
}

/** For the profile's badge: since when this person has had a Kimono Read, or null. */
export function kimonoReadSince(username: string): string | null {
  return readDevices(username)[0]?.firstSeen ?? null;
}

/* ── Keeping it fresh ──────────────────────────────────────────────────── */

const healing = globalThis as unknown as { kimonoBooksHealed?: number };

/**
 * A little upkeep on the back of requests (at most hourly): month-old records
 * on someone's shelf are checked again, and misses whose wait is over are retried.
 */
export function heal(config: BooksConfig) {
  if (healing.kimonoBooksHealed && Date.now() - healing.kimonoBooksHealed < 60 * 60 * 1000) return;
  healing.kimonoBooksHealed = Date.now();
  const db = booksDb();
  const stale = db.prepare(`SELECT DISTINCT r.key, r.data FROM records r JOIN shelf s ON s.key = r.key WHERE r.checked_at < ? LIMIT 25`).all(Date.now() - staleAfter) as { key: string; data: string }[];
  const misses = db.prepare("SELECT query FROM lookups WHERE kind = 'isbn' AND found = 0 AND next_try < ? LIMIT 25").all(Date.now()) as { query: string }[];
  void (async () => {
    for (const { data } of stale) {
      const book = readBook(data);
      if (book.isbns[0]) { db.prepare("UPDATE records SET checked_at = 0 WHERE key = ?").run(book.key); await byIsbn(config, book.isbns[0]).catch(() => []); }
      db.prepare("UPDATE records SET checked_at = ? WHERE key = ? AND checked_at = 0").run(Date.now(), book.key);
      await new Promise((r) => setTimeout(r, 1000));
    }
    for (const { query } of misses) {
      await byIsbn(config, query).catch(() => []);
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
}

/* ── Requests ──────────────────────────────────────────────────────────── */

export async function booksSettings(): Promise<BooksConfig> {
  return booksConfig(await getPlatformSettings());
}

/** Runs a Books request, turning refusals into the JSON errors /api/v1 answers with. */
export async function books(work: (config: BooksConfig) => Promise<Response> | Response): Promise<Response> {
  try {
    const config = await booksSettings();
    if (!config.enabled) return apiError(404, "Books isn't switched on.");
    heal(config);
    return await work(config);
  } catch (error) {
    if (error instanceof BooksProblem) return apiError(error.status, error.message);
    console.error("books:", error);
    return apiError(502, "Books couldn't reach its sources. Try again in a moment.");
  }
}
