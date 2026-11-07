import "server-only";

import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { apiError } from "../api-v1";
import { getPlatformSettings } from "../settings";
import { blobPath, db, DriveProblem, endUpload, finishUpload, largestFile, newId, nodeFor, root, startReplace, startUpload, type DriveNode } from "../drive";
import { removeBlob } from "../drive/storage";
import { notesConfig } from "./config";
import { excerptOf, libraryOf, maxNoteBytes, noteFrom, noteName, ownNotebook, placeFor, type NoteMeta } from "./model";

export * from "./model";

/** Runs a Notes action, turning refusals into the JSON errors /api/v1 answers with. */
export async function notes(work: () => Promise<Response> | Response): Promise<Response> {
  try {
    if (!notesConfig(await getPlatformSettings()).enabled) return apiError(404, "Notes isn't switched on.");
    return await work();
  } catch (error) {
    if (error instanceof DriveProblem) return apiError(error.status, error.message);
    console.warn("Notes request failed:", error instanceof Error ? error.message : error);
    return apiError(500, "Notes couldn't do that. Try again in a moment.");
  }
}

/** A note's whole text. */
export async function textOf(blob: string | null): Promise<string> {
  if (!blob) return "";
  return readFile(blobPath(root, blob), "utf8").catch(() => "");
}

/* The start of a note is enough for its excerpt. */
async function headOf(blob: string | null, bytes = 2048): Promise<string> {
  if (!blob) return "";
  const file = await open(blobPath(root, blob)).catch(() => null);
  if (!file) return "";
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await file.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").replace(/�$/, "");
  } finally { await file.close(); }
}

export type NoteListing = NoteMeta & { excerpt: string };

/** Notebooks, sections and notes, each note with a line of its text. */
export async function library(username: string) {
  const { notebooks, sections, notes: found } = libraryOf(db(), username);
  const notes: NoteListing[] = await Promise.all(found.map(async ({ blob, ...note }) => ({ ...note, excerpt: excerptOf(await headOf(blob)) })));
  return { notebooks, sections, notes };
}

function bytesOf(raw: unknown): Buffer {
  if (raw === undefined) return Buffer.alloc(0);
  if (typeof raw !== "string") throw new DriveProblem("Send the note's text.");
  const bytes = Buffer.from(raw.replace(/\r\n?/g, "\n"), "utf8");
  if (bytes.length > maxNoteBytes) throw new DriveProblem("That note is too long.", 413);
  return bytes;
}

async function putBlob(bytes: Buffer): Promise<string> {
  const blob = newId();
  const path = blobPath(root, blob);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { mode: 0o600 });
  return blob;
}

/* A note's bytes go through Drive's own upload bookkeeping, so its rules and its change log apply as to any file. */
async function land(upload: ReturnType<typeof startUpload>, bytes: Buffer) {
  let blob: string | null = null;
  try {
    blob = await putBlob(bytes);
    return finishUpload(db(), upload, blob);
  } catch (error) {
    endUpload(db(), upload.id);
    if (blob) await rm(blobPath(root, blob), { force: true });
    throw error;
  }
}

/** A new note in a notebook or section (the person's own notebook if none is named). */
export async function createNote(username: string, input: { parent?: unknown; title?: unknown; text?: unknown }): Promise<NoteMeta> {
  const parentId = typeof input.parent === "string" && input.parent ? input.parent : ownNotebook(db(), username).rootId;
  placeFor(db(), parentId, username);
  const bytes = bytesOf(input.text);
  const upload = startUpload(db(), parentId, username, { name: noteName(input.title), size: bytes.length, mime: "text/markdown" }, await largestFile());
  const { node } = await land(upload, bytes);
  return asNote(node);
}

/**
 * Saves a note's text over the version it was edited from. If someone else
 * saved first, theirs stays and this one is kept beside it, as Drive does
 * for any file ("… (edited elsewhere).md"), and `conflict` says so.
 */
export async function saveNote(username: string, id: string, input: { text?: unknown; version?: unknown }): Promise<{ note: NoteMeta; conflict: boolean }> {
  const note = noteFrom(db(), nodeFor(db(), id, username, "editor"));
  const version = Number(input.version);
  const bytes = bytesOf(input.text);
  const upload = startReplace(db(), note.id, username, Number.isSafeInteger(version) ? version : 0, { size: bytes.length, mime: "text/markdown" }, await largestFile());
  const { node, conflict, oldBlob } = await land(upload, bytes);
  if (oldBlob) void removeBlob(root, oldBlob);
  return { note: asNote(node), conflict };
}

const asNote = (node: DriveNode): NoteMeta => {
  const { blob, ...note } = noteFrom(db(), { ...node, blob: null });
  void blob;
  return note;
};
