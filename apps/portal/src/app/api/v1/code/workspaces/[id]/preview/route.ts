import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db, previewStatus, renamePreview, stopPreview, workspaceFor, workspaceAs, shareOf } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/** How the app is doing: `{ health: { state, restarts, exit? }, log }`. Asking doesn't wake a sleeping sandbox. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async (config) => apiJson(await previewStatus(config, workspaceAs(db(), id, user.username, "read", shareOf(request)))));
}

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
