/**
 * 本 Books' files: where a book can be read or downloaded from, behind one
 * interface. A source says which files it has for a book (by its ISBNs,
 * title and authors) and opens one, whole or a byte range at a time, so the
 * reader can stream and seek and a download can resume.
 *
 * No source is registered here: the household adds its own with
 * registerFileSource (e.g. from instrumentation.ts), and the reader and the
 * download use whatever is registered. Pure, so scripts/test-books.mjs can
 * check it with a source of its own.
 */
import type { Book } from "./model";

export type FileFormat = "epub" | "pdf" | "mobi" | "azw3" | "cbz" | "txt" | "html";

/** One file a source can open. `id` is the source's own; Books addresses it as `${source}:${id}`. */
export type BookFile = {
  id: string;
  source: string;
  format: FileFormat;
  /** Bytes, when the source knows. */
  size: number | null;
  /** What tells this file apart from the book's others: an edition, a language, "Sample". */
  label: string | null;
  language: string | null;
  /** A preview or sample, not the whole book. */
  sample: boolean;
};

export type Range = { start: number; end?: number };

export type Opened = {
  body: ReadableStream<Uint8Array>;
  /** The whole file's size, when known: needed to answer ranges. */
  size: number | null;
  /** The part being sent, inclusive, when a range was asked and honoured. */
  range: { start: number; end: number } | null;
  filename: string;
};

export interface FileSource {
  /** Short and stable, used in file addresses: "drive", "gutenberg", … */
  name: string;
  /** Files this source has for the book; [] when it has none. */
  find(book: Pick<Book, "key" | "title" | "authors" | "isbns" | "language">): Promise<Omit<BookFile, "source">[]>;
  /** Opens one of the files `find` returned, optionally a byte range of it. */
  open(id: string, range?: Range): Promise<Opened>;
}

export class FileProblem extends Error {
  constructor(message: string, readonly status = 404) { super(message); }
}

const g = globalThis as unknown as { kimonoBookSources?: Map<string, FileSource> };
const registry = () => (g.kimonoBookSources ??= new Map());

export function registerFileSource(source: FileSource) {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(source.name)) throw new Error(`A file source's name is short, lowercase letters, digits and dashes: "${source.name}"`);
  registry().set(source.name, source);
}

export function unregisterFileSource(name: string) { registry().delete(name); }
export const fileSources = (): FileSource[] => [...registry().values()];

/* The order to offer formats in: what reads best in the browser and on a phone first. */
const formatRank: Record<FileFormat, number> = { epub: 0, pdf: 1, cbz: 2, html: 3, txt: 4, azw3: 5, mobi: 6 };
/** Formats the in-app reader opens; the rest download. */
export const readable = (f: Pick<BookFile, "format">) => f.format === "epub" || f.format === "pdf";

/**
 * Every file the registered sources have for a book, best first: whole books
 * before samples, then by format, then by source order. A source that fails
 * or takes longer than `timeoutMs` is left out, not fatal.
 */
export async function filesFor(book: Pick<Book, "key" | "title" | "authors" | "isbns" | "language">, timeoutMs = 8000): Promise<BookFile[]> {
  const sources = fileSources();
  const found = await Promise.all(sources.map(async (s, order) => {
    try {
      const files = await Promise.race([
        s.find(book),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), timeoutMs)),
      ]);
      return files.map((f) => ({ ...f, source: s.name, order }));
    } catch (error) {
      console.warn(`books files: ${s.name}: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }));
  return found.flat()
    .sort((a, b) => Number(a.sample) - Number(b.sample) || formatRank[a.format] - formatRank[b.format] || a.order - b.order)
    .map(({ order: _order, ...f }) => f); // eslint-disable-line @typescript-eslint/no-unused-vars
}

/** A file's address in Books: `${source}:${id}`. */
export const fileAddress = (f: Pick<BookFile, "source" | "id">) => `${f.source}:${f.id}`;

/** Opens a file by its address, whole or a byte range. */
export async function openFile(address: string, range?: Range): Promise<Opened> {
  const at = address.indexOf(":");
  const source = at > 0 ? registry().get(address.slice(0, at)) : undefined;
  if (!source) throw new FileProblem("No such file.");
  if (range && (range.start < 0 || (range.end !== undefined && range.end < range.start))) throw new FileProblem("That range isn't in the file.", 416);
  return source.open(address.slice(at + 1), range);
}

/** Reads an HTTP Range header ("bytes=100-", "bytes=100-199"); suffix and multiple ranges are read as whole-file. */
export function parseRange(header: string | null): Range | undefined {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header?.trim() ?? "");
  if (!m) return undefined;
  return { start: Number(m[1]), end: m[2] ? Number(m[2]) : undefined };
}

export const contentType: Record<FileFormat, string> = {
  epub: "application/epub+zip", pdf: "application/pdf", mobi: "application/x-mobipocket-ebook", azw3: "application/vnd.amazon.ebook",
  cbz: "application/vnd.comicbook+zip", txt: "text/plain; charset=utf-8", html: "text/html; charset=utf-8",
};

/** Helper for sources that hold a file in memory or read one whole: serves the asked range of it. */
export function sliceOf(bytes: Uint8Array, filename: string, range?: Range): Opened {
  const size = bytes.byteLength;
  if (range && range.start >= size) throw new FileProblem("That range isn't in the file.", 416);
  const start = range?.start ?? 0;
  const end = Math.min(range?.end ?? size - 1, size - 1);
  const part = bytes.subarray(start, end + 1);
  return {
    body: new ReadableStream({ start(c) { c.enqueue(part); c.close(); } }),
    size, range: range ? { start, end } : null, filename,
  };
}
