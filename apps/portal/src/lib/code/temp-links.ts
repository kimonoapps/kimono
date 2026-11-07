import "server-only";

import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { sendFile, typeOf } from "../drive/storage";
import { stateDir } from "../state";
import type { CodeConfig } from "./config";
import { CodeProblem, type Workspace } from "./model";
import { sandbox } from "./node";

/*
 * Temporary file links. Tools outside Kimono (a video generator animating a
 * photo, a transcriber) take files by link, and the sandbox has no internet.
 * kimono-link copies a file to .kimono/links/<token>/<name> with an expiry
 * beside it and prints <base>/<token>/<name>; the first fetch copies it out
 * of the sandbox to here, and it is served from here until it expires. The
 * 128-bit token is the only key: the fetchers are anonymous.
 */

const root = join(stateDir, "code", "temp-links");
const tokenShape = /^[0-9a-f]{32}$/;
const nameShape = /^[A-Za-z0-9][A-Za-z0-9._-]{0,90}$/;
/** However long the helper was told, never more than a day (and a little for clocks). */
const longest = 24 * 60 * 60 * 1000 + 5 * 60 * 1000;

/** Where kimono-link's links for a workspace start. */
export const tempLinkBase = (origin: string, workspaceId: string) => `${origin}/api/v1/code/temp/${workspaceId}`;

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
const copying = new Map<string, Promise<number | null>>();
let swept = 0;

/** Removes links that have expired, at most every ten minutes. */
async function sweep(now: number) {
  if (now - swept < 10 * 60 * 1000) return;
  swept = now;
  for (const space of await readdir(root).catch(() => [])) {
    for (const token of await readdir(join(root, space)).catch(() => [])) {
      const until = Number(await readFile(join(root, space, token, ".expires"), "utf8").catch(() => "0"));
      if (!(until > now)) await rm(join(root, space, token), { recursive: true, force: true });
    }
  }
}

/** Copies a linked file out of the sandbox; its expiry (ms), or null when there's no such link or it has expired. */
async function copyOut(config: CodeConfig, workspace: Workspace, token: string, name: string, now: number): Promise<number | null> {
  const asked = await sandbox.file(config, workspace, `.kimono/links/${token}/.expires`).catch(() => null);
  if (!asked?.ok) return null;
  const until = Number((await asked.text()).trim()) * 1000;
  if (!Number.isFinite(until) || until <= now) return null;
  const capped = Math.min(until, now + longest);
  const file = await sandbox.file(config, workspace, `.kimono/links/${token}/${name}`, true).catch(() => null);
  if (!file?.ok) return null;
  const folder = join(root, workspace.id, token);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  /* Streamed to disk: a linked file can be big, and needn't sit in memory on its way. */
  if (!file.body) return null;
  await pipeline(Readable.fromWeb(file.body as import("node:stream/web").ReadableStream<Uint8Array>), createWriteStream(join(folder, `${name}.part`), { mode: 0o600 }));
  await rename(join(folder, `${name}.part`), join(folder, name));
  await writeFile(join(folder, ".expires"), String(capped), { mode: 0o600 });
  return capped;
}

/** Serves one linked file, copying it out of the sandbox the first time; 404 for anything else. */
export async function serveTempLink(request: Request, config: CodeConfig, workspace: Workspace, token: string, rawName: string, now = Date.now()): Promise<Response> {
  const name = decodeURIComponent(rawName);
  if (!tokenShape.test(token) || !nameShape.test(name) || name.endsWith(".part")) return notFound();
  void sweep(now).catch(() => {});
  const folder = join(root, workspace.id, token);
  let until = Number(await readFile(join(folder, ".expires"), "utf8").catch(() => "0"));
  if (!(until > now) || !(await stat(join(folder, name)).catch(() => null))) {
    if (until && until <= now) return notFound();
    const key = `${workspace.id}/${token}/${name}`;
    let pending = copying.get(key);
    if (!pending) {
      pending = copyOut(config, workspace, token, name, now).catch((error) => {
        if (!(error instanceof CodeProblem)) console.warn("Kimono AI couldn't copy a linked file:", error instanceof Error ? error.message : error);
        return null;
      }).finally(() => copying.delete(key));
      copying.set(key, pending);
    }
    const copied = await pending;
    if (!copied) return notFound();
    until = copied;
  }
  const info = await stat(join(folder, name));
  const response = await sendFile(request, join(folder, name), { name, size: info.size, type: typeOf(name), etag: `${token}-${info.size}`, shared: true });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}
