import { apiError, apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { syncTestflightIfDue, testflightSettings } from "@/lib/testflight";

/** Where you stand with the iPhone app's TestFlight. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  const settings = await testflightSettings().catch(() => null);
  if (!settings) return apiError(404, "The iPhone app isn't set up on this Kimono yet.");
  return apiJson({ status: standing(settings.statuses.find((s) => s.username.toLowerCase() === user.username.toLowerCase())?.status) });
}

/** Invites you to TestFlight now, at your Kimono email, rather than at the next hourly sync; asking again after accepting Apple's email adds you straight away. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!(await testflightSettings().catch(() => null))) return apiError(404, "The iPhone app isn't set up on this Kimono yet.");
  /* At most one sync every ten seconds, however many people ask. */
  await syncTestflightIfDue(10 * 1000);
  const row = (await testflightSettings())?.statuses.find((s) => s.username.toLowerCase() === user.username.toLowerCase());
  return apiJson({ status: standing(row?.status) });
}

/** A person's TestFlight status, as the website explains it. */
function standing(status: string | undefined): "tester" | "invited" | "waiting" | "problem" | "none" {
  if (status === "tester" || status === "added") return "tester";
  if (status?.startsWith("invited")) return "invited";
  if (status?.startsWith("error")) return "problem";
  if (!status || status === "no email") return "none";
  return "waiting";
}
