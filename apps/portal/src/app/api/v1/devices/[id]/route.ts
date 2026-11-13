import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { listReaders, renameReader, revokeReader } from "@/lib/kimono-read";
import { readFailure } from "../errors";

type Context = { params: Promise<{ id: string }> };

/** Renames a paired reader: `{ name }`. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  try {
    renameReader(user.username, (await params).id, (read.body as { name?: unknown }).name);
    return apiJson({ devices: listReaders(user.username) });
  } catch (error) { return readFailure(error); }
}

/** Unpairs a reader: its token stops working at once. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    revokeReader(user.username, (await params).id);
    return apiJson({ devices: listReaders(user.username) });
  } catch (error) { return readFailure(error); }
}
