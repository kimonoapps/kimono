import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { books, listShelf, noteDevice, setShelf, type ShelfState } from "@/lib/books";

export const dynamic = "force-dynamic";

const states: ShelfState[] = ["want", "reading", "read"];

/** Your shelf, most recently touched first. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  noteDevice(request, user.username);
  return books(() => apiJson({ books: listShelf(user.username) }));
}

/** `{ key, state }`: "want", "reading" or "read"; `state: null` takes it off. */
export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as { key?: unknown; state?: unknown };
  if (typeof body.key !== "string" || !body.key) return apiError(400, "Which book?");
  if (body.state !== null && !states.includes(body.state as ShelfState)) return apiError(400, "A shelf is want, reading or read.");
  noteDevice(request, user.username);
  return books(() => { setShelf(user.username, body.key as string, body.state as ShelfState | null); return apiJson({ books: listShelf(user.username) }); });
}

/** `?key=`: takes a book off your shelf. */
export async function DELETE(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key) return apiError(400, "Which book?");
  return books(() => { setShelf(user.username, key, null); return apiJson({ books: listShelf(user.username) }); });
}
