import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db, sandboxStatus, workspaceFor } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/** What the task's sandbox may use: `{ limits, disk }`. Asking doesn't wake it. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async (config) => apiJson(await sandboxStatus(config, workspaceFor(db(), id, user.username))));
}
