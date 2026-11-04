import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db, who, workspaceFor } from "@/lib/code";
import { sandbox } from "@/lib/code/node";

type Context = { params: Promise<{ id: string }> };

/** A folder in the sandbox's copy of the repository: `?path=` (empty for the top). */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const path = new URL(request.url).searchParams.get("path") || "";
  return code(user, async (config) => {
    const workspace = workspaceFor(db(), id, user.username);
    await sandbox.ensure(config, workspace, who(user));
    return apiJson(await sandbox.files(config, workspace, path));
  });
}
