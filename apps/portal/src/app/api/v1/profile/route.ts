import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { friendly, profileOf, saveBio, showApp } from "@/lib/friends";
import { portalOrigin } from "@/lib/watch";

export const dynamic = "force-dynamic";

/** Your own profile, as friends see it. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  return friendly(async () => apiJson(await profileOf(user.username, user.username, portalOrigin(request))));
}

/** `{ bio }`: a few words friends see on your profile. `{ app, shown }`: shows or keeps that app's activity off it. */
export async function PATCH(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as Record<string, unknown>;
  return friendly(async () => {
    if (typeof body.app === "string") return apiJson({ hidden: showApp(user.username, body.app, body.shown !== false) });
    return apiJson({ bio: saveBio(user.username, body.bio) });
  });
}
