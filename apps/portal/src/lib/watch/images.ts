/**
 * Posters, backdrops, logos and stills, served by Kimono so phones and TVs
 * never call TMDB. The first request for an image fetches it from
 * image.tmdb.org and keeps it on disk; after that it comes from the disk.
 * TMDB's file names never change for a picture, so they are served to be
 * kept for a year.
 *
 * The disk cache has a size cap (KIMONO_WATCH_IMAGE_CACHE_MB, 1 GB by
 * default): when it is passed, the images used longest ago go first (a hit
 * touches the file, so its time is when it was last used).
 *
 * Which requests are allowed and what to forget are pure, tested in
 * scripts/test-watch.mjs; the disk and the fetch are the thin part at the end.
 */
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { shared } from "./ahead";

/** The sizes the apps ask for. */
export const imageSizes = ["w92", "w154", "w185", "w300", "w342", "w500", "w780", "w1280", "original"] as const;
const types: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", svg: "image/svg+xml" };

/** Kimono's address for a TMDB image path ("/abc.jpg"), or null when there is none. */
export const imageUrl = (origin: string, path: string | null, size = "w780") => (path ? `${origin}/api/v1/watch/image/${size}${path}` : null);

/** A request's size and file, if it is one TMDB could have: one plain file name, a known size and kind. */
export function imageRequest(size: string, path: string[]): { size: string; file: string; type: string } | null {
  /* A YouTube video's thumbnail ("/yt/<video>.jpg", ./youtube.ts); TMDB's names never have a dash at the start. */
  if ((imageSizes as readonly string[]).includes(size) && path.length === 2 && path[0] === "yt") {
    const video = /^([A-Za-z0-9_-]{11})\.jpg$/.exec(path[1])?.[1];
    return video ? { size, file: `-yt-${video}.jpg`, type: types.jpg } : null;
  }
  if (!(imageSizes as readonly string[]).includes(size) || path.length !== 1) return null;
  const match = /^[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp|svg)$/.exec(path[0]);
  return match ? { size, file: path[0], type: types[match[1]] } : null;
}

export type CachedFile = { path: string; bytes: number; usedAt: number };

/** What to forget so the cache is back under 90% of its cap: the least recently used first. */
export function evictions(files: CachedFile[], cap: number): CachedFile[] {
  let total = files.reduce((sum, f) => sum + f.bytes, 0);
  if (total <= cap) return [];
  const out: CachedFile[] = [];
  for (const f of files.slice().sort((a, b) => a.usedAt - b.usedAt)) {
    if (total <= cap * 0.9) break;
    out.push(f);
    total -= f.bytes;
  }
  return out;
}

/** Served as-is, with a year of caching. An SVG can't run anything (it's a picture, not a page). */
export function imageHeaders(type: string, bytes: number): Headers {
  return new Headers({
    "content-type": type,
    "content-length": String(bytes),
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
}

/* ───── Disk and fetch ───── */

const capBytes = () => (Number(process.env.KIMONO_WATCH_IMAGE_CACHE_MB) || 1024) * 1024 * 1024;
const memory = globalThis as unknown as { kimonoWatchImages?: { total: number | null; fetching: Map<string, Promise<Buffer | null>> } };
const state = (memory.kimonoWatchImages ??= { total: null, fetching: new Map() });

async function listCache(dir: string): Promise<CachedFile[]> {
  const sizes = await readdir(dir).catch(() => [] as string[]);
  const files: CachedFile[] = [];
  for (const size of sizes) {
    for (const name of await readdir(join(dir, size)).catch(() => [] as string[])) {
      if (name.endsWith(".part")) continue;
      const path = join(dir, size, name);
      const info = await stat(path).catch(() => null);
      if (info?.isFile()) files.push({ path, bytes: info.size, usedAt: info.mtimeMs });
    }
  }
  return files;
}

/** Counts what was just written, and forgets the oldest images once the cap is passed. */
async function account(dir: string, bytes: number) {
  if (state.total === null) state.total = (await listCache(dir)).reduce((sum, f) => sum + f.bytes, 0);
  else state.total += bytes;
  if (state.total <= capBytes()) return;
  const files = await listCache(dir);
  const gone = evictions(files, capBytes());
  for (const f of gone) await unlink(f.path).catch(() => {});
  state.total = files.reduce((sum, f) => sum + f.bytes, 0) - gone.reduce((sum, f) => sum + f.bytes, 0);
}

async function fetchImage(dir: string, size: string, file: string): Promise<Buffer | null> {
  const video = /^-yt-([A-Za-z0-9_-]{11})\.jpg$/.exec(file)?.[1];
  const from = video ? `https://i.ytimg.com/vi/${video}/${["w780", "w1280", "original"].includes(size) ? "maxresdefault" : "hqdefault"}.jpg` : `https://image.tmdb.org/t/p/${size}/${file}`;
  let response = await fetch(from, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  /* Older videos have no full-size thumbnail. */
  if (video && !response?.ok) response = await fetch(`https://i.ytimg.com/vi/${video}/hqdefault.jpg`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok) return null;
  const body = Buffer.from(await response.arrayBuffer());
  const folder = join(dir, size);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const target = join(folder, file), part = `${target}.${process.pid}.${Date.now()}.part`;
  await writeFile(part, body, { mode: 0o600 });
  await rename(part, target);
  await account(dir, body.length).catch(() => {});
  return body;
}

/** The image, from disk or from TMDB the first time. Null when TMDB has no such image. */
export async function cachedImage(dir: string, size: string, file: string): Promise<Buffer | null> {
  const path = join(dir, size, file);
  const kept = await readFile(path).catch(() => null);
  if (kept) {
    const now = new Date();
    utimes(path, now, now).catch(() => {});
    return kept;
  }
  return shared(state.fetching, `${size}/${file}`, () => fetchImage(dir, size, file));
}
