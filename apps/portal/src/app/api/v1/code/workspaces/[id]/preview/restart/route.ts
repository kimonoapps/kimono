import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { code, db, restartPreview, workspaceFor } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/** Starts the app again as the agent published it; the link stays the same. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async (config) => apiJson(await restartPreview(config, workspaceFor(db(), id, user.username))));
}
