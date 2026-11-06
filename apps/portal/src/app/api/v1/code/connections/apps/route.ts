import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { portalOrigin } from "@/lib/account";
import { code, db } from "@/lib/code";
import { ConnectionProblem, findApps } from "@/lib/code/composio";

/** Apps this person could connect, by name (?q=), a page at a time (?cursor= from the last page's `next`). */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const params = new URL(request.url).searchParams;
  const search = params.get("q") ?? "";
  return code(user, async (config) => {
    try { return apiJson(await findApps(db(), config.composioKey, user.username, portalOrigin(), search, params.get("cursor"))); }
    catch (error) { if (error instanceof ConnectionProblem) return apiError(error.status, error.message); throw error; }
  }, false);
}
