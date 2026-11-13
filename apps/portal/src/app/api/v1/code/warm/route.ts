import { apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { code, reserveNewChat } from "@/lib/code";

/** The person started writing a new chat: its sandbox is made now, before its first message needs it. Answers at once. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, (config) => {
    reserveNewChat(config, user);
    return new Response(null, { status: 204 });
  });
}
