import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stateDir } from "./state";
import { runningVersion } from "./kimono-release";
import type { AppPlatform, AppRelease } from "./app-updates";

/*
 * The Kimono phone app as each Kimono release ships it: the release workflow
 * builds both apps (or, when they haven't changed, offers the last builds
 * again), attaches the Android package and a note of each build to the
 * GitHub release, and sends the iPhone build to TestFlight. The Portal
 * offers the builds that came with the version it runs; the only thing left
 * to an admin is whether phones must install them before carrying on.
 */

const directory = join(stateDir, "app-releases");
const indexPath = join(directory, "releases.json");
/** The biggest package the Portal takes. */
export const maxPackageBytes = 400 * 1024 * 1024;
/** Where iPhones update: TestFlight. */
export const iosLink = "itms-beta://";

/** What's kept: which release builds an admin has made required, by `platform:build`. */
type Index = { required: Record<string, boolean> };

async function readIndex(): Promise<Index> {
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as Partial<Index>;
    return { required: parsed.required && typeof parsed.required === "object" ? parsed.required : {} };
  } catch {
    return { required: {} };
  }
}

const key = (platform: AppPlatform, build: number) => `${platform}:${build}`;

/** The builds that came with this Kimono's release, as phones are offered them. */
export async function readReleases(): Promise<{ releases: AppRelease[]; iosLink: string }> {
  const [index, ...found] = await Promise.all([readIndex(), releasedBuild("android"), releasedBuild("ios")]);
  const releases = found.filter((r): r is Released => r !== null).map((r) => ({ ...r, required: index.required[key(r.platform, r.build)] ?? false }));
  return { releases, iosLink };
}

/*
 * Each platform's note on the GitHub release (kimono-android.json, with the
 * package beside it; kimono-ios.json once TestFlight has the build). Looked
 * up now and then; not finding one only means nothing is offered.
 */
const repository = process.env.KIMONO_REPOSITORY || "kimonoapps/kimono";
type Released = AppRelease & { source?: string };
const lookedUp = new Map<AppPlatform, { at: number; version: string; release: Released | null }>();

async function releasedBuild(platform: AppPlatform): Promise<Released | null> {
  const version = runningVersion();
  if (!version || process.env.KIMONO_UPDATE_CHECK === "off") return null;
  const last = lookedUp.get(platform);
  if (last && last.version === version && Date.now() - last.at < (last.release ? 6 : .5) * 60 * 60 * 1000) return last.release;
  let release: Released | null = null;
  try {
    const base = `https://github.com/${repository}/releases/download/v${version}`;
    const response = await fetch(`${base}/kimono-${platform}.json`, { headers: { "User-Agent": "kimono-portal" }, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const about = await response.json() as { version?: unknown; build?: unknown; file?: unknown; size?: unknown; sha256?: unknown };
      /* A release that left the phone app alone offers the earlier build again, under its own version. */
      const appVersion = typeof about.version === "string" && /^\d+\.\d+\.\d+$/.test(about.version) ? about.version : null;
      const common = { version: appVersion ?? version, build: about.build as number, required: false, notes: "", publishedAt: 0, publishedBy: "kimono" };
      if (!appVersion || !Number.isInteger(about.build)) release = null;
      else if (platform === "ios") release = { platform, ...common };
      else if (typeof about.file === "string" && /^[\w.-]+\.apk$/.test(about.file) && typeof about.sha256 === "string" && /^[0-9a-f]{64}$/.test(about.sha256)) {
        release = {
          platform, ...common,
          size: typeof about.size === "number" ? about.size : undefined, sha256: about.sha256, file: `kimono-${about.build}.apk`,
          source: `${base}/${about.file}`,
        };
      }
    }
  } catch (error) {
    console.warn(`Could not look up this release's ${platform} app:`, error instanceof Error ? error.message : error);
  }
  lookedUp.set(platform, { at: Date.now(), version, release });
  return release;
}

async function write(index: Index) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${indexPath}.${randomUUID()}.new`;
  await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, indexPath);
}

/** Whether phones on an older build must install this one before carrying on. */
export async function setRequired(platform: AppPlatform, build: number, required: boolean) {
  if (!(await readReleases()).releases.some((r) => r.platform === platform && r.build === build)) throw new Error("That version isn't out.");
  const index = await readIndex();
  index.required[key(platform, build)] = required;
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
