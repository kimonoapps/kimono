import "server-only";

import { authorNames } from "./annas";
import { annasClient } from "./annas-client";
import type { BooksConfig } from "./config";
import { clean, identity, type Book } from "./model";
import { FileProblem, type BookFile, type FileFormat, type FileSource, type Opened, type Range } from "./files";
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

function fromRecord(md5: string, record: Json, book: BookRef, settings: Settings): Omit<BookFile, "source"> | null {
  const unified = record.file_unified_data;
  if (!unified || typeof unified !== "object") return null;
  const format = clean(unified.extension_best ?? unified.extension).toLowerCase() as FileFormat;
  if (!formats.has(format)) return null;
  const title = clean(unified.title_best);
  const authors = authorNames(clean(unified.author_best));
  if (!title || identity({ title, authors: [] }) !== identity({ title: book.title, authors: [] })) return null;
  if (book.authors.length && authors.length && identity({ title, authors }) !== identity(book)) return null;
  return {
    id: fileId(md5, settings, format), format,
    size: byteSize(unified.filesize_best ?? unified.filesize),
    label: clean(unified.edition_best) || null,
    language: clean((unified.language_codes ?? [])[0]) || book.language || null,
    sample: false,
  };
}

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
      const query = book.isbns[0] ?? `${book.title} ${book.authors[0] ?? ""}`.trim();
      if (!query) return [];
      const client = annasClient(settings.url, settings.key);
      const html = await client.get(`/search?q=${encodeURIComponent(query)}`, false);
      if (!html) return [];
      const records = await Promise.all(md5IdsIn(html).map(async (md5) => {
        const record = await client.get(`/db/aarecord_elasticsearch/md5:${md5}.json`, true).catch(() => null);
        return record ? fromRecord(md5, record, book, settings) : null;
      }));
      return records.filter((file): file is Omit<BookFile, "source"> => Boolean(file));
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
