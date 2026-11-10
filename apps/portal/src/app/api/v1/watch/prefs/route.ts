import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { cleanDeviceId, cleanQuality, devicePrefsOf, savePrefs, setDeviceQuality, watch, watchDb, WatchProblem } from "@/lib/watch";

/**
 * This person's playback settings: quality, languages, fillers, autoplay.
 * With `?device=<id>` the quality is that device's own when it has one, and
 * `device: { id, quality }` says whether it does (quality null: it follows
 * the person's).
 */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const device = cleanDeviceId(new URL(request.url).searchParams.get("device"));
  return watch(() => apiJson(devicePrefsOf(watchDb(), user.username, device)));
}

/**
 * Changes some of them; anything not sent stays as it was. With `device`, the
 * quality sent is that device's alone (null forgets it); the rest are the
 * person's everywhere.
 */
export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body && typeof read.body === "object" ? read.body : {}) as Record<string, unknown>;
  return watch(() => {
    const db = watchDb();
    if (body.device === undefined) return apiJson(savePrefs(db, user.username, body));
    const device = cleanDeviceId(body.device);
    if (!device) throw new WatchProblem("That isn't a device id.");
    const { device: _device, quality, ...rest } = body; // eslint-disable-line @typescript-eslint/no-unused-vars
    if (quality !== undefined) {
      const chosen = quality === null ? null : cleanQuality(quality);
      if (quality !== null && !chosen) throw new WatchProblem("Quality is auto, 2160, 1080, 720 or saver.");
      setDeviceQuality(db, user.username, device, chosen);
    }
    if (Object.keys(rest).length) savePrefs(db, user.username, rest);
    return apiJson(devicePrefsOf(db, user.username, device));
  });
}
