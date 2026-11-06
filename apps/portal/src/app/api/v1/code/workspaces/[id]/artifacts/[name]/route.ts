import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { codeOpen, db, shareOf, workspaceAs } from "@/lib/code";
import { artifactOf } from "@/lib/code/artifacts";
import { CodeProblem } from "@/lib/code/model";

type Context = { params: Promise<{ id: string; name: string }> };

/** The latest version of one of a chat's artifacts: { name, title, content, version }. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  const share = shareOf(request);
  if (!user && !share) return unauthorized();
  const { id, name } = await params;
  return codeOpen(user, () => {
    const workspace = workspaceAs(db(), id, user?.username ?? null, "read", share);
    const found = artifactOf(db(), workspace.id, name.toLowerCase());
    if (!found) throw new CodeProblem("That artifact isn't here.", 404);
    return apiJson(found);
  });
}
