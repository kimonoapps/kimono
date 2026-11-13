import "server-only";

import { authorNames } from "./annas";
import { annasClient } from "./annas-client";
import type { BooksConfig } from "./config";
import { clean, otherVolume, volumeMarks, type Book } from "./model";
import { FileProblem, type FileFormat, type FileSource, type Opened, type Range } from "./files";
import { userAgent } from "./sources";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Settings = NonNullable<BooksConfig["annas"]>;
type BookRef = Pick<Book, "key" | "title" | "authors" | "isbns" | "language">;
type FileId = { md5: string; pathIndex: number; domainIndex: number; format: FileFormat };

const formats = new Set<FileFormat>(["epub", "pdf", "mobi", "azw3", "cbz", "txt", "html"]);

/** File records on an ordinary search page, rather than the metadata-only index. */
export function md5IdsIn(html: string, max = 6): string[] {
  const ids: string[] = [];
  const pattern = /href=["'](?:https:\/\/[^/"']+)?\/md5\/([a-f0-9]{32})(?=["'?#/])/gi;
  for (const match of html.matchAll(pattern)) {
    const md5 = match[1].toLowerCase();
    if (!ids.includes(md5)) ids.push(md5);
    if (ids.length >= max) break;
  }
  return ids;
}

const fileId = (md5: string, settings: Settings, format: FileFormat) => `${md5}.${settings.pathIndex}.${settings.domainIndex}.${format}`;

function readFileId(id: string): FileId {
  const match = /^([a-f0-9]{32})\.(\d+)\.(\d+)\.(epub|pdf|mobi|azw3|cbz|txt|html)$/i.exec(id);
  const pathIndex = Number(match?.[2]);
  const domainIndex = Number(match?.[3]);
  if (!match || !Number.isSafeInteger(pathIndex) || !Number.isSafeInteger(domainIndex)) throw new FileProblem("No such file.");
  return { md5: match[1].toLowerCase(), pathIndex, domainIndex, format: match[4].toLowerCase() as FileFormat };
}

const byteSize = (value: unknown) => {
  const size = Number(value);
  return Number.isSafeInteger(size) && size > 0 ? size : null;
};

type ListedFile = { md5: string; title: string; authors: string[]; format: FileFormat; size: number | null; language: string; year: number | null };

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
const text = (html: string) => clean(html.replace(/<[^>]+>/g, "").replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : entities[e.toLowerCase()] ?? m));

/** The files on an ordinary search page, as the page lists them: title, author, language, format and size are all there. */
export function fileResultsIn(html: string, max = 50): ListedFile[] {
  const out: ListedFile[] = [];
  for (const block of html.split(/<div class="flex\s+pt-3\s+pb-3\s+border-b\b/).slice(1)) {
    const md5 = /href="\/md5\/([a-f0-9]{32})"/.exec(block)?.[1];
    if (!md5 || out.some((f) => f.md5 === md5)) continue;
    const title = text(/<a href="\/md5\/[^"]+"[^>]*\btext-lg\b[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? "");
    const by = /mdi--user-edit[^>]*><\/span>([\s\S]*?)<\/a>/.exec(block)?.[1];
    const line = text(/<div class="[^"]*\bfont-semibold\s+text-sm\b[^"]*">([\s\S]*?)<\/div>/.exec(block)?.[1] ?? "");
    const parts = line.split("·").map((p) => p.trim());
    const format = parts.map((p) => p.toLowerCase()).find((p) => formats.has(p as FileFormat)) as FileFormat | undefined;
    if (!title || !format) continue;
    const sized = parts.map((p) => /^([\d.]+)\s*(KB|MB|GB)$/i.exec(p)).find(Boolean);
    const size = sized ? Math.round(Number(sized[1]) * ({ kb: 1024, mb: 1_048_576, gb: 1_073_741_824 } as Record<string, number>)[sized[2].toLowerCase()]) : null;
    out.push({
      md5, title, authors: by ? authorNames(text(by)) : [], format, size: size && Number.isFinite(size) ? size : null,
      language: /\[([a-z]{2,3})(?:-[A-Za-z]+)?\]/.exec(parts[0] ?? "")?.[1] ?? "",
      year: Number(parts.find((p) => /^(1[4-9]\d\d|20\d\d)$/.test(p))) || null,
    });
    if (out.length >= max) break;
  }
  return out;
}

const little = new Set(["the", "a", "an", "of", "and", "o", "os", "a", "as", "el", "la", "los", "las", "le", "les", "l", "de", "des", "du", "der", "die", "das", "il", "lo", "un", "une", "y", "e", "et"]);
const words = (s: string) => new Set(s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !little.has(w)));
const surname = (a: string) => [...words(a)].pop() ?? "";

