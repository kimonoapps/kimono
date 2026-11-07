import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { myAppsDefault } from "./app-categories";
import { stateDir } from "./state";

/* Everyone's "My apps", by username, in one small file beside the settings. */
const path = join(stateDir, "my-apps.json");

async function readAll(): Promise<Record<string, string[]>> {
  try {
    const saved = JSON.parse(await readFile(path, "utf8"));
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

/** This person's apps in their order; the defaults until they change it. */
export async function myApps(username: string): Promise<string[]> {
  const saved = (await readAll())[username.toLowerCase()];
  return Array.isArray(saved) ? saved : myAppsDefault;
}

let writing = Promise.resolve();
export function setMyApps(username: string, ids: string[]) {
  writing = writing.catch(() => {}).then(async () => {
    const all = await readAll();
    all[username.toLowerCase()] = ids;
    await mkdir(stateDir, { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(all, null, 2), { mode: 0o600 });
    await rename(temporary, path);
  });
  return writing;
}
