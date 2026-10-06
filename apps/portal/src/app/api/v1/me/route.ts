import { updateSession } from "@/auth";
import { changeProfile, readAccount } from "@/lib/account";
import { apiJson, apiUser, failure, unauthorized } from "@/lib/api-v1";

export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return apiJson(await readAccount(user));
}

/** Changes the signed-in person's name or email: `{ name?, email? }`. */
export async function PATCH(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  let body: unknown;
  try { body = await request.json(); } catch { return failure(new Error("Send JSON."), "Send JSON."); }
  try {
    const change = await changeProfile(user, body);
    await updateSession({ user: change });
    return apiJson(await readAccount({ ...user, ...change }));
  } catch (error) {
    return failure(error, "Your account could not be changed.");
  }
}
