import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { portalOrigin } from "@/lib/account";
import { code, db } from "@/lib/code";
import { ConnectionProblem, findApps } from "@/lib/code/composio";

/** Apps this person could connect, by name (?q=). */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const search = new URL(request.url).searchParams.get("q") ?? "";
  return code(user, async (config) => {
    try { return apiJson({ apps: await findApps(db(), config.composioKey, user.username, portalOrigin(), search) }); }
    catch (error) { if (error instanceof ConnectionProblem) return apiError(error.status, error.message); throw error; }
  }, false);
}