/**
 * How well a listed file fits the book (0: not this book). The author's
 * surname has to agree when both are known; then the title has to share its
 * words, unless the file came up for the book's own ISBN (an edition may be
 * titled in another language).
 */
function matchOf(file: ListedFile, book: BookRef, byIsbn: boolean): number {
  /* Any of the book's authors anywhere in the file's (which may list six in one line). */
  const theirs = book.authors.map(surname).filter(Boolean);
  const named = words(file.authors.join(" "));
  const authorAgrees = !theirs.length || !file.authors.length || theirs.some((s) => named.has(s));
  if (!authorAgrees) return 0;
  /* A workbook's other volumes share its title: "1re secondaire" isn't the "3e secondaire" asked for. */
  const volume = volumeMarks(`${book.title} ${(book as { subtitle?: string }).subtitle ?? ""}`);
  const theirVolume = volumeMarks(file.title);
  if (otherVolume(volume, theirVolume)) return 0;
  const sameVolume = [...volume].some(([w, n]) => theirVolume.get(w) === n) ? 0.5 : 0;
  /* Titles without their subtitles ("…: A Fable", "(Book 1)"), compared both ways, so another book that names this one doesn't pass. */
  const want = words(book.title.split(/[:(\[]/)[0]);
  const have = words(file.title.split(/[:(\[]/)[0]);
  const shared = [...want].filter((w) => have.has(w)).length;
  const covers = want.size ? shared / want.size : 0;
  const keeps = have.size ? shared / have.size : 0;
  if (!byIsbn && (covers < 0.5 || keeps < 0.5)) return 0;
  return (byIsbn ? 1 : 0) + covers + keeps / 2 + sameVolume + (file.format === "epub" ? 0.1 : 0);
}

const languageNames = (() => { try { return new Intl.DisplayNames(["en"], { type: "language" }); } catch { return null; } })();
const languageName = (code: string) => { try { return languageNames?.of(code) ?? code; } catch { return code; } };

async function resolve(settings: Settings, file: FileId): Promise<URL> {
  const origin = new URL(settings.url).origin;
  const query = new URLSearchParams({ md5: file.md5, key: settings.key, path_index: String(file.pathIndex), domain_index: String(file.domainIndex) });
  const res = await fetch(`${origin}/dyn/api/fast_download.json?${query}`, {
    headers: { "user-agent": userAgent, accept: "application/json" },
    signal: AbortSignal.timeout(12000), cache: "no-store",
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null) as Json | null;
  const error = clean(body?.error).slice(0, 200);
  if (!res.ok || res.status === 204 || error || typeof body?.download_url !== "string") {
    const status = res.status >= 400 && res.status < 500 ? res.status : 502;
    throw new FileProblem(`Anna's Archive: ${error || `no fast download was returned (${res.status}).`}`, status);
  }
  try {
    const url = new URL(body.download_url);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url;
  } catch {
    throw new FileProblem("Anna's Archive returned an invalid download address.", 502);
  }
}

function contentRange(header: string | null): { range: { start: number; end: number }; size: number | null } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(header ?? "");
  if (!match) return null;
  const start = Number(match[1]), end = Number(match[2]);
  const size = match[3] === "*" ? null : Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || (size !== null && (!Number.isSafeInteger(size) || end >= size))) return null;
  return { range: { start, end }, size };
}

function filename(response: Response, url: URL, format: FileFormat): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const quoted = /filename="([^"]+)"/i.exec(disposition)?.[1] ?? /filename=([^;\s]+)/i.exec(disposition)?.[1];
  let name = "";
  try { name = decodeURIComponent(encoded || quoted || url.pathname.split("/").pop() || ""); } catch { name = quoted || "Book"; }
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 120);
  if (!name) name = "Book";
  return `${name.replace(/\.[a-z0-9]{1,8}$/i, "")}.${format}`;
}

