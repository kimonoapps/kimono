import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { friendly, recommendationsFor, sendRecommendation } from "@/lib/friends";

export const dynamic = "force-dynamic";

/** `{ received, sent, profile }`: what friends recommended you (now seen), what you sent, what's on your profile. `?app=` keeps one app's. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const app = new URL(request.url).searchParams.get("app") || undefined;
  return friendly(async () => apiJson(await recommendationsFor(user.username, app)));
}

/**
 * `{ to: [usernames], app, itemId, title, subtitle?, cover?, note? }`: recommends a title to friends;
 * with no one in `to`, puts it on your profile. `app` is "watch" (a Watch title id) or "books" (the Books indexer's `source:id`).
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return friendly(async () => apiJson(await sendRecommendation(user.username, (read.body ?? {}) as Record<string, unknown>)));
}
