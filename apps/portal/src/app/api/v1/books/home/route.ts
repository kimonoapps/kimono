import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { books, friendsReading, homeRows, listShelf } from "@/lib/books";

export const dynamic = "force-dynamic";

/** Home: what you're reading, what friends are reading, then trending this week and shelves by genre. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return books(async () => {
    const [rows, friends] = await Promise.all([homeRows(), friendsReading(user.username)]);
    return apiJson({ shelf: listShelf(user.username), friends, rows });
  });
}
