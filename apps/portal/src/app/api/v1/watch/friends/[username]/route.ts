import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { portalOrigin, watch } from "@/lib/watch";
import { friendTaste } from "@/lib/watch/friends-live";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ username: string }> };

/** A friend's taste: what they loved, liked and didn't like, and their list (`sharing: false` and nothing when they keep it to themselves). */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { username } = await params;
  return watch(async () => apiJson(await friendTaste(user.username, decodeURIComponent(username), portalOrigin(request))));
}
