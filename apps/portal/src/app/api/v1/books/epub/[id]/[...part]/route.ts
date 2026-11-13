import { createHash } from "node:crypto";
import { apiError, apiUser, unauthorized } from "@/lib/api-v1";
import { booksSettings } from "@/lib/books";
import { ensureCached } from "@/lib/books/cache";
import { addressOfPathId, EpubProblem, readPart, typeOfPart } from "@/lib/books/epub-parts";
import { bookFileCache } from "@/lib/books/file-cache";
import { FilePreparing, FileProblem } from "@/lib/books/files";

export const dynamic = "force-dynamic";

/**
 * An EPUB a part at a time: `/api/v1/books/epub/<id>/META-INF/container.xml`,
 * `/…/<id>/OEBPS/chapter-1.xhtml`, … where `<id>` is the file's address in
 * base64url. A reader opens the book as if it were a folder: the container,
 * the package, then each chapter as it's turned to, never the whole file.
 * The book is kept in the server's cache; parts carry an ETag and keep for a day.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; part: string[] }> }) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!(await booksSettings()).enabled) return apiError(404, "Books isn't switched on.");
  const { id, part } = await params;
  const address = addressOfPathId(id);
  if (!address.includes(":")) return apiError(400, "Which book?");
  try {
    const book = await ensureCached(bookFileCache(), address);
    if (!book) return apiError(502, "That book didn't open.");
    const tag = `"${createHash("sha1").update(`${address}|${book.size}|${part.join("/")}`).digest("base64url").slice(0, 20)}"`;
    const headers = { etag: tag, "cache-control": "private, max-age=86400", "content-type": typeOfPart(part.join("/")) };
    if (request.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers });
    const { bytes } = readPart(book.path, part.join("/"));
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "content-length": String(bytes.length) } });
  } catch (error) {
    if (error instanceof FilePreparing) return Response.json({ preparing: true, progress: error.progress }, { status: 202, headers: { "retry-after": "5", "cache-control": "no-store" } });
    if (error instanceof EpubProblem || error instanceof FileProblem) return apiError(error.status, error.message);
    console.error("books epub:", error);
    return apiError(502, "That book didn't open.");
  }
}
