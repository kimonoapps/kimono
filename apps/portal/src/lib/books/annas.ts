import "server-only";

import { BooksProblem, clean, cleanAll, cleanDescription, emptyBook, isbnsOf, normalizeIsbn, yearOf, type Book } from "./model";
import { userAgent, type LiveSource } from "./sources";

/*
 * Anna's Archive, for books nothing else knows: its metadata-only records
 * (ISBNdb, WorldCat, Open Library, Goodreads, national libraries and more,
 * merged per book). Signed in with a member's secret key, so pages answer
 * without bot checks.
 *
 * Only metadata: the search is its "metadata" index, which lists records,
 * never files, and only bibliographic fields are read from a record. The
 * membership's download API is never called.
 *
 * Its address is whatever the household sets (it moves, and lookalike
 * domains abound); the key is never sent anywhere else.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/* Record kinds that describe a book rather than a file. */
const metadataKinds = ["isbndb", "oclc", "ol", "goodreads", "isbngrp", "libby", "rgb", "edsebk", "cerlalc", "czech_oo42hcks", "gbooks", "duxiu_ssid", "cadal_ssno"] as const;
const fileish = /^(md5|aacid|doi|nexusstc|zlib|lgli|lgrs|ia|scihub|trantor|magzdb)/;

type Session = { cookie: string; at: number };
const sessions = new Map<string, Session>();
const sessionLife = 6 * 60 * 60 * 1000;

/**
 * Picks the bibliographic fields out of any record Anna's Archive serves, a
 * few levels down: *_best fields first (its merged view), then the source's
 * own names. File names, hashes and links are never read.
 */
export function pickBibliographic(key: string, record: Json): Book | null {
  /* A record of a file, not a book: never kept. */
  if (record.additional?.is_metadata === false) return null;
  const unified = record.file_unified_data;
  if (unified && typeof unified === "object") return fromUnified(key, unified as Json);
  const found: { title?: string; subtitle?: string; authors?: string[]; publisher?: string; year?: number | null; language?: string; description?: string; pages?: number | null } = {};
  const isbnValues: unknown[] = [];
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 4) return;
    if (Array.isArray(node)) { for (const n of node.slice(0, 40)) walk(n, depth + 1); return; }
    for (const [k, v] of Object.entries(node as Json)) {
      const name = k.toLowerCase();
      if (/(^|_)(md5|sha1|sha256|url|urls|filepath|filename|download|ipfs|torrent|server_path)/.test(name)) continue;
      if (name.includes("isbn")) { isbnValues.push(...(Array.isArray(v) ? v : [v])); continue; }
      const first = () => Array.isArray(v) ? clean(v.find((x) => typeof x === "string" && clean(x))) : clean(v);
      if (/^(title_best|title|book_title|name)$/.test(name) && !found.title && typeof (Array.isArray(v) ? v[0] : v) === "string") { found.title = first(); continue; }
      if (/^(subtitle|subtitle_best)$/.test(name) && !found.subtitle) { found.subtitle = first(); continue; }
      if (/^(author_best|authors?|creators?|author_names?)$/.test(name) && !found.authors?.length) {
        const list = Array.isArray(v) ? v.map((x) => typeof x === "string" ? x : (x as Json)?.name) : String(v ?? "").split(/;\s*|\s+&\s+/);
        found.authors = cleanAll(list, 6); continue;
      }
      if (/^(publisher_best|publishers?)$/.test(name) && !found.publisher) { found.publisher = first(); continue; }
      if (/^(year_best|year|publish_year|publication_year|date_published|publish_date|publication_date|pubdate)$/.test(name) && !found.year) { found.year = yearOf(first() || v); continue; }
      if (/^(language_codes|languages?|most_likely_language_code)$/.test(name) && !found.language) { found.language = first(); continue; }
      if (/^(stripped_description_best|description|synopsis|overview)$/.test(name) && !found.description) { found.description = cleanDescription(first()); continue; }
      if (/^(pages|number_of_pages|page_count)$/.test(name) && !found.pages) { const n = Number(first() || v); found.pages = n > 0 && n < 100000 ? n : null; continue; }
      if (typeof v === "object") walk(v, depth + 1);
    }
  };
  walk(record, 0);
  const isbns = isbnsOf(isbnValues);
  const title = found.title || isbns[0];
  if (!title) return null;
  return { ...emptyBook(key, title), subtitle: found.subtitle ?? "", authors: found.authors ?? [], publisher: found.publisher ?? "", year: found.year ?? null, language: found.language ?? "", description: found.description ?? "", pages: found.pages ?? null, isbns };
}

