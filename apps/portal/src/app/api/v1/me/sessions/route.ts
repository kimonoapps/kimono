import { endAllSessions, listSessions } from "@/lib/account";
import { apiJson, apiUser, failure, unauthorized } from "@/lib/api-v1";

export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    return apiJson({ sessions: await listSessions(user) });
  } catch (error) {
    return failure(error, "Your sign-ins could not be listed.");
  }
}

/** Signs this account out of every browser it is signed in to. */
export async function DELETE() {
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    return apiJson({ ended: await endAllSessions(user) });
  } catch (error) {
    return failure(error, "Those sign-ins could not be ended.");
  }
}
