import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db, sandboxStatus, workspaceAs, shareOf } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/** What the task's sandbox may use: `{ limits, disk }`. Asking doesn't wake it. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async (config) => apiJson(await sandboxStatus(config, workspaceAs(db(), id, user.username, "read", shareOf(request)))));
}
