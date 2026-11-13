import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { books, getBook } from "@/lib/books";
import { fileAddress, filesFor, readable } from "@/lib/books/files";

export const dynamic = "force-dynamic";

/** `?key=`: the files the registered sources have for this book, best first. `{ files: [{ address, format, size, label, sample, readable }] }`. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key) return apiError(400, "Which book?");
  return books(async () => {
    const book = getBook(key);
    if (!book) return apiError(404, "No such book.");
    const files = await filesFor(book);
    return apiJson({ files: files.map((f) => ({ address: fileAddress(f), source: f.source, format: f.format, size: f.size, label: f.label, language: f.language, sample: f.sample, readable: readable(f) })) });
  });
}
