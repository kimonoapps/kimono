import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { books, readingFormat, setReadingFormat } from "@/lib/books";

export const dynamic = "force-dynamic";

/** `{ format }`: "epub" or "pdf", how you like to read a book that comes both ways; null to be asked again. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return books(() => apiJson({ format: readingFormat(user.username) }));
}

export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const format = (read.body as { format?: unknown } | null)?.format ?? null;
  if (format !== null && format !== "epub" && format !== "pdf") return apiError(400, "A format is epub or pdf.");
  return books(() => { setReadingFormat(user.username, format); return apiJson({ format }); });
}
