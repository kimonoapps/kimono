import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { books, byIsbn } from "@/lib/books";

export const dynamic = "force-dynamic";

/** Every book with this ISBN (10 or 13 digits, any punctuation). */
export async function GET(_request: Request, { params }: { params: Promise<{ isbn: string }> }) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { isbn } = await params;
  return books(async (config) => apiJson({ books: await byIsbn(config, isbn) }));
}
