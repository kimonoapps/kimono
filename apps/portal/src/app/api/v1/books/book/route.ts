import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { bookPage, books, shelfStateOf } from "@/lib/books";

export const dynamic = "force-dynamic";

/** `?key=ol:OL45804W`: the book, where it sits on your shelf, more by the author and more like it. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key) return apiError(400, "Which book?");
  return books(async (config) => {
    const page = await bookPage(config, key);
    return apiJson({ ...page, shelf: shelfStateOf(user.username, key) });
  });
}
