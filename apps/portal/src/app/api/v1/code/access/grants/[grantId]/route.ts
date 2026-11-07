import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { code, db, workspaceFor } from "@/lib/code";
import { closeRevoked, revokeGrant } from "@/lib/code/access";

type Context = { params: Promise<{ grantId: string }> };

/** Takes back an always permission; chats lose those files at their next step. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { grantId } = await params;
  return code(user, async (config) => {
    revokeGrant(db(), user.username, grantId);
    closeRevoked(db(), config, user.username, (id) => { try { return workspaceFor(db(), id, user.username); } catch { return null; } });
    return apiJson({ ok: true });
  }, false);
}
