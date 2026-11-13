import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { noteFriendsWatch } from "@/lib/watch/friends-live";
import { ensureTitle, forgetProgress, noteShapeOf, saveProgress, stillWatching, watch, watchDb } from "@/lib/watch";

/** Where playback is: `{ titleId, season, episode, position, duration }` in seconds; films send season and episode 0. The apps add `{ stream, aspect }` once per copy: the address playing and its picture's shape. `stopped: true` on the last one, as the player closes: its screen frees at once. */
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
    stillWatching(user.username, title.id, season, episode, body.stopped === true);
    noteFriendsWatch(user.username, title.id);
    if (typeof body.stream === "string" && typeof body.aspect === "number") await noteShapeOf(user.username, body.stream, body.aspect);
    return apiJson({ ok: true });
  });
}

/** Remove from history: `?titleId=` forgets where this person got to in it, every episode (Continue watching, friends, the title page). */
export async function DELETE(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const titleId = new URL(request.url).searchParams.get("titleId") ?? "";
  return watch(async () => {
    if (!titleId) return apiJson({ error: "Say which title." }, 400);
    forgetProgress(watchDb(), user.username, titleId);
    return apiJson({ ok: true });
  });
}
