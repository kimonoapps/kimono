import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { appleIdOf, setAppleId, syncTestflightIfDue, testflightSettings } from "@/lib/testflight";

/** Where you stand with the iPhone app's TestFlight, and the Apple ID you gave. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  const settings = await testflightSettings().catch(() => null);
  if (!settings) return apiError(404, "The iPhone app isn't set up on this Kimono yet.");
  return apiJson({ appleId: await appleIdOf(user.username), status: standing(settings.statuses.find((s) => s.username.toLowerCase() === user.username.toLowerCase())?.status) });
}

/**
 * `{ appleId }`: the email of your Apple ID. Kimono invites it to TestFlight
 * now rather than at the next hourly sync; sending it again after accepting
 * Apple's email adds you straight away.
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const appleId = String((read.body as { appleId?: unknown }).appleId ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(appleId) || appleId.length > 254) return apiError(400, "Enter the email of your Apple ID.");
  if (!(await testflightSettings().catch(() => null))) return apiError(404, "The iPhone app isn't set up on this Kimono yet.");
  const changed = (await appleIdOf(user.username)) !== appleId;
  if (changed) await setAppleId(user.username, appleId);
  /* A new Apple ID goes out at once; asking again waits at least ten seconds between syncs. */
  await syncTestflightIfDue(changed ? 0 : 10 * 1000);
  const row = (await testflightSettings())?.statuses.find((s) => s.username.toLowerCase() === user.username.toLowerCase());
  return apiJson({ appleId, status: standing(row?.status) });
}

/** A person's TestFlight status, as the website explains it. */
function standing(status: string | undefined): "tester" | "invited" | "waiting" | "problem" | "none" {
  if (status === "tester" || status === "added") return "tester";
  if (status?.startsWith("invited")) return "invited";
  if (status?.startsWith("error")) return "problem";
  if (!status || status === "no email") return "none";
  return "waiting";
}
