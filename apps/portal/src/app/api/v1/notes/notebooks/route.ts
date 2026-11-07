import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { db } from "@/lib/drive";
import { createNotebook, notes } from "@/lib/notes";

/** A new notebook: `{ name, space? }`, in that Drive space (by id) or your own. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return notes(() => apiJson(createNotebook(db(), user.username, read.body as { name?: unknown; space?: unknown }), 201));
}
