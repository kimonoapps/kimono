import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { engineFiles, engineFolders, type EngineFile } from "@kimono/artifacts/engine";

/*
 * The artifact engine (packages/artifacts), served to artifacts' frames. They
 * have no internet and no origin of their own, so Kimono serves every file
 * itself, to any origin.
 */

const cached = new Map<string, Uint8Array>();
/* From where the app runs: apps/portal, in development and in the standalone build alike. */
const engineDir = () => join(process.cwd(), "../../packages/artifacts/src/engine");

/** A file in one of the whole folders (KaTeX and its fonts), by an exact, plain name only. */
function folderEntry(name: string): EngineFile | null {
  for (const folder of engineFolders) {
    if (!name.startsWith(folder.prefix)) continue;
    const rest = name.slice(folder.prefix.length);
    const type = folder.types[rest.slice(rest.lastIndexOf("."))];
    if (!type || !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*(\.min)?\.[a-z0-9]+$/.test(rest)) return null;
    return { module: folder.module + rest, type, cache: "public, max-age=604800, immutable" };
  }
  return null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const name = (await params).path.join("/");
  const entry = engineFiles[name] ?? folderEntry(name);
  if (!entry) return new Response("Not found", { status: 404 });
  /* The kit is read again each time in development, so a change shows on the next load. */
  let body = process.env.NODE_ENV === "production" ? cached.get(name) : entry.module ? cached.get(name) : undefined;
  if (!body) {
    body = new Uint8Array(await readFile(entry.file ? join(engineDir(), entry.file) : join(process.cwd(), "node_modules", entry.module!)));
    cached.set(name, body);
  }
  return new Response(body as BodyInit, {
    headers: { "Content-Type": entry.type, "Access-Control-Allow-Origin": "*", "Cache-Control": entry.cache, "X-Content-Type-Options": "nosniff" },
  });
}
