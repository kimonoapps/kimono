import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { friendly, profileOf, saveBio } from "@/lib/friends";
import { portalOrigin } from "@/lib/watch";

export const dynamic = "force-dynamic";

/** Your own profile, as friends see it. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  return friendly(async () => apiJson(await profileOf(user.username, user.username, portalOrigin(request))));
}

/** `{ bio }`: a few words friends see on your profile. */
export async function PATCH(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as Record<string, unknown>;
  return friendly(async () => apiJson({ bio: saveBio(user.username, body.bio) }));
}
