import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { friendly, profileOf } from "@/lib/friends";
import { portalOrigin } from "@/lib/watch";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ username: string }> };

/** Someone's profile: name, portrait and whether you're friends for anyone; bio, sections and recommendations for friends. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { username } = await params;
  return friendly(async () => apiJson(await profileOf(user.username, decodeURIComponent(username), portalOrigin(request))));
}
