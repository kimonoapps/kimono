import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { books, homeRows, listShelf } from "@/lib/books";

export const dynamic = "force-dynamic";

/** Home: what you're reading, then trending this week and shelves by genre. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return books(async () => apiJson({ shelf: listShelf(user.username), rows: await homeRows() }));
}
