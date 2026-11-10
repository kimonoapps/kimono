import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { portalOrigin, search, watch } from "@/lib/watch";

/** Titles matching `?q=`; with no query, what's popular. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const q = new URL(request.url).searchParams.get("q") || "";
  return watch(async (cfg) => apiJson(await search(cfg, portalOrigin(request), q)));
}
