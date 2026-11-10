import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { home, portalOrigin, watch } from "@/lib/watch";

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
  return watch(async (cfg) => apiJson(await home(cfg, user.username, portalOrigin(request), shelf === "Series" || shelf === "Film" || shelf === "Anime" ? shelf : undefined, cursor)));
}
