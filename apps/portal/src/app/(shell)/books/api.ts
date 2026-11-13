/*
 * 本 Kimono Books' API as the web app reads it (lib/books has the server
 * side). Every call goes with the browser's session.
 */

export type Book = {
  key: string; title: string; subtitle: string; authors: string[]; year: number | null;
  publisher: string; language: string; pages: number | null; isbns: string[]; genres: string[];
  description: string; cover: string | null; rating: number | null; ratings: number; readers: number;
};
export type ShelfState = "want" | "reading" | "read";
/** How much you liked it: the same three as Watch. */
export type Rating = "down" | "up" | "love";
export type ShelfItem = { key: string; title: string; authors: string[]; cover: string | null; year: number | null; isbn: string | null; state: ShelfState; fraction: number; rating: Rating | null; updatedAt: string };
export type Row = { id: string; title: string; books: Book[] };
export type FriendOnBook = { username: string; name: string; picture: string | null; state: ShelfState; fraction: number; rating: Rating | null; review: string | null; reviewedAt: string | null; updatedAt: string };
export type FriendReading = FriendOnBook & { book: Book };
export type Genre = { id: string; title: string };
export type Home = { shelf: ShelfItem[]; friends: FriendReading[]; rows: Row[]; featured: Book | null; genres: Genre[] };
export type GenrePage = { id: string; title: string; books: Book[]; more: boolean };
export type Mine = { state: ShelfState; fraction: number; rating: Rating | null; review?: string | null; reviewedAt?: string | null };
export type Page = { book: Book; byAuthor: Book[]; similar: Book[]; shelf: Mine | null; friends: FriendOnBook[] };

/** A file a source has for a book: read it in Kimono when `readable`, or download it. */
export type BookFileInfo = { address: string; source: string; format: string; size: number | null; label: string | null; language: string | null; sample: boolean; readable: boolean; preparing?: boolean };
export type ReadingFormat = "epub" | "pdf";

export class BooksError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/books${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new BooksError((body as { error?: string }).error ?? "Books couldn't answer.", res.status);
  return body as T;
}

export const booksApi = {
  home: () => call<Home>("/home"),
  genre: (id: string, page = 0) => call<GenrePage>(`/genre?id=${encodeURIComponent(id)}&page=${page}`),
  search: (q: string, signal?: AbortSignal) => call<{ books: Book[] }>(`/search?q=${encodeURIComponent(q)}`, { signal }),
  book: (key: string) => call<Page>(`/book?key=${encodeURIComponent(key)}`),
  shelf: () => call<{ books: ShelfItem[] }>("/shelf"),
  setShelf: (key: string, state: ShelfState | null) => call<{ books: ShelfItem[] }>("/shelf", { method: "PUT", body: JSON.stringify({ key, state }) }),
  files: (key: string) => call<{ files: BookFileInfo[]; prefers: ReadingFormat | null }>(`/files?key=${encodeURIComponent(key)}`),
  setFormat: (format: ReadingFormat | null) => call<{ format: ReadingFormat | null }>("/prefs", { method: "PUT", body: JSON.stringify({ format }) }),
  rate: (key: string, rating: Rating | null) => call<{ shelf: Mine | null }>("/rating", { method: "PUT", body: JSON.stringify({ key, rating }) }),
  review: (key: string, review: string | null) => call<{ shelf: Mine | null }>("/review", { method: "PUT", body: JSON.stringify({ key, review }) }),
  progress: (key: string, fraction: number) => call<{ key: string; state: ShelfState; fraction: number }>("/progress", { method: "POST", body: JSON.stringify({ key, fraction }) }),
};

/** A shelf item read as a book, for the components that draw books. */
export const asBook = (s: ShelfItem): Book => ({
  key: s.key, title: s.title, subtitle: "", authors: s.authors, year: s.year, publisher: "", language: "", pages: null,
  isbns: s.isbn ? [s.isbn] : [], genres: [], description: "", cover: s.cover, rating: null, ratings: 0, readers: 0,
});

export const stateLabel: Record<ShelfState, string> = { want: "Want to read", reading: "Reading", read: "Read" };
export const ratingLabel: Record<Rating, string> = { down: "Not for me", up: "Liked it", love: "Loved it" };

/** What a friend made of a book, in a few words: "Loved it", "Reading · 40%", "Wants to read". */
export function verdictOf(f: { state: ShelfState; fraction: number; rating: Rating | null }): string {
  if (f.rating) return ratingLabel[f.rating];
  if (f.state === "reading") return `Reading · ${Math.round(f.fraction * 100)}%`;
  return f.state === "want" ? "Wants to read" : "Read it";
}

/** "12.4k readers" */
export function count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}
