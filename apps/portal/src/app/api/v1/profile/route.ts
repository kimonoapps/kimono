import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { changePrivacy, friendly, profileOf, saveBio } from "@/lib/friends";
import { portalOrigin } from "@/lib/watch";

export const dynamic = "force-dynamic";

/** Your own profile, as friends see it. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  return friendly(async () => apiJson(await profileOf(user.username, user.username, portalOrigin(request))));
}

/**
 * `{ bio }`: a few words friends see on your profile. `{ invisible }`, `{ app, shown }` or `{ keep: "watch:listed" | "friends", shown }`:
 * what friends see of you (lib/friends changePrivacy).
 */
export async function PATCH(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as Record<string, unknown>;
  return friendly(async () => {
    if ("invisible" in body || "keep" in body || typeof body.app === "string") return apiJson(changePrivacy(user.username, body));
    return apiJson({ bio: saveBio(user.username, body.bio) });
  });
}
