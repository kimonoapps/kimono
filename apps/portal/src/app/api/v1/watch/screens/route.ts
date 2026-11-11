import { apiJson, apiUser, crossSite, unauthorized } from "@/lib/api-v1";
import { askForScreens, watchDb } from "@/lib/watch";

/** Asks the admins for one more screen to watch on at once. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    return apiJson({ asked: askForScreens(watchDb(), user.username) });
  } catch (error) {
    return apiJson({ error: error instanceof Error ? error.message : "That didn't send." }, 400);
  }
}
