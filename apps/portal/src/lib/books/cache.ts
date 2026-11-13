/**
 * 本 Books' file cache: a book a source opened once is kept on the server's
 * disk, so opening it again, and every page and range after, comes from
 * here instead of the source. Least recently opened books make room for new
 * ones past the cap (KIMONO_BOOKS_CACHE_GB, 50 GB by default).
 *
 * The first opening isn't held up by it: the request is answered from the
 * source while one copy fills the cache behind it (one per file, however
 * many ask at once).
 */
import { createHash } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FilePreparing, openFile, type Opened, type Range } from "./files";

type Entry = { file: string; size: number; filename: string; at: number };
type Index = Record<string, Entry>;

const g = globalThis as unknown as {
  kimonoBookFilling?: Map<string, Promise<Entry | null>>; kimonoBookIndex?: { dir: string; index: Index };
  /* How far each download has got, for the bar the first reader sees. */
  kimonoBookFillProgress?: Map<string, { got: number; size: number | null }>;
};

/**
 * Whether a downloaded file is what its address says: an EPUB is a zip ("PK"),
 * a PDF starts "%PDF". A web page (a source's error or sign-in page, say) is
 * never a book. Answers null when it's fine, else what was found instead.
 */
export function notABook(path: string, address: string): string | null {
  const fd = openSync(path, "r");
  const head = Buffer.alloc(512);
  let got = 0;
  try { got = readSync(fd, head, 0, 512, 0); } finally { closeSync(fd); }
  const start = head.subarray(0, got);
  const text = start.toString("latin1").trimStart().slice(0, 200);
  if (/^<(!doctype|html|\?xml|head|body)|^\{"/i.test(text)) return `a web page or reply, not a book: ${text.replace(/\s+/g, " ").slice(0, 120)}`;
  const format = /\.(epub|pdf)$/i.exec(address)?.[1]?.toLowerCase();
  if (format === "epub" && !(start[0] === 0x50 && start[1] === 0x4b)) return "not an EPUB (no zip at its start)";
  if (format === "pdf" && !start.toString("latin1", 0, Math.min(got, 1024)).includes("%PDF")) return "not a PDF";
  return null;
}

/* When each book was last opened: strictly increasing, so two opens in the same millisecond still have an order. */
let last = 0;
const tick = () => (last = Math.max(Date.now(), last + 1));

export class FileCache {
  constructor(readonly dir: string, readonly capBytes: number) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  private get indexPath() { return join(this.dir, "index.json"); }

  private read(): Index {
    if (g.kimonoBookIndex?.dir === this.dir) return g.kimonoBookIndex.index;
    let index: Index = {};
    try { index = JSON.parse(readFileSync(this.indexPath, "utf8")) as Index; } catch { /* a fresh cache */ }
    g.kimonoBookIndex = { dir: this.dir, index };
    return index;
  }

  private write(index: Index) {
    const tmp = `${this.indexPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(index), { mode: 0o600 });
    renameSync(tmp, this.indexPath);
  }

  /* Copies checked to be books in this run: one kept before the check existed is looked at once. */
  private checked = new Set<string>();

  /** The cached copy of a file, if there is one (and it's still on disk, and is a book). */
  get(address: string): Entry | null {
    const index = this.read();
    const entry = index[address];
    if (!entry) return null;
    try {
      if (statSync(join(this.dir, entry.file)).size !== entry.size) throw new Error("changed");
      if (!this.checked.has(address)) {
        const wrong = notABook(join(this.dir, entry.file), address);
        if (wrong) { console.warn(`books cache: ${address}: the kept copy is ${wrong}; it goes, and is fetched again`); rmSync(join(this.dir, entry.file), { force: true }); throw new Error("not a book"); }
        this.checked.add(address);
      }
    } catch {
      delete index[address];
      this.write(index);
      return null;
    }
    entry.at = tick();
    return entry;
  }

  pathOf(entry: Entry) { return join(this.dir, entry.file); }

  /** Copies a file from its source into the cache, once, however many ask at the same time. */
  fill(address: string, open: (range?: Range) => Promise<Opened> = (range) => openFile(address, range)): Promise<Entry | null> {
    /* Already kept: never downloaded again. */
    const kept = this.get(address);
    if (kept) return Promise.resolve(kept);
    const filling = (g.kimonoBookFilling ??= new Map());
    const known = filling.get(`${this.dir}|${address}`);
    if (known) return known;
    const job = (async () => {
      const file = createHash("sha256").update(address).digest("hex").slice(0, 32);
      const tmp = join(this.dir, `${file}.part`);
      try {
        const opened = await open();
        const progress = (g.kimonoBookFillProgress ??= new Map());
        const at = { got: 0, size: opened.size };
        progress.set(`${this.dir}|${address}`, at);
        const counted = new Transform({ transform(chunk: Buffer, _enc, done) { at.got += chunk.length; done(null, chunk); } });
        await pipeline(Readable.fromWeb(opened.body as import("node:stream/web").ReadableStream), counted, createWriteStream(tmp, { mode: 0o600 }));
        const size = statSync(tmp).size;
        if (opened.size !== null && size !== opened.size) throw new Error(`short copy: ${size} of ${opened.size}`);
        const wrong = notABook(tmp, address);
        if (wrong) throw new Error(`the source sent ${wrong}`);
        renameSync(tmp, join(this.dir, file));
        const entry: Entry = { file, size, filename: opened.filename, at: tick() };
        const index = this.read();
        index[address] = entry;
        this.evict(index);
        this.write(index);
        return entry;
      } catch (error) {
        rmSync(tmp, { force: true });
        /* Still being made (a PDF's EPUB): the asker shows that, and asks again. */
        if (error instanceof FilePreparing) throw error;
        console.warn(`books cache: ${address}: ${error instanceof Error ? error.message : error}`);
        return null;
      }
    })().finally(() => { filling.delete(`${this.dir}|${address}`); g.kimonoBookFillProgress?.delete(`${this.dir}|${address}`); });
    filling.set(`${this.dir}|${address}`, job);
    return job;
  }

  /**
   * Where a file stands: kept, being fetched (bytes so far, of how many), or
   * neither. Asking starts the fetch, so a reader can show a bar while it runs.
   */
  status(address: string): { ready: true; size: number } | { ready: false; got: number; size: number | null } {
    const kept = this.get(address);
    if (kept) return { ready: true, size: kept.size };
    void this.fill(address).catch(() => null);
    const at = g.kimonoBookFillProgress?.get(`${this.dir}|${address}`);
    return { ready: false, got: at?.got ?? 0, size: at?.size ?? null };
  }

  /** Least recently opened first, until the cache fits under its cap again. */
  private evict(index: Index) {
    let total = Object.values(index).reduce((n, e) => n + e.size, 0);
    for (const [address, entry] of Object.entries(index).sort((a, b) => a[1].at - b[1].at)) {
      if (total <= this.capBytes) break;
      rmSync(join(this.dir, entry.file), { force: true });
      delete index[address];
      total -= entry.size;
    }
  }

  /** Serves a cached file, whole or a byte range, from disk. */
  serve(entry: Entry, range?: Range): Opened {
    if (range && range.start >= entry.size) throw Object.assign(new Error("That range isn't in the file."), { status: 416 });
    const start = range?.start ?? 0;
    const end = Math.min(range?.end ?? entry.size - 1, entry.size - 1);
    const stream = createReadStream(join(this.dir, entry.file), { start, end });
    return { body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, size: entry.size, range: range ? { start, end } : null, filename: entry.filename };
  }
}

/**
 * Opens a file through the cache. A source is downloaded from once: the
 * first opening waits for the server's copy (one download, however many ask
 * at once, ranges included) and everything is served from disk after that.
 * Sources such as Anna's count every download, so nothing streams from them
 * beside the copy. Only if no copy could be kept is the source asked directly.
 */
export async function openCached(cache: FileCache, address: string, range?: Range): Promise<Opened> {
  const entry = cache.get(address) ?? await cache.fill(address);
  if (entry) return cache.serve(entry, range);
  return openFile(address, range);
}

/** A cached copy on disk, waiting for it to be made if need be (the EPUB reader reads inside the file). */
export async function ensureCached(cache: FileCache, address: string): Promise<{ path: string; size: number; filename: string } | null> {
  const entry = cache.get(address) ?? await cache.fill(address);
  return entry ? { path: cache.pathOf(entry), size: entry.size, filename: entry.filename } : null;
}
