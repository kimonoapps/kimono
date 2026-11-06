import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db } from "@/lib/code";
import { forget, profileOf } from "@/lib/code/memory";

type Context = { params: Promise<{ id: string }> };

/** Forgets one memory. */
export async function DELETE(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async () => { forget(db(), user.username, id); return apiJson(profileOf(db(), user.username)); }, false);
}
