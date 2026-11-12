/**
 * YouTube: shows that TMDB doesn't list but whose broadcaster puts full
 * episodes up itself (2M's Rachid Show, on 2MTV). A show is one channel's
 * playlists under one name: "Rachid Show 2025", "Rachid Show: Season 2014"…
 * Each playlist is a season, oldest year first, and each long video in it an
 * episode.
 *
 * Search asks YouTube only when TMDB has nothing close, since every look
 * runs yt-dlp. Playback starts on YouTube's one file with sound in it
 * (360p), and the 1080p picture and its sound are fetched and put together
 * in one file meanwhile, kept on disk, which every later play takes.
 *
 * The grouping and ordering are pure, tested in scripts/test-watch.mjs;
 * yt-dlp, the disk and the local file are the thin part at the end.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { evictions, type CachedFile } from "./images";
import { WatchProblem, type Episode, type Title } from "./model";
import type { Release } from "./releases";

/* ───── Pure ───── */

export type Playlist = { id: string; title: string; channel: string; channelId: string; cover?: string | null };
export type Show = { id: string; channelId: string; channel: string; name: string; cover?: string | null };
export type Video = { id: string; title: string; seconds: number | null };

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** A playlist's title without its season: no years, no "Season"/"Saison"/"الموسم", no numbers left over. */
const baseName = (title: string) => title
  .replace(/\b(19|20)\d\d(\s*[-/–]\s*(19|20)?\d\d)?\b/g, " ")
  .replace(/\b(season|saison|temporada|staffel)\b\s*\d*|\bs\d{1,2}\b|الموسم\s*\d*/giu, " ")
  .replace(/[\s:|\-–—()[\]]+$/u, "").replace(/^[\s:|\-–—()[\]]+/u, "").replace(/\s+/g, " ").trim();

const yearOf = (title: string) => Number(/\b((19|20)\d\d)\b/.exec(title)?.[1]) || null;

export const youtubeTitleId = (channelId: string, name: string) => `yt-${channelId}.${createHash("sha1").update(plain(name)).digest("hex").slice(0, 8)}`;
export const isYoutubeId = (id: string) => /^yt-[A-Za-z0-9_-]{10,40}\.[a-f0-9]{8}$/.test(id);

/**
 * The shows a playlist search found: playlists grouped by channel and by
 * name once the season is taken off, kept when the name has the query in it.
 * A channel with several seasons of it beats someone's one playlist of
 * reuploads; when nobody has several, the first found stands alone.
 */
export function showsFrom(query: string, playlists: Playlist[]): Show[] {
  const q = plain(query);
  const groups = new Map<string, { show: Show; count: number; first: number }>();
  playlists.forEach((p, index) => {
    const name = baseName(p.title) || p.title;
    /* "rachid show 2m" finds "Rachid Show", but "dar lghezlane" doesn't find someone's "Dar". */
    const n = plain(name);
    if (!n.includes(q) && !(q.includes(n) && n.length >= q.length * 0.6)) return;
    if (!p.channelId) return;
    const id = youtubeTitleId(p.channelId, name);
    const known = groups.get(id);
    if (known) { known.count += 1; known.show.cover ??= p.cover ?? null; }
    else groups.set(id, { show: { id, channelId: p.channelId, channel: p.channel, name, cover: p.cover ?? null }, count: 1, first: index });
  });
  const all = [...groups.values()].sort((a, b) => b.count - a.count || a.first - b.first);
  const several = all.filter((g) => g.count > 1);
  return (several.length ? several : all.slice(0, 1)).map((g) => g.show);
}

/** A show's seasons from its channel's playlists: the ones under its name, oldest year first, those without a year after. */
export function seasonsFrom(show: Pick<Show, "name">, playlists: Pick<Playlist, "id" | "title">[]): Pick<Playlist, "id" | "title">[] {
  const name = plain(show.name);
  return playlists
    .filter((p) => plain(baseName(p.title) || p.title) === name)
    .map((p, index) => ({ p, year: yearOf(p.title), index }))
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.index - b.index)
    .map(({ p }) => p);
}

/** A playlist's episodes: its full ones, when it mixes them with clips (any over half an hour, so anything under a quarter is a clip). */
export function episodesFrom(videos: Video[]): (Omit<Episode, "titleId" | "season"> & { videoId: string })[] {
  const long = videos.some((v) => (v.seconds ?? 0) > 30 * 60);
  return videos
    .filter((v) => !/^\[(private|deleted) video\]$/i.test(v.title) && (!long || v.seconds === null || v.seconds >= 15 * 60))
    .map((v, index) => ({
      number: index + 1, name: v.title, overview: "", still: thumb(v.id), runtime: v.seconds ? Math.round(v.seconds / 60) : null,
      airDate: null, filler: false, recap: false, videoId: v.id,
    }));
}

