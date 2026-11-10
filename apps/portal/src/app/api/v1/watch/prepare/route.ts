import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { prepare, watch } from "@/lib/watch";

/**
 * Gets the next episode ready: `{ titleId, season, episode, device }` for the
 * one playing, sent most of the way through it. The answer names the episode
 * that comes next (`next`) and whether something on it plays on this device
 * (`ready`); playing it then starts without a search.
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return watch(async (cfg) => apiJson(await prepare(cfg, user.username, (read.body ?? {}) as Record<string, unknown>)));
}
