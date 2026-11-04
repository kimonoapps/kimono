import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { db, drive, renameSpace, spaceFor } from "@/lib/drive";

type Context = { params: Promise<{ id: string }> };

/** A space and its members. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return drive(() => apiJson(spaceFor(db(), id, user.username)));
}

/** Renames a space or changes its crest: `{ name?, crest? }`. Owners only. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return drive(() => {
    renameSpace(db(), id, user.username, read.body as { name?: unknown; crest?: unknown });
    return apiJson(spaceFor(db(), id, user.username));
  });
}
