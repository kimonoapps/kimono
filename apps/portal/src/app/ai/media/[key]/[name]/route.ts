import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import { db, mediaDir } from "@/lib/code";
import { artifactByMediaKey, mediaNames } from "@/lib/code/artifacts";
import { typeOf } from "@/lib/drive/storage";

/*
 * An artifact's media (lib/code/artifacts.ts): a sound, video or picture its
 * page names as media/<file>, for its sandboxed frame, which has no cookies,
 * so the key in the address is what opens it. Only files the artifact's page
 * names now are served. Byte ranges, so audio and video can seek.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string; name: string }> };

const missing = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: Context) {
  const { key, name } = await params;
  const artifact = artifactByMediaKey(db(), key);
  if (!artifact || !mediaNames(artifact.content).includes(name)) return missing();
  const path = join(mediaDir(artifact.workspaceId), name);
  const found = await stat(path).catch(() => null);
  if (!found?.isFile()) return missing();
  const size = found.size;
  const headers: Record<string, string> = {
    "Content-Type": typeOf(name).split(";")[0] || "application/octet-stream",
    "Accept-Ranges": "bytes",
    /* The same name may be made again with new sound: check each time, cheaply. */
    "Cache-Control": "private, no-cache",
    "ETag": `"${size.toString(16)}-${Math.floor(found.mtimeMs).toString(16)}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "cross-origin",
    /* the frame reads its sound with CORS where it sets the volume through Web Audio (iOS) */
    "Access-Control-Allow-Origin": "*",
    "Referrer-Policy": "no-referrer",
  };
  if (request.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });

  let start = 0, end = size - 1, status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), size - 1); }
    else start = Math.max(0, size - Number(range[2]));
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  if (request.method === "HEAD" || size === 0) return new Response(null, { status, headers });

  /* Read as the client takes it, so a slow player never has the whole video held here. */
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}

export const HEAD = GET;
