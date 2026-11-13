import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { dropRecommendationOf, friendly } from "@/lib/friends";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** The sender takes it back (or off their profile); the one it was sent to puts it away. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return friendly(async () => apiJson(dropRecommendationOf(user.username, id)));
}
