import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { answerAccess, code, db, workspaceFor } from "@/lib/code";

type Context = { params: Promise<{ id: string; request: string }> };

/** The person's answer to the agent asking for some of their Drive: { choice: "file" | "chat" | "always" | "deny", file? }. */
export async function POST(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id, request: requestId } = await params;
  return code(user, async (config) => {
    const body = await request.json().catch(() => ({})) as { choice?: unknown; file?: unknown };
    const workspace = workspaceFor(db(), id, user.username);
    return apiJson(await answerAccess(config, workspace, user, requestId, body.choice, body.file));
  });
}
