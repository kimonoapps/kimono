import { keepThisDeviceSignedIn } from "@/auth";
import { endAllSessions, listSessions } from "@/lib/account";
import { apiJson, apiUser, crossSite, failure, unauthorized } from "@/lib/api-v1";

export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    return apiJson({ sessions: await listSessions(user) });
  } catch (error) {
    return failure(error, "Your sign-ins could not be listed.");
  }
}

/** Signs this account out everywhere. The website keeps the device asking; the app, holding only a token, is signed out with the rest. */
export async function DELETE(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    const ended = await endAllSessions(user);
    if (user.via === "browser") await keepThisDeviceSignedIn();
    return apiJson({ ended });
  } catch (error) {
    return failure(error, "Those sign-ins could not be ended.");
  }
}
