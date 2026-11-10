import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { ensureTitle, saveProgress, stillWatching, watch, watchDb } from "@/lib/watch";

/** Where playback is: `{ titleId, season, episode, position, duration }` in seconds; films send season and episode 0. */
export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as Record<string, unknown>;
  return watch(async (cfg) => {
    const title = await ensureTitle(cfg, String(body.titleId ?? ""));
    const season = title.kind === "series" ? Number(body.season) || 0 : 0;
    const episode = title.kind === "series" ? Number(body.episode) || 0 : 0;
    saveProgress(watchDb(), user.username, { titleId: title.id, season, episode, position: Number(body.position), duration: Number(body.duration) });
    stillWatching(user.username, title.id, season, episode);
    return apiJson({ ok: true });
  });
}
