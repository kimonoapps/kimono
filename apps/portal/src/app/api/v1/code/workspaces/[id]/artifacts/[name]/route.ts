import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code, db, workspaceFor } from "@/lib/code";
import { artifactOf } from "@/lib/code/artifacts";
import { CodeProblem } from "@/lib/code/model";

type Context = { params: Promise<{ id: string; name: string }> };

/** The latest version of one of a chat's artifacts: { name, title, content, version }. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id, name } = await params;
  return code(user, () => {
    const workspace = workspaceFor(db(), id, user.username);
    const found = artifactOf(db(), workspace.id, name.toLowerCase());
    if (!found) throw new CodeProblem("That artifact isn't here.", 404);
    return apiJson(found);
  }, false);
}
