import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stateDir } from "./state";
import { runningVersion } from "./kimono-release";
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

/**
 * What's stored: versions published here, where iPhones update, and the
 * admin's say over the version that comes with this Kimono's release
 * (required or not, or taken down).
 */
type Index = { releases: AppRelease[]; iosLink: string; required: Record<string, boolean>; hidden: number[] };
const empty = (): Index => ({ releases: [], iosLink: "itms-beta://", required: {}, hidden: [] });

async function readIndex(): Promise<Index> {
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as Partial<Index>;
    return {
      releases: Array.isArray(parsed.releases) ? parsed.releases : [],
      iosLink: typeof parsed.iosLink === "string" && parsed.iosLink ? parsed.iosLink : "itms-beta://",
      required: parsed.required && typeof parsed.required === "object" ? parsed.required : {},
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((b): b is number => typeof b === "number") : [],
    };
  } catch {
    return empty();
  }
}

/** Every version phones may be offered: those published here, and the one built with this Kimono's release. */
export async function readReleases(): Promise<{ releases: AppRelease[]; iosLink: string }> {
  const index = await readIndex();
  const releases = [...index.releases];
  const bundled = await releasedAndroid();
  if (bundled && !index.hidden.includes(bundled.build) && !releases.some((r) => r.platform === "android" && r.build === bundled.build)) {
    releases.push({ ...bundled, required: index.required[String(bundled.build)] ?? false });
  }
  return { releases, iosLink: index.iosLink };
}

/*
 * The Android app built with this Kimono's release: the release workflow
 * attaches it to the GitHub release with kimono-android.json beside it.
 * Looked up now and then; not finding it only means nothing is offered.
 */
const repository = process.env.KIMONO_REPOSITORY || "kimonoapps/kimono";
type Released = AppRelease & { source: string };
let released: { at: number; version: string; release: Released | null } | null = null;

async function releasedAndroid(): Promise<Released | null> {
  const version = runningVersion();
  if (!version || process.env.KIMONO_UPDATE_CHECK === "off") return null;
  if (released && released.version === version && Date.now() - released.at < (released.release ? 6 : .5) * 60 * 60 * 1000) return released.release;
  let release: Released | null = null;
  try {
    const base = `https://github.com/${repository}/releases/download/v${version}`;
    const response = await fetch(`${base}/kimono-android.json`, { headers: { "User-Agent": "kimono-portal" }, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const about = await response.json() as { version?: unknown; build?: unknown; file?: unknown; size?: unknown; sha256?: unknown };
      if (about.version === version && Number.isInteger(about.build) && typeof about.file === "string" && /^[\w.-]+\.apk$/.test(about.file) && typeof about.sha256 === "string" && /^[0-9a-f]{64}$/.test(about.sha256)) {
        release = {
          platform: "android", version, build: about.build as number, required: false, notes: "", publishedAt: 0, publishedBy: "kimono",
          size: typeof about.size === "number" ? about.size : undefined, sha256: about.sha256, file: `kimono-${about.build}.apk`,
          source: `${base}/${about.file}`,
        };
      }
    }
  } catch (error) {
    console.warn("Could not look up this release's Android app:", error instanceof Error ? error.message : error);
  }
  released = { at: Date.now(), version, release };
  return release;
}

async function write(index: Index) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${indexPath}.${randomUUID()}.new`;
  await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, indexPath);
}

/** Publishes a version; an Android one brings its package. */
export async function publishRelease(input: { platform: unknown; version: unknown; build: unknown; notes: unknown; required: boolean }, by: string, apk?: Uint8Array): Promise<AppRelease> {
  const index = await readIndex();
  /* Checked against everything offered, the release's own version too. */
  const checked = validRelease(input, (await readReleases()).releases);
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
  const index = await readIndex();
  const release = index.releases.find((r) => r.platform === platform && r.build === build);
  if (release) release.required = required;
  else if (platform === "android" && (await releasedAndroid())?.build === build) index.required[String(build)] = required;
  else throw new Error("That version isn't published.");
  await write(index);
}

/** Takes a version down; phones stop being offered it. */
export async function removeRelease(platform: AppPlatform, build: number) {
  const index = await readIndex();
  const release = index.releases.find((r) => r.platform === platform && r.build === build);
  if (!release) {
    /* The release's own version can't be deleted, only kept from phones. */
    if (platform === "android" && (await releasedAndroid())?.build === build && !index.hidden.includes(build)) {
      index.hidden.push(build);
      await write(index);
      await rm(join(directory, `kimono-${build}.apk`), { force: true });
    }
    return;
  }
  index.releases = index.releases.filter((r) => r !== release);
  await write(index);
  if (release.file) await rm(join(directory, release.file), { force: true });
}

export async function setIosLink(link: string) {
  const trimmed = link.trim();
  if (!/^(https:\/\/testflight\.apple\.com\/|itms-beta:\/\/|https:\/\/apps\.apple\.com\/)/.test(trimmed)) throw new Error("Use a TestFlight or App Store link.");
  const index = await readIndex();
  index.iosLink = trimmed;
  await write(index);
}

/** An Android package's path and size, for downloading. */
export async function packageFor(build: number): Promise<{ path: string; size: number; version: string } | null> {
  const release = (await readReleases()).releases.find((r) => r.platform === "android" && r.build === build && r.file);
  if (!release?.file) return null;
  const path = join(directory, release.file);
  let info = await stat(path).catch(() => null);
  const source = (release as Partial<Released>).source;
  if (!info && source && release.sha256) {
    await fetchPackage(source, path, release.sha256);
    info = await stat(path).catch(() => null);
  }
  return info ? { path, size: info.size, version: release.version } : null;
}

/* The release's own package, fetched from GitHub the first time a phone asks, checked, and kept. One fetch at a time per package. */
const fetching = new Map<string, Promise<void>>();

function fetchPackage(source: string, path: string, sha256: string): Promise<void> {
  const running = fetching.get(path);
  if (running) return running;
  const work = (async () => {
    const response = await fetch(source, { headers: { "User-Agent": "kimono-portal" }, signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxPackageBytes) throw new Error("The package is too big.");
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("The package didn't match its checksum.");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.part`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, path);
  })().catch((error) => {
    console.warn("Could not fetch this release's Android app:", error instanceof Error ? error.message : error);
  }).finally(() => fetching.delete(path));
  fetching.set(path, work);
  return work;
}
