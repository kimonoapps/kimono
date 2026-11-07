import { apiError, apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { resendTestflight, testflightSettings } from "@/lib/testflight";
import { answer } from "../standing";

/** Sends you a fresh TestFlight invite, when the last one expired or went unanswered. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!(await testflightSettings().catch(() => null))) return apiError(404, "The iPhone app isn't set up on this Kimono yet.");
  const { results } = await resendTestflight([user.username]);
  const result = results[0];
  const body = await answer(user.username);
  if (result?.outcome === "too soon") return apiJson({ ...body, resent: false, error: "An invite went out a few minutes ago. Give it a little longer." });
  if (result?.outcome === "nothing to send") return apiJson({ ...body, resent: false, error: "There's no invite to send yet. Ask for the app first." });
  if (!result || result.outcome === "error") return apiJson({ ...body, resent: false, error: "Apple didn't send it. Try again in a while." });
  return apiJson({ ...body, resent: result?.outcome === "sent" });
}
