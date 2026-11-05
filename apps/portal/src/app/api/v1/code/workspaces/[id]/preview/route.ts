import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db, renamePreview, stopPreview, workspaceFor } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/** Takes the app's link down; whoever had it can no longer open it. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async (config) => {
    await stopPreview(config, workspaceFor(db(), id, user.username));
    return new Response(null, { status: 204 });
  });
}

/** Names the app's link: `{ name }` becomes https://<name>.<preview domain>. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return code(user, async (config) => apiJson(await renamePreview(config, workspaceFor(db(), id, user.username), String((read.body as { name?: unknown }).name ?? ""))));
}
