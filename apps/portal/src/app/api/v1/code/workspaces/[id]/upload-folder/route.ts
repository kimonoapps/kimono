import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { code, db, shareOf, uploadFolder, workspaceAs } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/**
 * The chat's Drive folder, `{ folder }`, for a file over 20 MB: upload it
 * there with Drive's resumable uploads, then attach it through from-drive.
 */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async () => apiJson({ folder: await uploadFolder(db(), workspaceAs(db(), id, user.username, "edit", shareOf(request)), user.username) }));
}
