import { apiError, apiUser, unauthorized } from "@/lib/api-v1";
import { booksSettings } from "@/lib/books";
import { contentType, FilePreparing, FileProblem, openFile, parseRange, type FileFormat } from "@/lib/books/files";

export const dynamic = "force-dynamic";

/**
 * `?f=<address>&format=epub`: the file itself, streamed, with byte ranges so
 * the reader can seek and a download can resume. `&download=1` saves it.
 * A file still being made (a PDF's EPUB) answers 202 `{ preparing, progress }`
 * with Retry-After; ask again until it's 200.
 */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!(await booksSettings()).enabled) return apiError(404, "Books isn't switched on.");
  const url = new URL(request.url);
  const address = url.searchParams.get("f") ?? "";
  const format = (url.searchParams.get("format") ?? "epub") as FileFormat;
  if (!address) return apiError(400, "Which file?");
  try {
    const range = parseRange(request.headers.get("range"));
    const opened = await openFile(address, range);
    const headers = new Headers({
      "content-type": contentType[format] ?? "application/octet-stream",
      "accept-ranges": opened.size !== null ? "bytes" : "none",
      "cache-control": "private, max-age=3600",
      "content-disposition": `${url.searchParams.get("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(opened.filename)}`,
    });
    if (opened.range && opened.size !== null) {
      headers.set("content-range", `bytes ${opened.range.start}-${opened.range.end}/${opened.size}`);
      headers.set("content-length", String(opened.range.end - opened.range.start + 1));
      return new Response(opened.body, { status: 206, headers });
    }
    if (opened.size !== null) headers.set("content-length", String(opened.size));
    return new Response(opened.body, { status: 200, headers });
  } catch (error) {
    /* A PDF's EPUB being made: say how far along, and when to ask again, rather than hold the request for minutes. */
    if (error instanceof FilePreparing) return Response.json({ preparing: true, progress: Math.round(error.progress * 100) / 100 }, { status: 202, headers: { "retry-after": "5", "cache-control": "no-store" } });
    if (error instanceof FileProblem) return apiError(error.status, error.message);
    console.error("books file:", error);
    return apiError(502, "That file didn't open.");
  }
}
