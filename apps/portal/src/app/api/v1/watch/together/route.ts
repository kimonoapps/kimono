import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { portalOrigin, watch } from "@/lib/watch";
import { createParty, partiesOf } from "@/lib/watch/together-live";

export const dynamic = "force-dynamic";

/** Watch Together (lib/watch/together.ts): the parties someone hosts, is in, or is asked to, and the household to invite. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  return watch(async () => apiJson(await partiesOf(user.username, portalOrigin(request))));
}

/** Starts a party: `{ titleId, season?, episode?, position?, client, invite?: [username] }`. Answers `{ state }`. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return watch(async (cfg) => apiJson(await createParty(cfg, user.username, (read.body ?? {}) as Record<string, unknown>), 201));
}
