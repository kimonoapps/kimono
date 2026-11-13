import "server-only";

import { BooksProblem, cleanAll, cleanDescription, clean, emptyBook, genresOf, isbnsOf, yearOf, type Book } from "./model";

/*
 * The live sources Books asks when it has nothing (or nothing fresh) for a
 * book: Open Library always, Google Books and Hardcover when a key is set,
 * Anna's Archive's metadata (./annas.ts) with a member's key.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const userAgent = "KimonoBooks/1.0 (+https://github.com/kimonoapps/kimono)";

export async function getJson(url: string, init: RequestInit = {}, timeoutMs = 9000): Promise<Json | null> {
  const res = await fetch(url, { ...init, headers: { "user-agent": userAgent, accept: "application/json", ...init.headers }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new BooksProblem(`${new URL(url).host}: ${res.status}`);
  return await res.json() as Json;
}

export interface LiveSource {
  name: string;
  byIsbn(isbn: string): Promise<Book[]>;
  search(q: string, limit: number): Promise<Book[]>;
}

/* ── Open Library ──────────────────────────────────────────────────────── */

const olFields = "key,title,subtitle,author_name,first_publish_year,isbn,publisher,language,cover_i,subject,number_of_pages_median,ratings_average,ratings_count,readinglog_count";
export const olCover = (id: number | undefined, size: "M" | "L" = "M") => id && id > 0 ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : null;

export function fromOpenLibraryDoc(d: Json): Book | null {
  const id = String(d.key ?? "").replace("/works/", "");
  const title = clean(d.title);
  if (!id || !title) return null;
  return {
    ...emptyBook(`ol:${id}`, title),
    subtitle: clean(d.subtitle),
    authors: cleanAll(d.author_name, 6),
    year: typeof d.first_publish_year === "number" ? d.first_publish_year : null,
    publisher: cleanAll(d.publisher, 1)[0] ?? "",
    language: cleanAll(d.language, 1)[0] ?? "",
    pages: typeof d.number_of_pages_median === "number" ? d.number_of_pages_median : null,
    isbns: isbnsOf((d.isbn ?? []).slice(0, 60)),
    genres: genresOf(cleanAll(d.subject, 60)),
    cover: olCover(d.cover_i),
    rating: typeof d.ratings_average === "number" ? Math.round(d.ratings_average * 100) / 100 : null,
    ratings: d.ratings_count ?? 0,
    readers: d.readinglog_count ?? 0,
  };
}

async function olQuery(params: Record<string, string>): Promise<Book[]> {
  const q = new URLSearchParams({ ...params, fields: olFields });
  const res = await getJson(`https://openlibrary.org/search.json?${q}`);
  return ((res?.docs ?? []) as Json[]).map(fromOpenLibraryDoc).filter((b): b is Book => Boolean(b));
}

export const openLibrary = {
  name: "Open Library",
  query: olQuery,
  byIsbn(isbn: string) { return olQuery({ isbn, limit: "3" }); },
  search(q: string, limit: number) { return olQuery({ q, limit: String(limit) }); },
  /** What people opened most this week. */
  async trending(): Promise<Book[]> {
    const res = await getJson("https://openlibrary.org/trending/weekly.json?limit=40");
    return ((res?.works ?? []) as Json[]).map(fromOpenLibraryDoc).filter((b): b is Book => Boolean(b?.cover));
  },
  /** A shelf: books on a subject, most read first. */
  subject(subject: string, limit = 30) { return olQuery({ q: `subject:${subject}`, sort: "readinglog", limit: String(limit) }); },
  /** A work's own page: its description and subjects, which search leaves out. */
  async work(id: string): Promise<{ description: string; genres: string[]; cover: string | null } | null> {
    const w = await getJson(`https://openlibrary.org/works/${encodeURIComponent(id)}.json`);
    if (!w) return null;
    const description = cleanDescription(typeof w.description === "string" ? w.description : w.description?.value);
    return { description, genres: genresOf(cleanAll(w.subjects, 60)), cover: olCover((w.covers ?? []).find((c: number) => c > 0), "L") };
  },
};
openLibrary satisfies LiveSource;

/* ── Google Books ──────────────────────────────────────────────────────── */

