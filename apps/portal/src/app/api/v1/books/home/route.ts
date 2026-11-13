import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { books, homeFor } from "@/lib/books";

export const dynamic = "force-dynamic";

/** Home: a featured book, what you're reading, what friends are reading, then trending this week and shelves by genre. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return books(async () => apiJson(await homeFor(user.username)));
}
