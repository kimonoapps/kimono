import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { archiveWorkspace, code, codeOpen, db, shareOf, workspaceAs, forgetAttachments, removeWorkspace, renameWorkspace, setWorkspaceProject, stop, taskFolder, workspaceFor } from "@/lib/code";
import { rehome, retitle } from "@/lib/code/drive";
import { sandbox } from "@/lib/code/node";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  const share = shareOf(request);
  if (!user && !share) return unauthorized();
  const { id } = await params;
  return codeOpen(user, async () => {
    const workspace = workspaceAs(db(), id, user?.username ?? null, "read", share);
    if (workspace.access !== "owner") return apiJson(workspace);
    /* Its folder in Drive is made the first time anyone looks, so "Open in Drive" always has somewhere to go. */
    if (!workspace.drive) await taskFolder(db(), workspace).catch((error) => console.warn("Code couldn't make a Drive folder:", error instanceof Error ? error.message : error));
    return apiJson(workspaceAs(db(), id, workspace.owner, "owner"));
  });
}

/** Archives it or brings it back (`{ archived }`), renames it (`{ title }`), or puts it in a project (`{ folder: id | null }`), its Drive folder following. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return code(user, async () => {
    const body = read.body as { title?: unknown; folder?: unknown; archived?: unknown };
    if (typeof body.archived === "boolean") {
      const archived = archiveWorkspace(db(), id, user.username, body.archived);
      if (body.title === undefined && !("folder" in body)) return apiJson(archived);
    }
    if ("folder" in body) {
      const moved = setWorkspaceProject(db(), id, user.username, typeof body.folder === "string" && body.folder ? body.folder : null);
      await rehome(db(), moved).catch((error) => console.warn("Kimono AI couldn't move a chat's folder:", error instanceof Error ? error.message : error));
      if (body.title === undefined) return apiJson(moved);
    }
    const renamed = renameWorkspace(db(), id, user.username, body.title);
    await retitle(db(), renamed).catch((error) => console.warn("Kimono AI couldn't rename a chat's folder:", error instanceof Error ? error.message : error));
    return apiJson(renamed);
  }, false);
}

/** Throws the sandbox away and forgets the workspace. Its branch stays in Kimono Git. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async (config) => {
    const workspace = workspaceFor(db(), id, user.username);
    /* A turn still working ends first, so it doesn't write to a chat that's gone. */
    await stop(config, workspace).catch(() => {});
    if (config.nodeAddress && config.nodeKey) await sandbox.remove(config, workspace).catch(() => {});
    removeWorkspace(db(), id, user.username);
    await forgetAttachments(id);
    return new Response(null, { status: 204 });
  }, false);
}
