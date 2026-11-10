import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { prefsOf, savePrefs, watch, watchDb } from "@/lib/watch";

/** This person's playback settings: quality, languages, fillers, autoplay. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return watch(() => apiJson(prefsOf(watchDb(), user.username)));
}

/** Changes some of them; anything not sent stays as it was. */
export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return watch(() => apiJson(savePrefs(watchDb(), user.username, read.body)));
}
