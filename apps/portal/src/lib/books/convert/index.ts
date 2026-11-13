import "server-only";

import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { stateDir } from "../../state";
import { openCached } from "../cache";
import { FilePreparing, FileProblem, registerFileSource, setFileDeriver, unregisterFileSource, type BookFile, type Opened, type Range } from "../files";
import type { Book } from "../model";
import { hasPoppler } from "./pdf";
import { convertPdf, type PipelineReport } from "./pipeline";
import type { Restructurer } from "./restructure";

/*
 * 本 Every PDF a book-file source offers is also offered as an EPUB: Kimono
 * Read only shows EPUB, and EPUB reflows on a phone. The EPUB is made the
 * first time someone opens it (poppler's text, structure.ts's rules, then
 * the LLM pass) and kept under <state>/books/converted, named by the PDF's
 * address. While it's being made the files API says `preparing` and opening
 * it answers 202 with how far along it is, instead of holding a request open.
 */

/** Bump when the conversion changes enough that books should be made again. */
const VERSION = "2";
const SOURCE = "converted";

type BookMeta = Pick<Book, "key" | "title" | "authors" | "isbns" | "language"> & Partial<Pick<Book, "publisher" | "year">>;

export type ConvertOptions = {
  /** The Books record for a key, for the EPUB's title, authors and ISBN. */
  bookFor?: (key: string) => BookMeta | null;
  /** Kimono AI's Claude token, or "" for the base conversion alone. */
  token?: () => Promise<string>;
  /** Tests stand in for Claude. */
  restructurer?: (token: string) => Restructurer;
  /** Where converted books are kept; <state>/books/converted by default. */
  dir?: string;
};

type Job = { stage: "waiting" | "fetching" | "reading" | "structuring" | "packing"; progress: number; done: Promise<void> };
type State = { options: ConvertOptions; jobs: Map<string, Job>; queue: Promise<unknown>; seen: Map<string, BookMeta> };
const g = globalThis as unknown as { kimonoBookConvert?: State };

const dir = () => g.kimonoBookConvert?.options.dir ?? join(stateDir, "books", "converted");
const hashOf = (pdf: string) => createHash("sha256").update(`${VERSION}\0${pdf}`).digest("hex").slice(0, 32);
const epubPath = (hash: string) => join(dir(), `${hash}.epub`);
const failedPath = (hash: string) => join(dir(), `${hash}.failed`);
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString();

/** A converted file's id: the book's key and the PDF's address, so opening it needs nothing remembered. */
export const convertedId = (bookKey: string, pdfAddress: string) => `${b64(bookKey)}.${b64(pdfAddress)}`;
function readId(id: string): { key: string; pdf: string } {
  const [k, p] = id.split(".");
  if (!k || !p) throw new FileProblem("No such file.");
  return { key: unb64(k), pdf: unb64(p) };
}

/** A conversion that failed (a scan with no text, a broken PDF) isn't offered again for a day. */
function failed(hash: string): boolean {
  try { return Date.now() - statSync(failedPath(hash)).mtimeMs < 24 * 60 * 60 * 1000; } catch { return false; }
}

export function registerConversions(options: ConvertOptions = {}) {
  g.kimonoBookConvert = { options, jobs: g.kimonoBookConvert?.jobs ?? new Map(), queue: Promise.resolve(), seen: g.kimonoBookConvert?.seen ?? new Map() };
  registerFileSource({ name: SOURCE, find: async () => [], open });
  setFileDeriver((book, found) => {
    if (found.some((f) => f.format === "epub")) return [];
    const pdf = found.find((f) => f.format === "pdf" && !f.sample) ?? found.find((f) => f.format === "pdf");
    if (!pdf) return [];
    const address = `${pdf.source}:${pdf.id}`;
    const hash = hashOf(address);
    if (failed(hash)) return [];
    g.kimonoBookConvert!.seen.set(book.key, book);
    const ready = existsSync(epubPath(hash));
    const file: BookFile = {
      id: convertedId(book.key, address), source: SOURCE, format: "epub",
      size: ready ? statSync(epubPath(hash)).size : null,
      label: "From PDF", language: pdf.language, sample: pdf.sample,
      preparing: g.kimonoBookConvert!.jobs.has(hash),
    };
    return [file];
  });
}

export function unregisterConversions() {
  unregisterFileSource(SOURCE);
  setFileDeriver(null);
}

/** How far a conversion has got, 0–1, or null when none is running. */
export function conversionProgress(pdfAddress: string): number | null {
  return g.kimonoBookConvert?.jobs.get(hashOf(pdfAddress))?.progress ?? null;
}

