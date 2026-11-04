import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db, forgetAttachments, removeWorkspace, renameWorkspace, workspaceFor } from "@/lib/code";
import { sandbox } from "@/lib/code/node";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, () => apiJson(workspaceFor(db(), id, user.username)), false);
}

/** Renames it: `{ title }`. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return code(user, () => apiJson(renameWorkspace(db(), id, user.username, (read.body as { title?: unknown }).title)), false);
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
    if (config.nodeAddress && config.nodeKey) await sandbox.remove(config, workspace).catch(() => {});
    removeWorkspace(db(), id, user.username);
    await forgetAttachments(id);
    return new Response(null, { status: 204 });
  }, false);
}
