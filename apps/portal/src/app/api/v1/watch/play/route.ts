import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { play, watch } from "@/lib/watch";

const origin = (request: Request) =>
  (process.env.KIMONO_PORTAL_URL || process.env.AUTH_URL?.replace(/\/api\/auth\/?$/, "") || new URL(request.url).origin).replace(/\/+$/, "");

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
  return watch(async (cfg) => apiJson(await play(cfg, user.username, origin(request), (read.body ?? {}) as Record<string, unknown>)));
}
