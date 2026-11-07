import { apiError, apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { looksLikeEmail, setAppleEmail, testflightSettings } from "@/lib/testflight";
import { answer } from "../standing";

/** Invites you at your Apple Account's email instead of your Kimono one; an empty email goes back to the Kimono one. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!(await testflightSettings().catch(() => null))) return apiError(404, "The iPhone app isn't set up on this Kimono yet.");
  const body = await request.json().catch(() => ({})) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email && !looksLikeEmail(email)) return apiError(400, "That doesn't look like an email.");
  const outcome = await setAppleEmail(user.username, email || null);
  /* Only an invite that should have gone out can have failed: someone not yet approved just has the email kept. */
  const mine = outcome.statuses.find((row) => row.username.toLowerCase() === user.username.toLowerCase());
  const standingNow = await answer(user.username);
  const invitable = standingNow.apps.some((app) => app.status !== "idle" && app.status !== "requested" && app.status !== "declined");
  if (invitable && (!mine || mine.status.startsWith("error") || (email && mine.email?.toLowerCase() !== email.toLowerCase()))) {
    return apiError(502, "Apple didn't take that email just now. Try again in a while.");
  }
  return apiJson(standingNow);
}
