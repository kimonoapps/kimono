import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { portalOrigin, watch } from "@/lib/watch";
import { changeFriend, findPeople, friendsPage } from "@/lib/watch/friends-live";

export const dynamic = "force-dynamic";

/**
 * Friends (lib/watch/friends.ts): each with what they're watching now and lately; who asked, who's been asked; asks to join.
 * `?q=<name>`: only the people that matches to ask, `{ people }` (two letters at least; never everyone).
 */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const q = new URL(request.url).searchParams.get("q");
  if (q !== null) return watch(async () => apiJson({ people: await findPeople(user.username, q) }));
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
