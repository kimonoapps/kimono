import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { friendsOn, friendsRated } from "@/lib/watch/friends-live";
import { recommendedToUser } from "@/lib/friends";
import { ensureTitle, portalOrigin, setListed, setRating, setReminder, setShowLayout, setTracks, titleView, watch, watchDb, WatchProblem, type Rating } from "@/lib/watch";

type Context = { params: Promise<{ id: string }> };

/** A title page: the title, where this person is in it, and a season's episodes (`?season=`, else the one they're on). */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const season = Number(new URL(request.url).searchParams.get("season")) || undefined;
  return watch(async (cfg) => {
    const origin = portalOrigin(request);
    const page = await titleView(cfg, user.username, origin, id, season);
    /* Friends' places in it: a missing one is only less to show. */
    const friends = await friendsOn(user.username, page.title.id, origin).catch(() => []);
    /* What friends thought of it: loved, liked, didn't like, or on their list. */
    const friendRatings = await friendsRated(user.username, page.title.id).catch(() => []);
    /* Friends who recommended it to this person, with their notes. */
    const recommendedBy = await recommendedToUser(user.username, "watch", page.title.id).catch(() => []);
    return apiJson({ ...page, friends, friendRatings, recommendedBy });
  });
}

/** This person's marks on it: `{ inList?, rating?, reminding? }`. */
export async function PUT(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  const body = (read.body ?? {}) as { inList?: unknown; rating?: unknown; reminding?: unknown; tracks?: unknown; episodes?: unknown };
  return watch(async (cfg) => {
    await ensureTitle(cfg, id);
    const db = watchDb();
    if (typeof body.inList === "boolean") setListed(db, user.username, id, body.inList);
    if (typeof body.reminding === "boolean") setReminder(db, user.username, id, body.reminding);
    /* What they switched to in the player, `{ audio, subtitles }` (a language, "signs" or "off"), kept for the show; null forgets it. */
    if (body.tracks !== undefined) setTracks(db, user.username, id, body.tracks);
    /* This show's episodes by season or as one list, over the anime default; null goes back to the default. */
    if (body.episodes !== undefined) setShowLayout(db, user.username, id, body.episodes);
    if (body.rating !== undefined) {
      if (body.rating !== null && typeof body.rating !== "string") throw new WatchProblem("Rate it down, up or love.");
      setRating(db, user.username, id, body.rating as Rating | null);
    }
    const season = Number(new URL(request.url).searchParams.get("season")) || undefined;
    return apiJson(await titleView(cfg, user.username, portalOrigin(request), id, season));
  });
}
