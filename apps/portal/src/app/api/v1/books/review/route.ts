import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { books, REVIEW_MAX, setReview, shelfStateOf } from "@/lib/books";

export const dynamic = "force-dynamic";

/** `{ key, review }`: what you thought of a book in your own words, or null (or blank) to take it back. Your friends see it. */
export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as { key?: unknown; review?: unknown };
  if (typeof body.key !== "string" || !body.key) return apiError(400, "Which book?");
  if (body.review !== null && typeof body.review !== "string") return apiError(400, "A review is text.");
  if (typeof body.review === "string" && body.review.length > REVIEW_MAX * 2) return apiError(413, "That review is too long.");
  return books(() => { setReview(user.username, body.key as string, body.review as string | null); return apiJson({ shelf: shelfStateOf(user.username, body.key as string) }); });
}
