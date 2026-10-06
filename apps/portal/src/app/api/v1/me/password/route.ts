import { changePassword } from "@/lib/account";
import { apiJson, apiUser, failure, unauthorized } from "@/lib/api-v1";

/** Changes the signed-in person's password: `{ current, next, confirm?, signOutOthers? }`. */
export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  let body: unknown;
  try { body = await request.json(); } catch { return failure(new Error("Send JSON."), "Send JSON."); }
  try {
    return apiJson(await changePassword(user, body));
  } catch (error) {
    return failure(error, "Your password could not be changed.");
  }
}
