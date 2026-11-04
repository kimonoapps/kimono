import "server-only";

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stateDir } from "../state";
import { getPlatformSettings } from "../settings";
import { driveConfig } from "./config";
import { apiError } from "../api-v1";
import { DriveProblem, emptyOldTrash, forgetOldChanges, migrate, staleUploads } from "./model";
import { driveRoot, removeBlob, removePart } from "./storage";

export * from "./model";
export { blobPath, sendFile, typeOf } from "./storage";

export const root = driveRoot(stateDir);
/** The largest single file: 150 GB. Drive as a whole is limited only by the disk. */
export const maxFileBytes = Number(process.env.KIMONO_DRIVE_MAX_FILE_BYTES) || 150 * 1024 ** 3;

/* One connection for the process, kept across hot reloads in development. */
const cache = globalThis as unknown as { kimonoDrive?: DatabaseSync; kimonoDriveSwept?: number };

export function db(): DatabaseSync {
  if (!cache.kimonoDrive) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const opened = new DatabaseSync(join(root, "drive.db"));
    migrate(opened);
    cache.kimonoDrive = opened;
  }
  sweep(cache.kimonoDrive);
  return cache.kimonoDrive;
}

/* At most hourly, on use: empty trash older than 30 days, drop abandoned uploads, and forget old change-log entries. */
function sweep(database: DatabaseSync) {
  if (cache.kimonoDriveSwept && Date.now() - cache.kimonoDriveSwept < 60 * 60 * 1000) return;
  cache.kimonoDriveSwept = Date.now();
  try {
    for (const blob of emptyOldTrash(database)) void removeBlob(root, blob);
    for (const upload of staleUploads(database)) void removePart(root, upload);
    forgetOldChanges(database);
  } catch (error) {
    console.warn("Drive housekeeping failed:", error instanceof Error ? error.message : error);
  }
}

/** The largest file Drive takes now: the admin's limit, within the hard one. */
export async function largestFile(): Promise<number> {
  const { largestFileBytes } = driveConfig(await getPlatformSettings());
  return largestFileBytes ? Math.min(maxFileBytes, largestFileBytes) : maxFileBytes;
}

/** Refuses when links that work without signing in are switched off. */
export async function publicLinksAllowed() {
  if (!driveConfig(await getPlatformSettings()).publicLinks) throw new DriveProblem("Public links are switched off.", 403);
}

/** Whether Drive is switched on. */
export async function driveOn() {
  return driveConfig(await getPlatformSettings()).enabled;
}

/** Runs a Drive action, turning its refusals into the JSON errors /api/v1 answers with. */
export async function drive(work: () => Promise<Response> | Response): Promise<Response> {
  try {
    if (!(await driveOn())) return apiError(404, "Drive isn't switched on.");
    return await work();
  } catch (error) {
    if (error instanceof DriveProblem) return apiError(error.status, error.message);
    console.warn("Drive request failed:", error instanceof Error ? error.message : error);
    return apiError(500, "Drive couldn't do that. Try again in a moment.");
  }
}
