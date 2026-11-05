import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { blobPath, thumbPath, thumbWidths } from "./storage";

/*
 * Small pictures of image files, made once with sharp and kept beside the
 * bytes under thumbs/, named by blob and width. A blob never changes, so a
 * thumbnail never goes stale; removeBlob takes it away with the bytes.
 */
const pictured = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "heif", "tif", "tiff"]);

export const hasThumb = (name: string) => pictured.has(name.toLowerCase().split(".").pop() ?? "");

/* One sharp job per blob and width at a time, however many rows ask at once. */
const making = new Map<string, Promise<Buffer | null>>();

async function make(root: string, blob: string, width: number): Promise<Buffer | null> {
  const path = thumbPath(root, blob, width);
  const saved = await readFile(path).catch(() => null);
  if (saved) return saved;
  const { default: sharp } = await import("sharp");
  const picture = await sharp(blobPath(root, blob), { failOn: "none", limitInputPixels: 200_000_000 })
    .rotate()
    .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
    .webp({ quality: width > 512 ? 82 : 74 })
    .toBuffer()
    .catch(() => null);
  if (!picture) return null;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const part = `${path}.${process.pid}.part`;
  await writeFile(part, picture);
  await rename(part, path);
  return picture;
}

/** A file's thumbnail as a response, or 404 when it can't be pictured. */
export async function sendThumb(root: string, file: { blob: string; name: string; shared: boolean }, asked: string | null): Promise<Response> {
  if (!hasThumb(file.name)) return new Response("No thumbnail", { status: 404 });
  const width = thumbWidths.find((w) => w >= Number(asked || 0)) ?? thumbWidths[thumbWidths.length - 1];
  const key = `${file.blob}-${width}`;
  let job = making.get(key);
  if (!job) { job = make(root, file.blob, width).finally(() => making.delete(key)); making.set(key, job); }
  const picture = await job;
  if (!picture) return new Response("No thumbnail", { status: 404 });
  return new Response(new Uint8Array(picture), { headers: {
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": file.shared ? "cross-origin" : "same-site",
    /* The address carries the file's version, so it can be kept. */
    "Cache-Control": `${file.shared ? "public" : "private"}, max-age=31536000, immutable`,
  } });
}
