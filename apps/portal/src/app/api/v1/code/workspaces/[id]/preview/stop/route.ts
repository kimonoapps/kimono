import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { code, db, pausePreview, workspaceFor } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/** Stops the app but keeps its link, to start again later. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async (config) => apiJson(await pausePreview(config, workspaceFor(db(), id, user.username))));
}
