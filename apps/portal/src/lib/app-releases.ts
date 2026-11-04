import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stateDir } from "./state";
import { validRelease, type AppPlatform, type AppRelease } from "./app-updates";

/*
 * Published versions of the Kimono phone app: an index, and the Android
 * packages beside it. iPhone versions arrive through TestFlight; here they
 * are only a build number to require and a link to send people to.
 */

const directory = join(stateDir, "app-releases");
const indexPath = join(directory, "releases.json");
/** The biggest package the Portal takes. */
export const maxPackageBytes = 400 * 1024 * 1024;

type Index = { releases: AppRelease[]; iosLink: string };
const empty: Index = { releases: [], iosLink: "itms-beta://" };

export async function readReleases(): Promise<Index> {
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as Partial<Index>;
    return { releases: Array.isArray(parsed.releases) ? parsed.releases : [], iosLink: typeof parsed.iosLink === "string" && parsed.iosLink ? parsed.iosLink : empty.iosLink };
  } catch {
    return { ...empty, releases: [] };
  }
}

async function write(index: Index) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${indexPath}.${randomUUID()}.new`;
  await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, indexPath);
}

/** Publishes a version; an Android one brings its package. */
export async function publishRelease(input: { platform: unknown; version: unknown; build: unknown; notes: unknown; required: boolean }, by: string, apk?: Uint8Array): Promise<AppRelease> {
  const index = await readReleases();
  const checked = validRelease(input, index.releases);
  const release: AppRelease = { ...checked, required: input.required, publishedAt: Date.now(), publishedBy: by };
  if (checked.platform === "android") {
    if (!apk || apk.byteLength < 4 || apk[0] !== 0x50 || apk[1] !== 0x4b) throw new Error("Choose the APK to publish.");
    if (apk.byteLength > maxPackageBytes) throw new Error("That package is too big.");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = `kimono-${checked.build}.apk`;
    const temporary = join(directory, `${file}.${randomUUID()}.part`);
    await writeFile(temporary, apk, { mode: 0o600 });
    await rename(temporary, join(directory, file));
    Object.assign(release, { file, size: apk.byteLength, sha256: createHash("sha256").update(apk).digest("hex") });
  }
  index.releases.push(release);
  await write(index);
  return release;
}

export async function setRequired(platform: AppPlatform, build: number, required: boolean) {
  const index = await readReleases();
  const release = index.releases.find((r) => r.platform === platform && r.build === build);
  if (!release) throw new Error("That version isn't published.");
  release.required = required;
  await write(index);
}

/** Takes a version down; phones stop being offered it. */
export async function removeRelease(platform: AppPlatform, build: number) {
  const index = await readReleases();
  const release = index.releases.find((r) => r.platform === platform && r.build === build);
  if (!release) return;
  index.releases = index.releases.filter((r) => r !== release);
  await write(index);
  if (release.file) await rm(join(directory, release.file), { force: true });
}

export async function setIosLink(link: string) {
  const trimmed = link.trim();
  if (!/^(https:\/\/testflight\.apple\.com\/|itms-beta:\/\/|https:\/\/apps\.apple\.com\/)/.test(trimmed)) throw new Error("Use a TestFlight or App Store link.");
  const index = await readReleases();
  index.iosLink = trimmed;
  await write(index);
}

/** An Android package's path and size, for downloading. */
export async function packageFor(build: number): Promise<{ path: string; size: number; version: string } | null> {
  const release = (await readReleases()).releases.find((r) => r.platform === "android" && r.build === build && r.file);
  if (!release?.file) return null;
  const path = join(directory, release.file);
  const info = await stat(path).catch(() => null);
  return info ? { path, size: info.size, version: release.version } : null;
}
