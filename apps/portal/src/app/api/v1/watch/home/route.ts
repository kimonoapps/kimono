import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { home, portalOrigin, watch } from "@/lib/watch";

/** Home's rows for this person: `?shelf=Series|Film|Anime` narrows them. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const shelf = new URL(request.url).searchParams.get("shelf");
  return watch(async (cfg) => apiJson(await home(cfg, user.username, portalOrigin(request), shelf === "Series" || shelf === "Film" || shelf === "Anime" ? shelf : undefined)));
}
