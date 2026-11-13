import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { watch } from "@/lib/watch";
import { askToJoin, asksOf } from "@/lib/watch/friends-live";

export const dynamic = "force-dynamic";

/** Asks to join: `{ incoming, outgoing }`, those to this person still waiting and their own (with each answer). */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return watch(async () => apiJson(await asksOf(user.username)));
}

/** `{ to }`: asks a friend who's watching whether you can join. Answers `{ ask }`. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return watch(async (cfg) => apiJson(await askToJoin(cfg, user.username, (read.body ?? {}) as Record<string, unknown>), 201));
}
