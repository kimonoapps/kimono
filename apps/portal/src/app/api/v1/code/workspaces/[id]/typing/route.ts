import { apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { code, db, shareOf, typingIn, workspaceAs } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/** The person is typing in this chat: the others in it see so for a few seconds. Only someone who may write in it. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, () => {
    const workspace = workspaceAs(db(), id, user.username, "edit", shareOf(request));
    typingIn(workspace.id, user.username.toLowerCase());
    return new Response(null, { status: 204 });
  }, false);
}
