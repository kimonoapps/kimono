import { apiError, apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { syncTestflightIfDue, testflightSettings } from "@/lib/testflight";

/**
 * Where you stand with the iPhone app's TestFlight: POST to be invited now
 * rather than at the next hourly sync. Everyone with a Kimono account and an
 * email is invited anyway; this only saves the wait.
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!(await testflightSettings().catch(() => null))) return apiError(404, "The iPhone app isn't set up on this Kimono yet.");
  /* At most one sync a minute, however many people ask. */
  await syncTestflightIfDue(60 * 1000);
  const row = (await testflightSettings())?.statuses.find((s) => s.username.toLowerCase() === user.username.toLowerCase());
  return apiJson({ status: standing(row?.status) });
}

/** A person's TestFlight status, as the website explains it. */
function standing(status: string | undefined): "tester" | "invited" | "no-email" | "waiting" {
  if (status === "tester" || status === "added") return "tester";
  if (status?.startsWith("invited")) return "invited";
  if (status === "no email") return "no-email";
  return "waiting";
}
