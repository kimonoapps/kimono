import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { db, drive, restoreNode } from "@/lib/drive";

/** Takes something back out of the trash, to where it was. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return drive(() => apiJson(restoreNode(db(), id, user.username)));
}
