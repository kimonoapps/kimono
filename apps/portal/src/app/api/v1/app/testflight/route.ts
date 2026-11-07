import { apiError, apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { requestTestflight, syncTestflightIfDue, testflightSettings } from "@/lib/testflight";
import { standing } from "./standing";

/** Where you stand with the iPhone app's TestFlight. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  const settings = await testflightSettings().catch(() => null);
  if (!settings) return apiError(404, "The iPhone app isn't set up on this Kimono yet.");
  const row = settings.statuses.find((s) => s.username.toLowerCase() === user.username.toLowerCase());
  return apiJson({ status: standing(row?.status), email: row?.email ?? null });
}

/** Asks to try the iPhone app: invites you at your Kimono email now; asking again after accepting Apple's email adds you straight away. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!(await testflightSettings().catch(() => null))) return apiError(404, "The iPhone app isn't set up on this Kimono yet.");
  /* Asking is what gets you invited; a first ask goes out at once, asking again syncs at most every ten seconds. */
  const first = await requestTestflight(user.username);
  await syncTestflightIfDue(first ? 0 : 10 * 1000);
  const row = (await testflightSettings())?.statuses.find((s) => s.username.toLowerCase() === user.username.toLowerCase());
  return apiJson({ status: standing(row?.status), email: row?.email ?? null });
}
