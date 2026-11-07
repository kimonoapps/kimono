import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db, removeProject, renameProject, workspacesOf } from "@/lib/code";
import { rehome } from "@/lib/code/drive";

type Context = { params: Promise<{ id: string }> };

/** Renames a project: { name }. Its chats' folders in Drive follow. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return code(user, async () => {
    const project = renameProject(db(), id, user.username, (read.body as { name?: unknown }).name);
    for (const chat of workspacesOf(db(), user.username).filter((w) => w.folder?.id === id)) await rehome(db(), chat).catch(() => {});
    return apiJson(project);
  }, false);
}

/** Removes a project; its chats stay, in no project. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async () => {
    const chats = workspacesOf(db(), user.username).filter((w) => w.folder?.id === id).map((w) => w.id);
    removeProject(db(), id, user.username);
    for (const chat of workspacesOf(db(), user.username).filter((w) => chats.includes(w.id))) await rehome(db(), chat).catch(() => {});
    return new Response(null, { status: 204 });
  }, false);
}
