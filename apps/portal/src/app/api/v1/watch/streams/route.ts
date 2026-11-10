import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { endMyStreams } from "@/lib/watch";

/** Ends every stream the person has going, on every screen, so this one can start. */
export async function DELETE(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  return apiJson(endMyStreams(user.username));
}
