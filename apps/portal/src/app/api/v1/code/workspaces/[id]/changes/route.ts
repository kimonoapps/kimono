import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, readFromSandbox, db, who, workspaceAs, shareOf, requireProject } from "@/lib/code";
import { sandbox } from "@/lib/code/node";

type Context = { params: Promise<{ id: string }> };

/** Everything on the workspace's branch against the branch it started from, committed or not. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async (config) => {
    const workspace = workspaceAs(db(), id, user.username, "read", shareOf(request));
    requireProject(user, workspace);
    return apiJson(await readFromSandbox(config, workspace, who(user), () => sandbox.changes(config, workspace)));
  });
}
