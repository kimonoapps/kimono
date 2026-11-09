import "server-only";

import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listAccounts, syncAccountsFromIdentity } from "../directory";
import { blobPath, db, newId, root } from "../drive";
import { stateDir } from "../state";
import { importOutline, type OutlineDump } from "./outline-import";

/** Where `kimono server import-outline` leaves Outline's notes for the Portal. */
export const outlineDumpPath = join(stateDir, "imports", "outline.json");
const resultPath = join(stateDir, "imports", "outline.result.json");

/**
 * At boot: if Outline's notes are waiting, brings them into Notes, says how it
 * went in outline.result.json (which the CLI prints), and sets the file aside.
 */
export async function importOutlineIfWaiting() {
  const raw = await readFile(outlineDumpPath, "utf8").catch(() => null);
  if (raw === null) return;
  try {
    const dump = JSON.parse(raw) as OutlineDump;
    await syncAccountsFromIdentity().catch(() => null);
    const accounts = await listAccounts();
    const database = db();
    const putBlob = (bytes: Buffer) => {
      const blob = newId();
      const path = blobPath(root, blob);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, bytes, { mode: 0o600 });
      return blob;
    };
    database.exec("BEGIN");
    let summary;
    try {
      summary = importOutline(database, dump, accounts, putBlob);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    await writeFile(resultPath, JSON.stringify({ ok: true, at: new Date().toISOString(), ...summary }, null, 2), { mode: 0o600 });
    await rename(outlineDumpPath, join(stateDir, "imports", `outline.imported-${Date.now()}.json`));
    console.log(`kimono: brought ${summary.notes} notes over from Outline in ${summary.notebooks} notebooks (${summary.alreadyImported} already here)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("kimono: the Outline import failed:", message);
    await writeFile(resultPath, JSON.stringify({ ok: false, at: new Date().toISOString(), error: message }, null, 2), { mode: 0o600 }).catch(() => {});
    await rename(outlineDumpPath, join(stateDir, "imports", `outline.failed-${Date.now()}.json`)).catch(() => {});
  }
}
