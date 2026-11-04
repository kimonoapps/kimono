import { withMark } from "@/lib/drive/marks";
import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { db, drive, setSpaceLink, spaceFor, type LinkAccess } from "@/lib/drive";

type Context = { params: Promise<{ id: string }> };

/** Opens the space to anyone with its link: `{ access: "view" | "add" }`. Owners only. */
export async function PUT(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return drive(() => {
    setSpaceLink(db(), id, user.username, (read.body as { access?: unknown }).access as LinkAccess);
    return apiJson(withMark(spaceFor(db(), id, user.username)));
  });
}

/** Closes the link for good. Opening it again makes a new one. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return drive(() => {
    setSpaceLink(db(), id, user.username, null);
    return apiJson(withMark(spaceFor(db(), id, user.username)));
  });
}
