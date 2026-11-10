import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { play, portalOrigin, watch } from "@/lib/watch";

/**
 * Starts playback: `{ titleId, season?, episode?, version?, device }`, device
 * being what the screen and decoders can do (see lib/watch/releases.ts). The
 * answer's url is the stream; versions lists the others to switch to.
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return watch(async (cfg) => apiJson(await play(cfg, user.username, portalOrigin(request), (read.body ?? {}) as Record<string, unknown>)));
}