/** A video's thumbnail as an image path Kimono serves (./images.ts). */
export const thumb = (videoId: string) => `/yt/${videoId}.jpg`;

export function stubOf(show: Show): Title {
  const cover = show.cover ?? null;
  return {
    id: show.id, kind: "series", tmdbId: 0, imdbId: null, anilistId: null, malId: null,
    name: show.name, overview: "", year: null, age: "", genres: [], moods: [], shelf: "Series",
    poster: cover ? thumb(cover) : null, backdrop: cover ? thumb(cover) : null, logo: null, runtime: null,
    popularity: 0, status: "Returning Series", nextAirDate: null, seasonCount: 0, cast: [], originalLanguage: "", keywords: [], fetchedAt: 0,
  };
}

/** A YouTube copy as a release: H.264 and AAC, the way YouTube makes them. */
export function releaseOf(url: string, height: number, bytes: number | null, kept: boolean): Release {
  return {
    url, name: kept ? `YouTube ${height}p` : `YouTube ${height}p (until HD is ready)`, filename: "", height, source: "web-dl", codec: "h264", tenBit: false, hdr: [], dvProfile: null,
    audio: "aac", atmos: false, channels: "2.0", languages: [], subtitles: [], mbps: null, bytes, cached: true, service: "unknown", junk: false, reframed: false,
  };
}

/* ───── yt-dlp ───── */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const binary = () => process.env.KIMONO_WATCH_YTDLP || "yt-dlp";
/* Node is already here to solve YouTube's signatures; no other runtime is installed. */
const common = ["--no-warnings", "--ignore-config", "--js-runtimes", "node"];

function run(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary(), [...common, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [], err: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", (error) => { clearTimeout(timer); reject(new WatchProblem(`YouTube isn't reachable from Watch (${error.message}).`, 503)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString("utf8"));
      else {
        console.error(`[watch] yt-dlp ${args.at(-1)}: ${Buffer.concat(err).toString("utf8").slice(-400)}`);
        reject(new WatchProblem("YouTube didn't answer. Try again in a moment.", 502));
      }
    });
  });
}

const json = async (args: string[], timeoutMs: number) => JSON.parse(await run(["-J", ...args], timeoutMs)) as Json;

/** Playlists YouTube finds for a query. */
export async function searchPlaylists(query: string, count = 20): Promise<Playlist[]> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAw%253D%253D`;
  const body = await json(["--flat-playlist", "--playlist-end", String(count), url], 30_000);
  return ((body.entries ?? []) as Json[]).filter((e) => e.id && e.title)
    .map((e) => ({ id: String(e.id), title: String(e.title), channel: String(e.channel ?? e.uploader ?? ""), channelId: String(e.channel_id ?? e.uploader_id ?? ""), cover: coverOf(e) }));
}

/** The video a playlist's thumbnail is of. */
const coverOf = (e: Json): string | null => {
  for (const t of (e.thumbnails ?? []) as Json[]) { const id = /\/vi\/([A-Za-z0-9_-]{11})\//.exec(String(t.url ?? ""))?.[1]; if (id) return id; }
  return null;
};

/** Every playlist on a channel. */
export async function channelPlaylists(channelId: string): Promise<Pick<Playlist, "id" | "title">[]> {
  const body = await json(["--flat-playlist", `https://www.youtube.com/channel/${channelId}/playlists`], 60_000);
  return ((body.entries ?? []) as Json[]).filter((e) => e.id && e.title).map((e) => ({ id: String(e.id), title: String(e.title) }));
}

export async function playlistVideos(playlistId: string): Promise<Video[]> {
  const body = await json(["--flat-playlist", `https://www.youtube.com/playlist?list=${playlistId}`], 60_000);
  return ((body.entries ?? []) as Json[]).filter((e) => e.id)
    .map((e) => ({ id: String(e.id), title: String(e.title ?? ""), seconds: Number.isFinite(Number(e.duration)) && e.duration ? Number(e.duration) : null }));
}

/**
 * The one file with picture and sound together (format 18): it plays at once,
 * anywhere. Asked as YouTube's VR app, whose addresses open for anyone with
 * its User-Agent (the web's want a token only a browser makes); the agent
 * rides along after "#kimono-ua=" and the relay sends it (./streams.ts).
 */
