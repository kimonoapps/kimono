import "server-only";

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stateDir } from "../state";
import { apiError } from "../api-v1";
import { DriveProblem, emptyOldTrash, migrate, staleUploads } from "./model";
import { driveRoot, removeBlob, removePart } from "./storage";

export * from "./model";
export { blobPath, sendFile, typeOf } from "./storage";

export const root = driveRoot(stateDir);
/** The largest single file. Cloudflare and phones are both happier below this. */
export const maxFileBytes = Number(process.env.KIMONO_DRIVE_MAX_FILE_BYTES) || 4 * 1024 ** 3;

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

/* At most hourly, on use: empty trash older than 30 days and drop abandoned uploads. */
function sweep(database: DatabaseSync) {
  if (cache.kimonoDriveSwept && Date.now() - cache.kimonoDriveSwept < 60 * 60 * 1000) return;
  cache.kimonoDriveSwept = Date.now();
  try {
    for (const blob of emptyOldTrash(database)) void removeBlob(root, blob);
    for (const upload of staleUploads(database)) void removePart(root, upload);
  } catch (error) {
    console.warn("Drive housekeeping failed:", error instanceof Error ? error.message : error);
  }
}

/** Runs a Drive action, turning its refusals into the JSON errors /api/v1 answers with. */
export async function drive(work: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DriveProblem) return apiError(error.status, error.message);
    console.warn("Drive request failed:", error instanceof Error ? error.message : error);
    return apiError(500, "Drive couldn't do that. Try again in a moment.");
  }
}