export function fromGoogleVolume(item: Json): Book | null {
  const v = item.volumeInfo ?? {};
  const title = clean(v.title);
  if (!item.id || !title) return null;
  const thumb: string | undefined = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail;
  return {
    ...emptyBook(`gb:${item.id}`, title),
    subtitle: clean(v.subtitle),
    authors: cleanAll(v.authors, 6),
    year: yearOf(v.publishedDate),
    publisher: clean(v.publisher),
    language: clean(v.language),
    pages: v.pageCount > 0 ? v.pageCount : null,
    isbns: isbnsOf((v.industryIdentifiers ?? []).map((i: Json) => i.identifier)),
    genres: genresOf(cleanAll((v.categories ?? []).flatMap((c: string) => c.split(/\s*\/\s*/)))),
    description: cleanDescription(v.description),
    /* Google's thumbnails are tiny at zoom=1; zoom=0 is the largest it serves for most books. */
    cover: thumb ? thumb.replace("http://", "https://").replace("&edge=curl", "").replace("zoom=1", "zoom=0") : null,
    rating: typeof v.averageRating === "number" ? v.averageRating : null,
    ratings: v.ratingsCount ?? 0,
  };
}

export function googleBooks(key: string): LiveSource {
  const query = async (q: string, limit: number) => {
    const params = new URLSearchParams({ q, maxResults: String(Math.min(limit, 40)), printType: "books", key });
    const res = await getJson(`https://www.googleapis.com/books/v1/volumes?${params}`);
    return (res?.items ?? []).map(fromGoogleVolume).filter(Boolean) as Book[];
  };
  return { name: "Google Books", byIsbn: (isbn) => query(`isbn:${isbn}`, 3), search: query };
}

/* ── Hardcover ─────────────────────────────────────────────────────────── */

export function fromHardcoverDocument(d: Json): Book | null {
  const title = clean(d.title);
  if (d.id === undefined || !title) return null;
  return {
    ...emptyBook(`hc:${d.id}`, title),
    subtitle: clean(d.subtitle),
    authors: cleanAll(d.author_names ?? (d.cached_contributors ?? []).map((c: Json) => c.author?.name), 6),
    year: typeof d.release_year === "number" ? d.release_year : null,
    pages: d.pages > 0 ? d.pages : null,
    isbns: isbnsOf((d.isbns ?? []).slice(0, 60)),
    genres: genresOf(cleanAll(d.genres ?? (d.cached_tags?.Genre ?? []).map((t: Json) => t.tag))),
    description: cleanDescription(d.description),
    cover: d.image?.url ?? null,
    rating: typeof d.rating === "number" && d.rating > 0 ? Math.round(d.rating * 100) / 100 : null,
    ratings: d.ratings_count ?? 0,
    readers: d.users_count ?? 0,
  };
}

export function hardcover(token: string): LiveSource {
  const graphql = async (query: string, variables: Json) => {
    const res = await getJson("https://api.hardcover.app/v1/graphql", {
      method: "POST",
      headers: { authorization: /^bearer /i.test(token) ? token : `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res?.errors?.length) throw new BooksProblem(`Hardcover: ${res.errors[0].message}`);
    return res?.data ?? {};
  };
  const fields = "id title subtitle description release_year pages rating ratings_count users_count image { url } cached_contributors cached_tags";
  return {
    name: "Hardcover",
    async byIsbn(isbn) {
      const data = await graphql(`query($isbn: String!) { editions(where: {isbn_13: {_eq: $isbn}}, limit: 1) { book { ${fields} } } }`, { isbn });
      return (data.editions ?? []).map((e: Json) => fromHardcoverDocument(e.book)).filter(Boolean).map((b: Book) => ({ ...b, isbns: [...new Set([isbn, ...b.isbns])] }));
    },
    async search(q, limit) {
      const data = await graphql(`query($q: String!, $n: Int!) { search(query: $q, query_type: "Book", per_page: $n, page: 1) { results } }`, { q, n: limit });
      return (data.search?.results?.hits ?? []).map((h: Json) => fromHardcoverDocument(h.document)).filter(Boolean) as Book[];
    },
  };
}
