import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { changesFor, db, drive, latestChange } from "@/lib/drive";

/**
 * What changed since `?since=<cursor>`, for keeping a copy on a device in
 * step: the Files app on iPhone and Android, and the Kimono apps' cache.
 *
 * Without `since`, answers only `{ cursor }`: where the log ends now, for a
 * device that is about to list everything. Then ask with since=<cursor>.
 * `changed` holds nodes as they are now, `removed` the ids the person can no
 * longer see (their children go with them), and `more` says to ask again
 * straight away. A 410 means the cursor is older than the log: list
 * everything again.
 */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const asked = new URL(request.url).searchParams.get("since");
  if (asked === null) return drive(() => apiJson({ cursor: latestChange(db()) }));
  const since = Number(asked);
  return drive(() => {
    const response = apiJson(changesFor(db(), user.username, since));
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
