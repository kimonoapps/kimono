import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { portalOrigin, watch } from "@/lib/watch";
import { changeFriend, friendsPage } from "@/lib/watch/friends-live";

export const dynamic = "force-dynamic";

/** Friends (lib/watch/friends.ts): each with what they're watching now and lately; who asked, who's been asked, everyone else; asks to join. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  return watch(async () => apiJson(await friendsPage(user.username, portalOrigin(request))));
}

/** `{ type: "ask" | "yes" | "no" | "remove", username }`. Answers `{ state }`: "friends", "asking", "asked" or null. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return watch(async () => apiJson(await changeFriend(user.username, (read.body ?? {}) as Record<string, unknown>)));
}
