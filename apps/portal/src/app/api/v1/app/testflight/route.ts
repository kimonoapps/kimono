import { apiError, apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { isPhoneApp, mainApp, requestTestflight, syncTestflightIfDue, testflightSettings } from "@/lib/testflight";
import { answer } from "./standing";

/** Where you stand with each iPhone app's TestFlight. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!(await testflightSettings().catch(() => null))) return apiError(404, "The iPhone app isn't set up on this Kimono yet.");
  return apiJson(await answer(user.username));
}

/**
 * Asks for one iPhone app ({ "app": bundle ID }, the Kimono app when left out).
 * Nothing is sent until an admin approves; once approved, asking again checks
 * App Store Connect, at most every ten seconds.
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!(await testflightSettings().catch(() => null))) return apiError(404, "The iPhone app isn't set up on this Kimono yet.");
  const body = await request.json().catch(() => ({})) as { app?: unknown };
  const app = body.app === undefined ? mainApp : body.app;
  if (!isPhoneApp(app)) return apiError(400, "There's no such iPhone app.");
  const state = await requestTestflight(user.username, app);
  if (state === "approved") await syncTestflightIfDue(10 * 1000);
  return apiJson(await answer(user.username));
}
