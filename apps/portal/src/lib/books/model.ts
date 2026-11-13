/**
 * 本 Kimono Books: one shape for a book, whichever source described it.
 * Pure (no requests, no database), so scripts/test-books.mjs can check it.
 */

/** Where a record came from: Open Library, Google Books, Hardcover, Anna's Archive. */
export type Source = "ol" | "gb" | "hc" | "aa";

export type Book = {
  /** `${source}:${id}`, e.g. "ol:OL45804W". The address of its page. */
  key: string;
  title: string;
  subtitle: string;
  authors: string[];
  year: number | null;
  publisher: string;
  language: string;
  pages: number | null;
  isbns: string[];
  genres: string[];
  description: string;
  cover: string | null;
  /** Readers' average out of 5, how many rated it, and how many have it on a shelf. */
  rating: number | null;
  ratings: number;
  readers: number;
};

export type ShelfState = "want" | "reading" | "read";
export type ShelfItem = Pick<Book, "key" | "title" | "authors" | "cover" | "year"> & { isbn: string | null; state: ShelfState; fraction: number; updatedAt: string };

export type Row = { id: string; title: string; books: Book[] };

export class BooksProblem extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export const sourceOf = (key: string): Source | null => {
  const s = key.split(":", 1)[0];
  return s === "ol" || s === "gb" || s === "hc" || s === "aa" ? s : null;
};

export function emptyBook(key: string, title: string): Book {
  return { key, title, subtitle: "", authors: [], year: null, publisher: "", language: "", pages: null, isbns: [], genres: [], description: "", cover: null, rating: null, ratings: 0, readers: 0 };
}

/* ── ISBNs ─────────────────────────────────────────────────────────────── */

function check10(nine: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(nine[i]) * (10 - i);
  const d = (11 - (sum % 11)) % 11;
  return d === 10 ? "X" : String(d);
}

function check13(twelve: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

/**
 * The ISBN-13 for a 10- or 13-digit ISBN, or null. "0-306-40615-2 (pbk.)"
 * reads as 9780306406157; lookups go through here too, so either form finds a book.
 */
export function normalizeIsbn(raw: string): string | null {
  const m = /^[^\dXx]*([\d][\d\s-]{8,16}[\dXx])/.exec(raw);
  if (!m) return null;
  const digits = m[1].replace(/[\s-]/g, "").toUpperCase();
  if (digits.length === 13 && /^\d{13}$/.test(digits)) return check13(digits.slice(0, 12)) === digits[12] ? digits : null;
  if (digits.length === 10 && /^\d{9}[\dX]$/.test(digits)) {
    if (check10(digits.slice(0, 9)) !== digits[9]) return null;
    const twelve = `978${digits.slice(0, 9)}`;
    return twelve + check13(twelve);
  }
  return null;
}

export function isbnsOf(values: unknown[]): string[] {
  const out = new Set<string>();
  for (const v of values) if (typeof v === "string") { const i = normalizeIsbn(v); if (i) out.add(i); }
  return [...out];
}

/* ── Cleaning ──────────────────────────────────────────────────────────── */

export const clean = (s: unknown): string => typeof s === "string" ? s.replace(/\u0000/g, "").replace(/\s+/g, " ").trim() : "";
export const cleanAll = (values: unknown, max = 40): string[] =>
  Array.isArray(values) ? [...new Set(values.map(clean).filter(Boolean))].slice(0, max) : [];
export const yearOf = (s: unknown): number | null => {
  const m = /\b(1[4-9]\d\d|20\d\d)\b/.exec(String(s ?? ""));
  return m ? Number(m[1]) : null;
};
/** Descriptions arrive with markdown links, HTML and "([source][1])" tails; keep the prose. */
export function cleanDescription(s: unknown): string {
  return clean(String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\[[^\]]*\]\[\d+\]/g, "")
    .replace(/^\s*\[\d+\]:.*$/gm, "").replace(/-{3,}[\s\S]*$/, "")
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")).slice(0, 6000);
}

/** Subjects good enough to show as genres: short, not a library code. */
export function genresOf(subjects: string[], max = 8): string[] {
  const out: string[] = [];
  for (const s of subjects) {
    const g = s.replace(/\s*\(.*?\)\s*/g, " ").split(/\s+--\s+|,\s*fiction$/i)[0].trim();
    if (!g || g.length > 32 || /\d{3}|^nyt:|^award:|^series:|=/i.test(g)) continue;
    const label = g[0].toUpperCase() + g.slice(1);
    if (!out.some((o) => o.toLowerCase() === label.toLowerCase())) out.push(label);
    if (out.length >= max) break;
  }
  return out;
}

/* ── One book from several sources ─────────────────────────────────────── */

const sameTitle = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/^(the|a|an) /, "").trim();
export const identity = (b: Pick<Book, "title" | "authors">) => `${sameTitle(b.title).slice(0, 60)}|${(b.authors[0] ?? "").toLowerCase().split(/\s+/).pop() ?? ""}`;

/** Fills what `into` lacks from `from`: same book, another source. */
export function merge(into: Book, from: Book): Book {
  return {
    ...into,
    subtitle: into.subtitle || from.subtitle,
    authors: into.authors.length ? into.authors : from.authors,
    year: into.year && from.year ? Math.min(into.year, from.year) : into.year ?? from.year,
    publisher: into.publisher || from.publisher,
    language: into.language || from.language,
    pages: into.pages ?? from.pages,
    isbns: [...new Set([...into.isbns, ...from.isbns])].slice(0, 60),
    genres: into.genres.length ? into.genres : from.genres,
    description: into.description.length >= from.description.length ? into.description : from.description,
    cover: into.cover ?? from.cover,
    rating: into.ratings >= from.ratings ? into.rating ?? from.rating : from.rating ?? into.rating,
    ratings: Math.max(into.ratings, from.ratings),
    readers: Math.max(into.readers, from.readers),
  };
}

/** One entry per book: duplicates from other sources fill in the first. */
export function dedupe(books: Book[]): Book[] {
  const seen = new Map<string, number>();
  const out: Book[] = [];
  for (const b of books) {
    const id = identity(b);
    const at = seen.get(id);
    if (at === undefined) { seen.set(id, out.length); out.push(b); } else out[at] = merge(out[at], b);
  }
  return out;
}
