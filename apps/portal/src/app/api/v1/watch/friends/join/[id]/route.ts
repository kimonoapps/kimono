import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { watch } from "@/lib/watch";
import { answerJoin } from "@/lib/watch/friends-live";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/** The one asked: `{ yes, partyId? }` (the party to bring them into). The asker: `{ cancel: true }`. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return watch(async () => apiJson(await answerJoin(user.username, id, (read.body ?? {}) as Record<string, unknown>)));
}
