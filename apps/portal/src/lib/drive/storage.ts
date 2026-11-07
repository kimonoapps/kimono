import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, statfs } from "node:fs/promises";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";

/**
 * Where Drive keeps bytes: one file per upload under files/, named by a random
 * blob id and never by the file's name, so renames and moves are database-only
 * and no name can reach the filesystem. Partial uploads wait in uploads/.
 */
export function driveRoot(stateDir: string) {
  return process.env.KIMONO_DRIVE_DIR || join(stateDir, "drive");
}

export const blobPath = (root: string, blob: string) => join(root, "files", blob.slice(0, 2), blob);
export const partPath = (root: string, upload: string) => join(root, "uploads", `${upload}.part`);

/** Moves a finished upload into place. Same filesystem, so it is a rename, not a copy. */
export async function keepUpload(root: string, upload: string, blob: string) {
  const target = blobPath(root, blob);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await rename(partPath(root, upload), target);
}

/* Thumbnails of a blob (thumbs.ts), by width; they go with it. */
export const thumbWidths = [256, 1280] as const;
export const thumbPath = (root: string, blob: string, width: number) => join(root, "thumbs", blob.slice(0, 2), `${blob}-${width}.webp`);
export async function removeBlob(root: string, blob: string) {
  await Promise.all([blobPath(root, blob), ...thumbWidths.map((width) => thumbPath(root, blob, width))].map((path) => rm(path, { force: true })));
}
export async function removePart(root: string, upload: string) { await rm(partPath(root, upload), { force: true }); }

/** Bytes free for Drive, keeping some back so the server itself never fills up. */
export async function freeBytes(root: string): Promise<number> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const fs = await statfs(root);
  return Number(fs.bavail) * Number(fs.bsize);
}
export const reserveBytes = 2 * 1024 ** 3;

/* Types shown in the browser. Anything else downloads, so an uploaded page or
   SVG can never run as Kimono. */
const inline = new Map(Object.entries({
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", flac: "audio/flac",
  txt: "text/plain; charset=utf-8",
}));
const known = new Map(Object.entries({
  pdf: "application/pdf", zip: "application/zip", json: "application/json", csv: "text/csv",
  svg: "image/svg+xml", html: "text/html", heic: "image/heic", mkv: "video/x-matroska",
}));

/** A file's type, from its name. What the uploader claimed is never trusted. */
export function typeOf(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return inline.get(ext) ?? known.get(ext) ?? "application/octet-stream";
}
const showsInline = (type: string) => [...inline.values()].includes(type);

/**
 * A file's bytes as a web stream, read a megabyte at a time. Node's default is
 * 64 KB, and every piece costs a trip through the web stream and the response
 * writer: served through Next that was about three times slower.
 */
export function fileStream(path: string, start?: number, end?: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(path, { start, end, highWaterMark: 1024 * 1024 })) as ReadableStream<Uint8Array>;
}

/**
 * Sends a file with HTTP ranges, so video seeks and resumes instead of
 * downloading whole. One range per request, which is all players ask for.
 */
export async function sendFile(request: Request, path: string, file: { name: string; size: number; type: string; etag: string; shared: boolean; download?: boolean }): Promise<Response> {
  const info = await stat(path).catch(() => null);
  if (!info) return new Response("Not found", { status: 404 });
  const size = info.size;
  const inlineOk = showsInline(file.type);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": inlineOk ? file.type : "application/octet-stream",
    /* Asked to download: always a download, even for what a browser would show. */
    "Content-Disposition": `${inlineOk && !file.download ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "ETag": `"${file.etag}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    /* Shared links are fetched by Discord and the like; private files stay on Kimono. */
    "Cross-Origin-Resource-Policy": file.shared ? "cross-origin" : "same-site",
    "Cache-Control": file.shared ? "public, max-age=300" : "private, no-cache",
  });
  if (request.headers.get("if-none-match") === `"${file.etag}"`) return new Response(null, { status: 304, headers });

  let start = 0, end = size - 1, status = 200;
  const range = request.headers.get("range");
  if (range && size > 0) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), size - 1); }
    else { start = Math.max(0, size - Number(match[2])); }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("Content-Length", String(size === 0 ? 0 : end - start + 1));
  if (request.method === "HEAD" || size === 0) return new Response(null, { status, headers });
  return new Response(fileStream(path, start, end), { status, headers });
}
