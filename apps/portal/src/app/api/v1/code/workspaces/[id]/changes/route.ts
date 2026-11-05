import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, ensure, db, who, workspaceFor, requireProject } from "@/lib/code";
import { sandbox } from "@/lib/code/node";

type Context = { params: Promise<{ id: string }> };

/** Everything on the workspace's branch against the branch it started from, committed or not. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async (config) => {
    const workspace = workspaceFor(db(), id, user.username);
    requireProject(user, workspace);
    await ensure(config, workspace, who(user));
    return apiJson(await sandbox.changes(config, workspace));
  });
}
