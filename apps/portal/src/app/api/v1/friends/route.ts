import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { changeFriend, findPeople, friendly, friendsList } from "@/lib/friends";

export const dynamic = "force-dynamic";

/**
 * 友 Kimono's friends (lib/friends): your friends, who asked you, who you asked, and how many recommendations are new.
 * `?q=<name>`: only the people that matches to ask, `{ people }` (two letters at least; never everyone).
 */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const q = new URL(request.url).searchParams.get("q");
  if (q !== null) return friendly(async () => apiJson({ people: await findPeople(user.username, q) }));
  return friendly(async () => apiJson(await friendsList(user.username)));
}

/** `{ type: "ask" | "yes" | "no" | "remove", username }`. Answers `{ state }`: "friends", "asking", "asked" or null. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return friendly(async () => apiJson(await changeFriend(user.username, (read.body ?? {}) as Record<string, unknown>)));
}