/** "Dahl, Roald" as people write it: "Roald Dahl". Several authors split on ";" or "&". */
export function authorNames(raw: string): string[] {
  return cleanAll(raw.split(/\s*;\s*|\s+&\s+|\s+and\s+/).map((a) => {
    const m = /^([^,]+),\s*([^,]+)$/.exec(a.trim());
    return m ? `${m[2]} ${m[1]}` : a;
  }), 6);
}

/** Anna's merged view of a record: its *_best fields and unified identifiers. */
function fromUnified(key: string, u: Json): Book | null {
  const ids = u.identifiers_unified ?? {};
  const isbns = isbnsOf([...(ids.isbn13 ?? []), ...(ids.isbn10 ?? [])]);
  const title = clean(u.title_best) || clean((u.title_additional ?? [])[0]);
  if (!title) return null;
  const cover = clean(u.cover_url_best);
  return {
    ...emptyBook(key, title),
    authors: authorNames(clean(u.author_best) || clean((u.author_additional ?? [])[0])),
    publisher: clean(u.publisher_best),
    year: yearOf(u.year_best),
    language: clean((u.most_likely_language_codes ?? u.language_codes ?? [])[0]),
    description: cleanDescription(u.stripped_description_best),
    isbns,
    /* Only cover art: an image of the jacket from the catalog it came from. */
    cover: /^https:\/\//.test(cover) ? cover : null,
  };
}

/** Record ids on a metadata search page: hrefs like /isbndb/978…, /oclc/123, /ol/OL1M. */
export function recordIdsIn(html: string, max = 12): string[] {
  const ids: string[] = [];
  const pattern = new RegExp(`href="/(${metadataKinds.join("|")})/([^"?#/]+)"`, "g");
  for (const m of html.matchAll(pattern)) {
    const id = `${m[1]}:${decodeURIComponent(m[2])}`;
    if (!fileish.test(id) && !ids.includes(id)) ids.push(id);
    if (ids.length >= max) break;
  }
  return ids;
}

export function annas(base: string, secret: string): LiveSource {
  const origin = new URL(base).origin;

  async function session(): Promise<string> {
    const known = sessions.get(origin);
    if (known && Date.now() - known.at < sessionLife) return known.cookie;
    /* Signing in with the secret key: the form on its account page. */
    const res = await fetch(`${origin}/account/`, {
      method: "POST",
      headers: { "user-agent": userAgent, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key: secret }),
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    const cookies = res.headers.getSetCookie().map((c) => c.split(";", 1)[0]).filter(Boolean);
    if (!cookies.some((c) => c.startsWith("aa_account_id2="))) throw new BooksProblem(`Anna's Archive didn't sign in (${res.status}). Check its address and key.`);
    const cookie = cookies.join("; ");
    sessions.set(origin, { cookie, at: Date.now() });
    return cookie;
  }

  async function get(path: string, json: boolean): Promise<string | Json | null> {
    const res = await fetch(`${origin}${path}`, {
      headers: { "user-agent": userAgent, cookie: await session(), accept: json ? "application/json" : "text/html" },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) { sessions.delete(origin); throw new BooksProblem(`Anna's Archive refused (${res.status}).`); }
    if (!res.ok) throw new BooksProblem(`Anna's Archive: ${res.status}`);
    return json ? await res.json() as Json : await res.text();
  }

  /* A record as JSON. */
  async function record(id: string): Promise<Book | null> {
    for (const path of [`/db/aarecord_elasticsearch/${id}.json`]) {
      try {
        const json = await get(path, true) as Json | null;
        if (json) return pickBibliographic(`aa:${id}`, json);
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
    return null;
  }

  return {
    name: "Anna's Archive",
    async byIsbn(isbn) {
      const direct = await record(`isbndb:${isbn}`);
      if (direct) return [{ ...direct, isbns: [...new Set([isbn, ...direct.isbns])] }];
      return this.search(isbn, 3);
    },
    async search(q, limit) {
      const html = await get(`/search?index=meta&q=${encodeURIComponent(q)}`, false) as string | null;
      if (!html) return [];
      const ids = recordIdsIn(html, Math.min(limit, 8));
      const books = await Promise.all(ids.map((id) => record(id).catch(() => null)));
      const isbn = normalizeIsbn(q);
      return books.filter((b): b is Book => Boolean(b)).map((b) => isbn ? { ...b, isbns: [...new Set([isbn, ...b.isbns])] } : b);
    },
  };
}
