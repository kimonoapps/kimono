import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { portalOrigin } from "@/lib/account";
import { code, db } from "@/lib/code";
import { ConnectionProblem, disconnect } from "@/lib/code/composio";

type Context = { params: Promise<{ account: string }> };

/** Disconnects one of this person's apps. */
export async function DELETE(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { account } = await params;
  return code(user, async (config) => {
    try { await disconnect(db(), config.composioKey, user.username, portalOrigin(), account); return apiJson({ ok: true }); }
    catch (error) { if (error instanceof ConnectionProblem) return apiError(error.status, error.message); throw error; }
  }, false);
}
