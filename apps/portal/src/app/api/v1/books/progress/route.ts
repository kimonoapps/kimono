import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { books, noteDevice, setProgress } from "@/lib/books";

export const dynamic = "force-dynamic";

/** `{ key | isbn, fraction }` from 0 to 1: you're reading it, or at the end, you've read it. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as { key?: unknown; isbn?: unknown; fraction?: unknown };
  const fraction = Number(body.fraction);
  if (!Number.isFinite(fraction)) return apiError(400, "How far in? A fraction from 0 to 1.");
  const ref = { key: typeof body.key === "string" ? body.key : undefined, isbn: typeof body.isbn === "string" ? body.isbn : undefined };
  if (!ref.key && !ref.isbn) return apiError(400, "Which book? A key or an ISBN.");
  noteDevice(request, user.username);
  return books(async (config) => apiJson(await setProgress(config, user.username, ref, fraction)));
}