export async function directCopy(videoId: string): Promise<{ url: string; height: number; bytes: number | null }> {
  const body = await json(["--extractor-args", "youtube:player_client=android_vr", "-f", "18", `https://www.youtube.com/watch?v=${videoId}`], 40_000);
  if (!body.url) throw new WatchProblem("YouTube has no copy of this one.", 404);
  const agent = String(body.http_headers?.["User-Agent"] ?? "");
  return { url: `${body.url}${agent ? `#kimono-ua=${encodeURIComponent(agent)}` : ""}`, height: Number(body.height) || 360, bytes: Number(body.filesize ?? body.filesize_approx) || null };
}

/* ───── Kept HD copies ───── */

const capBytes = () => (Number(process.env.KIMONO_WATCH_YOUTUBE_CACHE_GB) || 60) * 1024 ** 3;
const memory = globalThis as unknown as { kimonoWatchYoutube?: { fetching: Map<string, Promise<void>>; queue: Promise<void> } };
const state = (memory.kimonoWatchYoutube ??= { fetching: new Map(), queue: Promise.resolve() });

/** Where a kept copy lives, by its address ("kimono-youtube:<id>"). */
export const keptAddress = (videoId: string) => `kimono-youtube:${videoId}`;
/** A kept copy is "<video>.<height>.mp4": older videos never went past 360p, so the height is what was got, not what was asked. */
export async function keptCopy(dir: string, videoId: string): Promise<{ path: string; height: number; bytes: number } | null> {
  const name = (await readdir(dir).catch(() => [] as string[])).find((n) => n.startsWith(`${videoId}.`) && /^[A-Za-z0-9_-]{11}\.\d{3,4}\.mp4$/.test(n));
  if (!name) return null;
  const info = await stat(join(dir, name)).catch(() => null);
  return info?.isFile() ? { path: join(dir, name), height: Number(name.split(".")[1]), bytes: info.size } : null;
}

/**
 * Fetches the 1080p H.264 picture and its sound and puts them in one MP4,
 * moov first so it streams. One at a time: each is a gigabyte or two.
 */
export function keepHd(dir: string, videoId: string) {
  if (state.fetching.has(videoId)) return;
  const job = state.queue.then(async () => {
    if (await keptCopy(dir, videoId)) return;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const part = join(dir, `${videoId}.part.mp4`);
    const printed = await run([
      "-f", "bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[vcodec^=avc1]",
      "--merge-output-format", "mp4", "--postprocessor-args", "Merger+ffmpeg:-movflags +faststart",
      "--no-part", "--force-overwrites", "--no-simulate", "--print", "after_move:%(height)s", "-o", part, `https://www.youtube.com/watch?v=${videoId}`,
    ], 3 * 60 * 60 * 1000);
    const height = Number(printed.trim().split("\n").pop()) || 360;
    await rename(part, join(dir, `${videoId}.${height}.mp4`));
    await trim(dir);
  }).catch(() => {}).finally(() => state.fetching.delete(videoId));
  state.fetching.set(videoId, job);
  state.queue = job;
}

async function trim(dir: string) {
  const files: CachedFile[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!/^[A-Za-z0-9_-]{11}\.\d{3,4}\.mp4$/.test(name)) continue;
    const info = await stat(join(dir, name)).catch(() => null);
    if (info?.isFile()) files.push({ path: join(dir, name), bytes: info.size, usedAt: info.mtimeMs });
  }
  for (const f of evictions(files, capBytes())) await unlink(f.path).catch(() => {});
}

/** A kept copy served with Range, as the relay serves anything upstream. */
export async function keptResponse(dir: string, address: string, request: Request): Promise<Response> {
  const videoId = address.slice("kimono-youtube:".length);
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return new Response("That isn't a copy.", { status: 404 });
  const kept = await keptCopy(dir, videoId);
  const path = kept?.path ?? "";
  const info = kept ? await stat(path).catch(() => null) : null;
  if (!info?.isFile()) return new Response("That copy is gone. Press play again.", { status: 404 });
  const now = new Date();
  utimes(path, now, now).catch(() => {});
  const headers = new Headers({ "content-type": "video/mp4", "accept-ranges": "bytes", "cache-control": "private, no-store" });
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  let start = 0, end = info.size - 1, status = 200;
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${info.size}` } });
    status = 206;
    headers.set("content-range", `bytes ${start}-${end}/${info.size}`);
  }
  headers.set("content-length", String(end - start + 1));
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}
