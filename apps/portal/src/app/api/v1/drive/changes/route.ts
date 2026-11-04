import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { changesFor, db, drive } from "@/lib/drive";

/**
 * What changed since `?since=<cursor>`, for keeping a copy on a device in
 * step: the Files app on iPhone and Android, and the Kimono apps' cache.
 *
 * Start with since=0 (or a fresh full listing, then the cursor this gives).
 * `changed` holds nodes as they are now, `removed` the ids the person can no
 * longer see (their children go with them), and `more` says to ask again
 * straight away. A 410 means the cursor is older than the log: list
 * everything again.
 */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const since = Number(new URL(request.url).searchParams.get("since") ?? 0);
  return drive(() => {
    const response = apiJson(changesFor(db(), user.username, since));
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
