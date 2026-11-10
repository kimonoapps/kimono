import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, linkSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "../state";
import type { Attachment } from "./events";

/*
 * The files a kept chat in the feedback bank names (what was attached, what
 * Kimono AI sent), kept beside it so an administrator can open them as they
 * were, even once the chat or the file is gone. Linked, not copied, where the
 * disk allows, so keeping one costs nothing. A kept file's path is
 * /kept/<id>/<stored>; one entry's files share an id.
 */

const root = join(stateDir, "code", "feedback-files");
const attachments = (workspaceId: string) => join(stateDir, "code", "attachments", workspaceId);
const stored = /^\/attachments\/([^/]+)$/;
const kept = /^\/kept\/([0-9a-f-]{36})\/([^/]+)$/;

/** A keeper for one entry: each file it's given is kept and comes back with its kept path, or null if the chat no longer has it. */
export function keeper(workspaceId: string) {
  const id = randomUUID();
  let made = false;
  return (file: Attachment): Attachment | null => {
    const name = stored.exec(file.path)?.[1];
    const from = name ? join(attachments(workspaceId), name) : "";
    if (!name || !existsSync(from)) return null;
    if (!made) { mkdirSync(join(root, id), { recursive: true, mode: 0o700 }); made = true; }
    const to = join(root, id, name);
    try { linkSync(from, to); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return { ...file, path: `/kept/${id}/${name}` };
      try { copyFileSync(from, to); } catch { return null; }
    }
    return { ...file, path: `/kept/${id}/${name}` };
  };
}

/** Where a kept file is on disk, from its id and stored name, or null if those aren't a kept file's. */
export function keptFilePath(id: string, name: string): string | null {
  const found = kept.exec(`/kept/${id}/${name}`);
  if (!found || name.startsWith(".") || name.includes("\\")) return null;
  return join(root, found[1], found[2]);
}

/** Forgets the kept files of the entries whose files are [files]. */
export function forgetKept(files: Attachment[]) {
  const ids = new Set(files.flatMap((f) => kept.exec(f.path)?.[1] ?? []));
  for (const id of ids) rmSync(join(root, id), { recursive: true, force: true });
}
