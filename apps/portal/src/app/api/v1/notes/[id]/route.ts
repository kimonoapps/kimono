import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { db, DriveProblem, moveNode, renameNode, trashNode } from "@/lib/drive";
import { noteFor, noteName, notes, placeFor, saveNote, textOf } from "@/lib/notes";

type Context = { params: Promise<{ id: string }> };

/** A note and its text. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return notes(async () => {
    const { blob, ...note } = noteFor(db(), id, user.username);
    const response = apiJson({ note, text: await textOf(blob) });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}

/**
 * Saves the text: `{ text, version }`, version being the one the edit started
 * from. If someone saved first, theirs stays and yours is kept as a copy
 * beside it; the answer's `conflict` is then true and `note` is the copy.
 */
export async function PUT(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return notes(async () => apiJson(await saveNote(user.username, id, read.body as { text?: unknown; version?: unknown })));
}

/** Retitles and/or moves it: `{ title?, parent? }`, parent being a section or a notebook's top, in the same notebook. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return notes(() => {
    const body = read.body as { title?: unknown; parent?: unknown };
    if (body.title === undefined && body.parent === undefined) throw new DriveProblem("Send a new title or where to move it.");
    noteFor(db(), id, user.username, "editor");
    if (body.parent !== undefined) { placeFor(db(), String(body.parent), user.username); moveNode(db(), id, user.username, String(body.parent)); }
    if (body.title !== undefined) renameNode(db(), id, user.username, noteName(body.title));
    const { blob, ...note } = noteFor(db(), id, user.username);
    void blob;
    return apiJson(note);
  });
}

/** Moves it to the trash, where it stays for 30 days (restore with POST …/restore). */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return notes(() => { noteFor(db(), id, user.username, "editor"); trashNode(db(), id, user.username); return apiJson({ trashed: true }); });
}
