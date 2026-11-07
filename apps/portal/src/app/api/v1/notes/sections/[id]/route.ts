import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { db, DriveProblem, moveNode, renameNode, trashNode } from "@/lib/drive";
import { notes, placeFor } from "@/lib/notes";

type Context = { params: Promise<{ id: string }> };

/** Renames and/or moves a section: `{ name?, parent? }`. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return notes(() => {
    const body = read.body as { name?: unknown; parent?: unknown };
    if (body.name === undefined && body.parent === undefined) throw new DriveProblem("Send a new name or where to move it.");
    placeFor(db(), id, user.username);
    if (body.parent !== undefined) { placeFor(db(), String(body.parent), user.username); moveNode(db(), id, user.username, String(body.parent)); }
    const folder = body.name !== undefined ? renameNode(db(), id, user.username, body.name) : placeFor(db(), id, user.username);
    return apiJson({ id: folder.id, notebookId: folder.spaceId, parentId: folder.parentId, name: folder.name, updatedAt: folder.updatedAt });
  });
}

/** Moves a section, and the notes in it, to the trash. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return notes(() => { placeFor(db(), id, user.username); trashNode(db(), id, user.username); return apiJson({ trashed: true }); });
}