async function open(id: string, range?: Range): Promise<Opened> {
  const { key, pdf } = readId(id);
  const hash = hashOf(pdf);
  const path = epubPath(hash);
  if (existsSync(path)) return serve(path, range, key);
  if (failed(hash)) throw new FileProblem("This PDF couldn't be made into an EPUB.", 422);
  const job = start(key, pdf, hash);
  throw new FilePreparing(job.progress, job.stage);
}

function serve(path: string, range: Range | undefined, key: string): Opened {
  const size = statSync(path).size;
  if (range && range.start >= size) throw new FileProblem("That range isn't in the file.", 416);
  const start = range?.start ?? 0;
  const end = Math.min(range?.end ?? size - 1, size - 1);
  const title = (g.kimonoBookConvert?.options.bookFor?.(key) ?? g.kimonoBookConvert?.seen.get(key))?.title || "Book";
  return {
    body: Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>,
    size, range: range ? { start, end } : null,
    filename: `${title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 120) || "Book"}.epub`,
  };
}

/** Starts (or joins) the conversion of one PDF; one book is converted at a time. */
function start(key: string, pdf: string, hash: string): Job {
  const state = g.kimonoBookConvert!;
  const running = state.jobs.get(hash);
  if (running) return running;
  /* Waiting its turn (one book is made at a time), then fetching the PDF, then the making itself. */
  const job: Job = { stage: "waiting", progress: 0, done: Promise.resolve() };
  state.jobs.set(hash, job);
  job.done = (state.queue = state.queue.then(() => convert(key, pdf, hash, job))).then(() => {})
    .catch(async (error) => {
      console.error(`books convert: ${pdf}:`, error);
      await mkdir(dir(), { recursive: true }).catch(() => {});
      await writeFile(failedPath(hash), `${error instanceof Error ? error.message : error}\n`).catch(() => {});
    })
    .finally(() => state.jobs.delete(hash));
  return job;
}

/** Waits for a conversion: for tests, and for callers that would rather wait. */
export async function converted(bookKey: string, pdfAddress: string): Promise<void> {
  const hash = hashOf(pdfAddress);
  if (existsSync(epubPath(hash))) return;
  await start(bookKey, pdfAddress, hash).done;
}

export type ConversionReport = PipelineReport;

async function convert(key: string, pdf: string, hash: string, job: Job): Promise<void> {
  const state = g.kimonoBookConvert!;
  job.stage = "fetching";
  if (!(await hasPoppler())) throw new Error("poppler-utils isn't installed");
  await mkdir(dir(), { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(dir(), `.work-${hash}-`));
  try {
    /* The PDF, whole: the server's copy (made once, and shared with the reader), from its source only when none can be kept. */
    const source = join(work, "book.pdf");
    const { bookFileCache } = await import("../file-cache");
    const opened = await openCached(bookFileCache(), pdf);
    await writeFile(source, Readable.fromWeb(opened.body as import("node:stream/web").ReadableStream));
    job.progress = 0.02;
    job.stage = "reading";

    const book = state.options.bookFor?.(key) ?? state.seen.get(key) ?? null;
    const token = (await state.options.token?.().catch(() => "")) ?? "";
    const isbn = book?.isbns.find((i) => i.length === 13) ?? book?.isbns[0] ?? null;
    const { epub, report } = await convertPdf(source, work, {
      meta: { id: isbn ? `urn:isbn:${isbn}` : `urn:kimono:${hash}`, title: book?.title, authors: book?.authors, isbn, language: book?.language, publisher: book?.publisher, year: book?.year },
      token, restructurer: state.options.restructurer,
      progress: (f) => { job.progress = f; job.stage = f < 0.1 ? "reading" : f < 0.95 ? "structuring" : "packing"; },
    });
    await writeFile(join(dir(), `${hash}.json`), JSON.stringify({ pdf, key, version: VERSION, made: new Date().toISOString(), ...report }, null, 2));
    await writeFile(join(work, "book.epub"), epub.bytes);
    await rename(join(work, "book.epub"), epubPath(hash));
    console.info(`books convert: ${book?.title ?? pdf}: ${report.words} words, ${report.chapters.length} chapters, ${report.images} pictures${report.llm ? `, Claude ${report.llm.accepted}/${report.llm.sent} parts, $${report.llm.dollars}` : ", base only"} (${report.seconds}s)`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** What the last conversion of a PDF found, for checks. */
export async function conversionReport(pdfAddress: string): Promise<(ConversionReport & { pdf: string }) | null> {
  try { return JSON.parse(await readFile(join(dir(), `${hashOf(pdfAddress)}.json`), "utf8")); } catch { return null; }
}
