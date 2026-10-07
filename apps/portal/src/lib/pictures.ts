import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stateDir } from "./state";
import { sanitizePicturePng } from "./picture-png";

/**
 * Where profile pictures live.
 *
 * Each upload gets a new random file name, and that name is the address. The
 * address has to work without a Kimono session, because the identity
 * provider's own pages and the apps that sign in through it fetch the picture
 * from another site, where the Portal's cookie is not sent. A random name
 * nobody can guess, replaced on every change, gives that without a list of
 * everyone's pictures being browsable.
 */
const pictureDir = join(stateDir, "pictures");
const indexPath = join(pictureDir, "index.json");
const fileName = /^[A-Za-z0-9_-]{22}\.png$/;

type PictureIndex = Record<string, { file: string; updatedAt: string }>;

async function readIndex(): Promise<PictureIndex> {
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as { pictures?: PictureIndex };
    return parsed.pictures && typeof parsed.pictures === "object" ? parsed.pictures : {};
  } catch {
    return {};
  }
}

async function writeIndex(pictures: PictureIndex) {
  await mkdir(pictureDir, { recursive: true, mode: 0o700 });
  const temporary = `${indexPath}.new`;
  await writeFile(temporary, `${JSON.stringify({ pictures }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, indexPath);
}

/** The picture's path on this Portal, or null for someone without one. */
export async function picturePathFor(username: string): Promise<string | null> {
  const entry = (await readIndex())[username.toLowerCase()];
  return entry && fileName.test(entry.file) ? `/api/v1/pictures/${entry.file}` : null;
}

export async function picturePaths(): Promise<Record<string, string>> {
  const index = await readIndex();
  return Object.fromEntries(Object.entries(index)
    .filter(([, entry]) => fileName.test(entry.file))
    .map(([username, entry]) => [username, `/api/v1/pictures/${entry.file}`]));
}

export async function storePicture(username: string, upload: Uint8Array): Promise<string> {
  const png = sanitizePicturePng(upload);
  const key = username.toLowerCase();
  const file = `${randomBytes(16).toString("base64url")}.png`;
  await mkdir(pictureDir, { recursive: true, mode: 0o700 });
  const temporary = join(pictureDir, `${file}.new`);
  await writeFile(temporary, png, { mode: 0o600 });
  await rename(temporary, join(pictureDir, file));
  const index = await readIndex();
  const previous = index[key]?.file;
  index[key] = { file, updatedAt: new Date().toISOString() };
  await writeIndex(index);
  /* The old address stops working, so a replaced picture is really gone. */
  if (previous && previous !== file && fileName.test(previous)) await rm(join(pictureDir, previous), { force: true });
  return `/api/v1/pictures/${file}`;
}

export async function removePicture(username: string) {
  const key = username.toLowerCase();
  const index = await readIndex();
  const previous = index[key]?.file;
  if (!previous) return;
  delete index[key];
  await writeIndex(index);
  if (fileName.test(previous)) await rm(join(pictureDir, previous), { force: true });
}

export async function readPictureFile(file: string): Promise<Uint8Array | null> {
  if (!fileName.test(file)) return null;
  try {
    return new Uint8Array(await readFile(join(pictureDir, file)));
  } catch {
    return null;
  }
}
