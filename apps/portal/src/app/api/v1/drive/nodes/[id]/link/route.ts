import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { portalOrigin } from "@/lib/account";
import { db, drive, linkFile, publicLinksAllowed, nodeFor, unlinkFile } from "@/lib/drive";

type Context = { params: Promise<{ id: string }> };

/** Turns on the file's public link and returns it. Anyone with it can open the file. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return drive(async () => {
    await publicLinksAllowed();
    const token = linkFile(db(), id, user.username);
    const node = nodeFor(db(), id, user.username);
    return apiJson({ token, url: `${portalOrigin()}/d/${token}/${encodeURIComponent(node.name)}` });
  });
}

/** Turns the public link off. The address stops working at once. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return drive(() => { unlinkFile(db(), id, user.username); return apiJson({ link: null }); });
}
