import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { home, portalOrigin, watch } from "@/lib/watch";
import { friendsLikedRow, friendsWatchingRow } from "@/lib/watch/friends-live";

/**
 * Home's rows for this person, a page at a time: `?shelf=Series|Film|Anime`
 * narrows them, `?cursor=` (the last page's `next`) gets the next page.
 * `next` is null when there is nothing more.
 */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const params = new URL(request.url).searchParams;
  const shelf = params.get("shelf");
  const cursor = Math.max(0, Math.min(10_000, Number(params.get("cursor")) || 0));
  const narrowed = shelf === "Series" || shelf === "Film" || shelf === "Anime" ? shelf : undefined;
  return watch(async (cfg) => {
    const origin = portalOrigin(request);
    const page = await home(cfg, user.username, origin, narrowed, cursor);
    /* The first page: what friends are watching and what they liked, after Continue watching and the Top 10. */
    if (cursor === 0) {
      const ours = (await Promise.all([friendsWatchingRow(user.username, origin, narrowed), friendsLikedRow(user.username, origin, narrowed)].map((row) => row.catch(() => null))))
        .filter((row): row is NonNullable<typeof row> => row !== null);
      const after = page.rows.findIndex((r) => r.id !== "continue" && r.id !== "top");
      page.rows.splice(after < 0 ? page.rows.length : after, 0, ...ours);
    }
    return apiJson(page);
  });
}
