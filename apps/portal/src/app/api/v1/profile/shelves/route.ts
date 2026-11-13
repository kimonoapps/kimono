import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { addToShelf, friendly, removeFromShelf } from "@/lib/friends";

export const dynamic = "force-dynamic";

/** `{ shelf, app, itemId, title, subtitle?, cover? }`: puts a title on one of your profile's shelves (Books: "reading", "favourites"). */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as Record<string, unknown>;
  return friendly(async () => apiJson({ item: addToShelf(user.username, String(body.shelf ?? ""), body) }));
}

/** `{ shelf, app, itemId }`: takes it off. */
export async function DELETE(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as Record<string, unknown>;
  return friendly(async () => { removeFromShelf(user.username, String(body.app ?? ""), String(body.shelf ?? ""), String(body.itemId ?? "")); return apiJson({ ok: true }); });
}
