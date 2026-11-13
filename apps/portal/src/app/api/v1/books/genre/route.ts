import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { books, genreBooks } from "@/lib/books";

export const dynamic = "force-dynamic";

/** `?id=fantasy&page=0`: a genre's books, most read first, 48 a page. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const page = Math.min(Math.max(Number(url.searchParams.get("page") ?? 0) || 0, 0), 40);
  if (!id) return apiError(400, "Which genre?");
  return books(() => genreBooks(id, page).then((g) => apiJson(g)));
}
