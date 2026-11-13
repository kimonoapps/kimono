import { apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { code, db, shareOf, warm, workspaceAs } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/** The person started writing in this chat: its sandbox wakes now, before the message needs it. Answers at once. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, (config) => {
    warm(config, workspaceAs(db(), id, user.username, "edit", shareOf(request)), user);
    return new Response(null, { status: 204 });
  });
}
