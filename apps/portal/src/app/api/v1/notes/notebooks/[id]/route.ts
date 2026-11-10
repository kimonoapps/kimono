import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { db, DriveProblem, renameNode, renameSpace, setFolderCrest, trashNode } from "@/lib/drive";
import { notebookFor, notes } from "@/lib/notes";

type Context = { params: Promise<{ id: string }> };

/**
 * Renames a notebook, `{ name }` (one that is a space of its own renames the
 * space, for its owners), or gives it its own crest, `{ crest, color }` (both
 * null for its space's again).
 */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return notes(() => {
    const book = notebookFor(db(), id, user.username, "editor");
    const { name, crest, color } = read.body as { name?: unknown; crest?: unknown; color?: unknown };
    if (name === undefined && crest === undefined) throw new DriveProblem("Send a new name or crest.");
    if (crest !== undefined) setFolderCrest(db(), id, user.username, crest, color ?? null);
    if (name !== undefined) {
      if (book.isSpace) renameSpace(db(), book.space.id, user.username, { name });
      else renameNode(db(), id, user.username, name);
    }
    return apiJson(notebookFor(db(), id, user.username));
  });
}

/** Moves a notebook and its notes to the trash. One that is a space of its own can't be: leave it instead. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return notes(() => {
    const book = notebookFor(db(), id, user.username, "editor");
    if (book.isSpace) throw new DriveProblem("This notebook is shared on its own. Leave it instead.", 409);
    trashNode(db(), id, user.username);
    return apiJson({ trashed: true });
  });
}
