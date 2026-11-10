import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { health, watch } from "@/lib/watch";

/** `?titleId=&season=&episode=`: whether what's playing stalls on the server or on this connection. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const q = new URL(request.url).searchParams;
  return watch(() => apiJson(health(user.username, { titleId: q.get("titleId"), season: q.get("season"), episode: q.get("episode") })));
}
