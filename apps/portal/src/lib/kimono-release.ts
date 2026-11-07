import "server-only";

import { readFile, mkdir } from "node:fs/promises";
import { serialize, singleFlight, writeFileAtomic } from "./serial";
import { join } from "node:path";
import { stateDir } from "./state";

/**
 * 版 Which Kimono this is, and whether a newer one has been released.
 *
 * The release workflow bakes the tag into the Portal image (KIMONO_VERSION).
 * Releases are the repository's GitHub releases, the same ones `kimono update`
 * downloads, so "available" here means exactly what the update would install.
 * The check is anonymous, runs at most every few hours, and failing it only
 * means no banner.
 */

const repository = process.env.KIMONO_REPOSITORY || "kimonoapps/kimono";
const checkEvery = 6 * 60 * 60 * 1000;
const retryAfterFailure = 30 * 60 * 1000;

export type Release = { version: string; url: string };
export type UpdateNotice = { current: string; latest: string; url: string };

/** "v0.6.7" → "0.6.7". Anything that isn't a plain release number is a development build. */
function plain(version: string | undefined): string | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version?.trim() || "");
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null;
}

/** This Portal's version, or null for a development build. */
export function runningVersion(): string | null {
  return plain(process.env.KIMONO_VERSION);
}

export function isNewer(candidate: string, than: string): boolean {
  const a = candidate.split(".").map(Number), b = than.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index];
  return false;
}

let checked: { at: number; ok: boolean; release: Release | null } | null = null;

/** The newest published release (drafts and pre-releases excluded), cached. */
export async function latestRelease(): Promise<Release | null> {
  if (process.env.KIMONO_UPDATE_CHECK === "off") return null;
  if (checked && Date.now() - checked.at < (checked.ok ? checkEvery : retryAfterFailure)) return checked.release;
  return askGitHub();
}

/* Everyone who asks while the answer is on its way waits for that one answer. */
const askGitHub = singleFlight(async (): Promise<Release | null> => {
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "kimono-portal" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const body = await response.json() as { tag_name?: string; html_url?: string };
    const version = plain(body.tag_name);
    const release = version && body.html_url?.startsWith("https://github.com/") ? { version, url: body.html_url } : null;
    checked = { at: Date.now(), ok: true, release };
  } catch (error) {
    console.warn("Could not check for a new Kimono release:", error instanceof Error ? error.message : error);
    checked = { at: Date.now(), ok: false, release: checked?.release ?? null };
  }
  return checked.release;
});

/* Who has said "don't show again", and for which version. Kept per person, on
   the server, so it holds on every device they use. */
const dismissedPath = join(stateDir, "update-notices.json");

async function dismissals(): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(dismissedPath, "utf8")) as { dismissed?: Record<string, string> };
    return parsed.dismissed && typeof parsed.dismissed === "object" ? parsed.dismissed : {};
  } catch {
    return {};
  }
}

/** Hides the notice for this person until a release newer than `version` comes out. */
export async function dismissUpdate(username: string, version: string) {
  const clean = plain(version);
  if (!clean) return;
  await serialize(dismissedPath, async () => {
    const next = { ...await dismissals(), [username.toLowerCase()]: clean };
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await writeFileAtomic(dismissedPath, `${JSON.stringify({ dismissed: next }, null, 2)}\n`, 0o600);
  });
}

/** What the admin banner should say, or null when there's nothing to say. */
export async function updateNotice(username: string): Promise<UpdateNotice | null> {
  const current = runningVersion();
  if (!current) return null;
  const latest = await latestRelease();
  if (!latest || !isNewer(latest.version, current)) return null;
  const dismissed = (await dismissals())[username.toLowerCase()];
  if (dismissed && !isNewer(latest.version, dismissed)) return null;
  return { current, latest: latest.version, url: latest.url };
}
