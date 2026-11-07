import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db } from "@/lib/code";
import { changeMemory, forget, profileOf } from "@/lib/code/memory";

type Context = { params: Promise<{ id: string }> };

/** Forgets one memory. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async () => { forget(db(), user.username, id); return apiJson(profileOf(db(), user.username)); }, false);
}

/** New words for one memory: { text, title? }. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return code(user, async () => { const body = read.body as { text?: unknown; title?: unknown }; changeMemory(db(), user.username, id, body.text, body.title); return apiJson(profileOf(db(), user.username)); }, false);
}
