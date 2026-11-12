import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db, keepOneTake, shareOf, workspaceAs } from "@/lib/code";

type Context = { params: Promise<{ id: string; take: string }> };

/** The person keeps one of two takes on an answer: `{ pick: 0 | 1 }`, the first or the second. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id, take } = await params;
  return code(user, () => apiJson(keepOneTake(workspaceAs(db(), id, user.username, "edit", shareOf(request)), user, take, (read.body as { pick?: unknown }).pick)));
}
