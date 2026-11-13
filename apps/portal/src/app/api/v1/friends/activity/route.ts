import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { activityOf, friendly } from "@/lib/friends";
import { portalOrigin } from "@/lib/watch";

export const dynamic = "force-dynamic";

/**
 * `{ items }`: what friends are up to, for Home, the latest first: `kind` "watching" | "watched" | "reading" | "read" | "recommended",
 * the title (`app`, `itemId`, `title`, `cover`, `href` on this Portal) and who (`from`). Only what each friend lets friends see.
 */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  return friendly(async () => apiJson(await activityOf(user.username, portalOrigin(request))));
}
