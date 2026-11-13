/**
 * 本 Books' file cache: a book a source opened once is kept on the server's
 * disk, so opening it again, and every page and range after, comes from
 * here instead of the source. Least recently opened books make room for new
 * ones past the cap (KIMONO_BOOKS_CACHE_GB, 4 GB by default).
 *
 * The first opening isn't held up by it: the request is answered from the
 * source while one copy fills the cache behind it (one per file, however
 * many ask at once).
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FilePreparing, openFile, type Opened, type Range } from "./files";

type Entry = { file: string; size: number; filename: string; at: number };
type Index = Record<string, Entry>;

const g = globalThis as unknown as { kimonoBookFilling?: Map<string, Promise<Entry | null>>; kimonoBookIndex?: { dir: string; index: Index } };

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

  /** The cached copy of a file, if there is one (and it's still on disk). */
  get(address: string): Entry | null {
    const index = this.read();
    const entry = index[address];
    if (!entry) return null;
    try {
      if (statSync(join(this.dir, entry.file)).size !== entry.size) throw new Error("changed");
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
    const filling = (g.kimonoBookFilling ??= new Map());
    const known = filling.get(`${this.dir}|${address}`);
    if (known) return known;
    const job = (async () => {
      const file = createHash("sha256").update(address).digest("hex").slice(0, 32);
      const tmp = join(this.dir, `${file}.part`);
      try {
        const opened = await open();
        await pipeline(Readable.fromWeb(opened.body as import("node:stream/web").ReadableStream), createWriteStream(tmp, { mode: 0o600 }));
        const size = statSync(tmp).size;
        if (opened.size !== null && size !== opened.size) throw new Error(`short copy: ${size} of ${opened.size}`);
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
    })().finally(() => filling.delete(`${this.dir}|${address}`));
    filling.set(`${this.dir}|${address}`, job);
    return job;
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
 * Opens a file through the cache: from disk when it's there; otherwise
 * straight from its source, while a copy fills the cache for next time.
 */
export async function openCached(cache: FileCache, address: string, range?: Range): Promise<Opened> {
  const entry = cache.get(address);
  if (entry) return cache.serve(entry, range);
  void cache.fill(address);
  return openFile(address, range);
}

/** A cached copy on disk, waiting for it to be made if need be (the EPUB reader reads inside the file). */
export async function ensureCached(cache: FileCache, address: string): Promise<{ path: string; size: number; filename: string } | null> {
  const entry = cache.get(address) ?? await cache.fill(address);
  return entry ? { path: cache.pathOf(entry), size: entry.size, filename: entry.filename } : null;
}
