import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { books, search } from "@/lib/books";

export const dynamic = "force-dynamic";

/** `?q=` a title, an author or an ISBN. Answers `{ books }`. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return books(async (config) => apiJson({ books: await search(config, q) }));
}
