import { apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { code, db, stop, workspaceFor } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/** Stops the agent mid-turn. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async (config) => {
    await stop(config, workspaceFor(db(), id, user.username));
    return new Response(null, { status: 204 });
  });
}
