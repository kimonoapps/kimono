import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { createFolder, db } from "@/lib/drive";
import { defaultNotebook, notes, placeFor } from "@/lib/notes";

/** A new section: `{ name, parent? }`, inside a notebook's top or another section; their first notebook if none. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return notes(() => {
    const body = read.body as { name?: unknown; parent?: unknown };
    const parent = typeof body.parent === "string" && body.parent ? body.parent : defaultNotebook(db(), user.username).id;
    const { notebookId } = placeFor(db(), parent, user.username);
    const folder = createFolder(db(), parent, user.username, body.name);
    return apiJson({ id: folder.id, notebookId, parentId: folder.parentId, name: folder.name, updatedAt: folder.updatedAt }, 201);
  });
}
