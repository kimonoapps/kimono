/*
 * 版 Han — which version of the Kimono app a phone should be on.
 *
 * The admin publishes versions; each says whether it's required. A phone is
 * told about the newest, and must update when any version newer than its own
 * is required: a required release can't be skipped by publishing an optional
 * one after it. No file system here, so the rules can be tested on their own.
 */

export type AppPlatform = "android" | "ios";
export const appPlatforms: readonly AppPlatform[] = ["android", "ios"];

export type AppRelease = {
  platform: AppPlatform;
  /** What people read: "0.2.0". */
  version: string;
  /** What phones compare: Android's versionCode, iOS's build number. */
  build: number;
  required: boolean;
  notes: string;
  publishedAt: number;
  publishedBy: string;
  /** Android: the APK, kept beside the index. */
  file?: string;
  size?: number;
  sha256?: string;
};

export type AppUpdate = {
  available: boolean;
  required: boolean;
  version: string | null;
  build: number | null;
  notes: string;
  size: number | null;
  sha256: string | null;
};

export function updateFor(releases: AppRelease[], platform: AppPlatform, build: number): AppUpdate {
  const newer = releases.filter((r) => r.platform === platform && r.build > build).sort((a, b) => b.build - a.build);
  const latest = newer[0];
  if (!latest) return { available: false, required: false, version: null, build: null, notes: "", size: null, sha256: null };
  return {
    available: true,
    required: newer.some((r) => r.required),
    version: latest.version,
    build: latest.build,
    notes: latest.notes,
    size: latest.size ?? null,
    sha256: latest.sha256 ?? null,
  };
}

/** Checks what an admin typed before anything is stored. */
export function validRelease(input: { platform: unknown; version: unknown; build: unknown; notes: unknown }, existing: AppRelease[]): { platform: AppPlatform; version: string; build: number; notes: string } {
  if (input.platform !== "android" && input.platform !== "ios") throw new Error("Pick Android or iPhone.");
  const version = typeof input.version === "string" ? input.version.trim() : "";
  if (!/^\d+(\.\d+){0,3}([-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Write the version like 0.2.0.");
  const build = Number(input.build);
  if (!Number.isInteger(build) || build < 1 || build > 2_100_000_000) throw new Error("The build is a whole number, like 12.");
  const newest = Math.max(0, ...existing.filter((r) => r.platform === input.platform).map((r) => r.build));
  if (build <= newest) throw new Error(`The build must be newer than ${newest}, the latest published.`);
  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : "";
  return { platform: input.platform, version, build, notes };
}
