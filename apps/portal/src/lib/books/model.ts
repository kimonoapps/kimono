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
/** How much you liked it: the same three as Watch. */
export type Rating = "down" | "up" | "love";
export type ShelfItem = Pick<Book, "key" | "title" | "authors" | "cover" | "year"> & { isbn: string | null; state: ShelfState; fraction: number; rating: Rating | null; updatedAt: string };

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
/**
 * A description as Markdown, whatever it came as: Google's HTML becomes
 * paragraphs, bold and italics; Open Library's Markdown keeps its own. Links
 * keep their words only, and the reference lists some sources trail off with
 * are cut. Paragraphs and list lines survive (they used to be flattened).
 */
export function cleanDescription(s: unknown): string {
  const text = String(s ?? "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*/gi, "\n\n").replace(/<p[^>]*>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ").replace(/<\/(li|ul|ol)>/gi, "\n")
    .replace(/<\/?(b|strong)>/gi, "**").replace(/<\/?(i|em)>/gi, "*").replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\[\d+\]/g, "$1").replace(/\[[^\]]*\]\[\d+\]/g, "")
    .replace(/^\s*\[\d+\]:.*$/gm, "").replace(/\n\s*-{3,}[\s\S]*$/, "")
    .replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return text.split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).join("\n")
    .replace(/\*\*\s*\*\*/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 6000);
}

/** A description as plain words, for a line of it (the hero, a preview). */
export const plainDescription = (md: string) => md.replace(/^#+\s*/gm, "").replace(/^\s*[-*+]\s+/gm, "").replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim();

/* Genres people browse by. Open Library's subjects are a long, unordered
   list (places, characters, awards…); these are the ones worth showing. */
const knownGenres = new Map<string, string>([
  ...["fantasy", "science fiction", "horror", "romance", "mystery", "thriller", "thrillers", "crime", "historical fiction", "literary fiction",
    "classics", "classic literature", "poetry", "drama", "humor", "humour", "adventure", "dystopian", "magical realism", "graphic novels", "comics",
    "manga", "young adult", "children's fiction", "juvenile fiction", "picture books", "short stories", "biography", "autobiography", "memoir",
    "history", "philosophy", "psychology", "self-help", "business", "economics", "politics", "religion", "spirituality", "science", "mathematics",
    "nature", "travel", "cooking", "art", "music", "essays", "true crime", "war", "western", "erotica", "contemporary", "gothic", "mythology",
    "fairy tales", "detective and mystery stories", "love stories", "ghost stories", "epic fantasy", "urban fantasy", "space opera", "cyberpunk",
    "personal finance", "health", "education", "sociology", "anthropology", "technology", "computers", "nonfiction", "non-fiction", "fiction"]
    .map((g) => [g, g] as [string, string]),
  ["detective and mystery stories", "mystery"], ["love stories", "romance"], ["juvenile fiction", "children's"], ["children's fiction", "children's"],
  ["classic literature", "classics"], ["thrillers", "thriller"], ["humour", "humor"], ["non-fiction", "nonfiction"], ["ghost stories", "horror"],
]);

const titleCase = (g: string) => g.replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\bAnd\b/g, "and");

/**
 * Genres to show: the recognised ones first (in the source's order), and only
 * when a source has no recognised ones, its short plain subjects. "Fiction"
 * goes last: it says little next to anything else.
 */
export function genresOf(subjects: string[], max = 6): string[] {
  const known: string[] = [];
  const plain: string[] = [];
  for (const s of subjects) {
    const g = s.replace(/\s*\(.*?\)\s*/g, " ").split(/\s+--\s+/)[0].replace(/,\s*fiction$/i, "").trim().toLowerCase();
    if (!g || /\d{3}|^nyt:|^award:|^series:|^place:|^person:|^time:|=/.test(g)) continue;
    const mapped = knownGenres.get(g) ?? knownGenres.get(g.replace(/ fiction$/, ""));
    if (mapped) { if (!known.includes(mapped)) known.push(mapped); }
    else if (g.length <= 24 && !plain.includes(g)) plain.push(g);
  }
  const ordered = known.length ? [...known.filter((g) => g !== "fiction"), ...known.filter((g) => g === "fiction")] : plain.slice(0, 3);
  return ordered.slice(0, max).map(titleCase);
}

/* ── One book from several sources ─────────────────────────────────────── */

const sameTitle = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/^(the|a|an) /, "").trim();
export const identity = (b: Pick<Book, "title" | "authors">) => `${sameTitle(b.title).slice(0, 60)}|${(b.authors[0] ?? "").toLowerCase().split(/\s+/).pop() ?? ""}`;

/* Whose word to take for what a book is about: readers' and publishers'
   summaries first; Open Library's are often a passage from the book itself. */
const voice: Record<string, number> = { hc: 0, gb: 1, aa: 2, ol: 3 };
const rank = (b: Book) => voice[b.key.split(":", 1)[0]] ?? 9;

/** Fills what `into` lacks from `from`: same book, another source. */
export function merge(into: Book, from: Book): Book {
  const fromSpeaks = rank(from) < rank(into);
  return {
    ...into,
    subtitle: into.subtitle || from.subtitle,
    authors: into.authors.length ? into.authors : from.authors,
    year: into.year && from.year ? Math.min(into.year, from.year) : into.year ?? from.year,
    publisher: into.publisher || from.publisher,
    language: into.language || from.language,
    pages: into.pages ?? from.pages,
    isbns: [...new Set([...into.isbns, ...from.isbns])].slice(0, 60),
    genres: (fromSpeaks && from.genres.length) || !into.genres.length ? from.genres : into.genres,
    description: (fromSpeaks && from.description.length > 80) || !into.description ? from.description || into.description : into.description,
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
