import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { books, setRating, shelfStateOf, type Rating } from "@/lib/books";

export const dynamic = "force-dynamic";

const ratings: Rating[] = ["down", "up", "love"];

/** `{ key, rating }`: "down" (not for me), "up" (liked it), "love" (loved it), or null to take it back. */
export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as { key?: unknown; rating?: unknown };
  if (typeof body.key !== "string" || !body.key) return apiError(400, "Which book?");
  if (body.rating !== null && !ratings.includes(body.rating as Rating)) return apiError(400, "A rating is down, up or love.");
  return books(() => { setRating(user.username, body.key as string, body.rating as Rating | null); return apiJson({ shelf: shelfStateOf(user.username, body.key as string) }); });
}
