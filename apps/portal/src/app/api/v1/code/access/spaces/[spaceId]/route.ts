import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { code, db, workspaceFor } from "@/lib/code";
import { closeRevoked, setSpaceAuto } from "@/lib/code/access";

type Context = { params: Promise<{ spaceId: string }> };

/** Whether Kimono AI may use a whole space without asking: { need: "read" | "change" | null }. */
export async function PUT(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { spaceId } = await params;
  return code(user, async (config) => {
    const body = await (request.headers.get("content-type")?.startsWith("application/json") ? request.json() : Promise.reject(new Error("Send JSON."))).catch(() => ({})) as { need?: unknown };
    const need = body.need === "read" || body.need === "change" ? body.need : null;
    setSpaceAuto(db(), user.username, spaceId, need);
    closeRevoked(db(), config, user.username, (id) => { try { return workspaceFor(db(), id, user.username); } catch { return null; } });
    return apiJson({ ok: true });
  }, false);
}
