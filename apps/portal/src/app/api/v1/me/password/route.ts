import { keepThisDeviceSignedIn } from "@/auth";
import { changePassword } from "@/lib/account";
import { apiJson, apiUser, crossSite, failure, readJson, unauthorized } from "@/lib/api-v1";

/** Changes the signed-in person's password: `{ current, next, confirm?, signOutOthers? }`. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  try {
    const result = await changePassword(user, read.body);
    /* Everyone else was signed out; this device stays in. */
    if (result.signedOutOthers) await keepThisDeviceSignedIn();
    return apiJson({ ended: result.ended });
  } catch (error) {
    return failure(error, "Your password could not be changed.");
  }
}
