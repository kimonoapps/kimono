import { apiUser, unauthorized } from "@/lib/api-v1";
import { code, db, requireProject, workspaceFor } from "@/lib/code";
import { repositoryPage } from "@/lib/code/forgejo";

type Context = { params: Promise<{ id: string }> };

/** Opens the project in Kimono Git: on the chat's branch once it's pushed, the repository's home before. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async (config) => {
    const workspace = workspaceFor(db(), id, user.username);
    requireProject(user, workspace);
    return Response.redirect(await repositoryPage(config, workspace.repo.owner, workspace.repo.name, workspace.branch), 302);
  });
}
