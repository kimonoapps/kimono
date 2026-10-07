import { updateSession } from "@/auth";
import { changeProfile, readAccount } from "@/lib/account";
import { apiJson, apiUser, crossSite, failure, readJson, unauthorized } from "@/lib/api-v1";

export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return apiJson(await readAccount(user));
}

/** Changes the signed-in person's name or email: `{ name?, email?, currentPassword? }`. A new email needs `currentPassword`. */
export async function PATCH(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  try {
    const change = await changeProfile(user, read.body);
    await updateSession({ user: change });
    return apiJson(await readAccount({ ...user, ...change }));
  } catch (error) {
    return failure(error, "Your account could not be changed.");
  }
}