/** Anna's member fast downloads, resolved only when someone opens a file. */
export function annasFiles(getSettings: () => Promise<Settings | null>): FileSource {
  return {
    name: "annas",
    async find(book) {
      const settings = await getSettings();
      if (!settings) return [];
      const client = annasClient(settings.url, settings.key);
      /* Searches at once, each one request: by title and author, and by up
         to four of the book's ISBNs (its editions, in whatever language
         they're titled: an "O Alquimista" record names "The Alchemist"'s
         ISBNs too). Files are read off the result pages. */
      const named = `${book.title} ${book.authors[0] ?? ""}`.trim();
      /* A volume of a series is looked for by its volume too ("Sommets 3e secondaire"). */
      const subtitle = (book as { subtitle?: string }).subtitle ?? "";
      const volume = [...volumeMarks(subtitle)].map(([w, n]) => `${n} ${w}`).join(" ");
      const queries = [named, volume ? `${book.title} ${volume}` : "", ...book.isbns.slice(0, 4)].filter((q): q is string => Boolean(q));
      const pages = await Promise.all(queries.map((q) =>
        client.get(`/search?q=${encodeURIComponent(q)}&ext=epub&ext=pdf`, false).catch(() => null)));
      const seen = new Set<string>();
      const found: (ListedFile & { score: number })[] = [];
      pages.forEach((html, i) => {
        for (const file of fileResultsIn(html ?? "")) {
          if (seen.has(file.md5) || (file.format !== "epub" && file.format !== "pdf")) continue;
          const score = matchOf(file, book, /^\d{10,13}$/.test(queries[i]));
          if (score <= 0) continue;
          seen.add(file.md5);
          found.push({ ...file, score });
        }
      });
      return found.sort((a, b) => b.score - a.score).slice(0, 8).map((f) => ({
        id: fileId(f.md5, settings, f.format), format: f.format, size: f.size,
        label: [f.title !== book.title ? f.title : "", f.language ? languageName(f.language) : "", f.year ? String(f.year) : ""].filter(Boolean).join(" · ") || null,
        language: f.language || book.language || null, sample: false,
      }));
    },
    async open(id, range?: Range): Promise<Opened> {
      const file = readFileId(id);
      const settings = await getSettings();
      if (!settings) throw new FileProblem("Anna's Archive isn't configured.");
      const url = await resolve(settings, file);
      const headers = new Headers({ "user-agent": userAgent, accept: "application/octet-stream" });
      if (range) headers.set("range", `bytes=${range.start}-${range.end ?? ""}`);
      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok || !res.body) {
        const status = res.status === 404 || res.status === 410 || res.status === 416 ? res.status : 502;
        throw new FileProblem(`Anna's Archive download: ${res.status}`, status);
      }
      const part = res.status === 206 ? contentRange(res.headers.get("content-range")) : null;
      if (res.status === 206 && !part) throw new FileProblem("Anna's Archive returned an invalid byte range.", 502);
      const length = byteSize(res.headers.get("content-length"));
      return {
        body: res.body,
        size: part?.size ?? length,
        range: part?.range ?? null,
        filename: filename(res, res.url ? new URL(res.url) : url, file.format),
      };
    },
  };
}
