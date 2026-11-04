import { withMark } from "@/lib/drive/marks";
import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { db, drive, renameSpace, spaceFor } from "@/lib/drive";

type Context = { params: Promise<{ id: string }> };

/** A space and its members. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return drive(() => apiJson(withMark(spaceFor(db(), id, user.username))));
}

/** Renames a space or changes its crest or its colour: `{ name?, crest?, color? }`. Owners only. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return drive(() => {
    renameSpace(db(), id, user.username, read.body as { name?: unknown; crest?: unknown; color?: unknown });
    return apiJson(withMark(spaceFor(db(), id, user.username)));
  });
}
