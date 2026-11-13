import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { booksSettings } from "@/lib/books";
import { bookFileCache } from "@/lib/books/file-cache";
import { FilePreparing } from "@/lib/books/files";

export const dynamic = "force-dynamic";

/**
 * `?f=<address>`: whether the server has its copy of a file yet. The first
 * ask starts the one download from its source; ask again (every half second
 * or so) for `{ ready, got, size }` to draw a bar, then open the file.
 * `{ preparing, progress, stage }` while a PDF's EPUB is still being made.
 */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!(await booksSettings()).enabled) return apiError(404, "Books isn't switched on.");
  const address = new URL(request.url).searchParams.get("f") ?? "";
  if (!address) return apiError(400, "Which file?");
  const cache = bookFileCache();
  try {
    /* A file being made (a converted EPUB) says so through its fill. */
    const status = cache.status(address);
    if (!status.ready && status.got === 0) {
      const outcome = await Promise.race([cache.fill(address).then((e) => e ? "kept" : "failed"), new Promise((r) => setTimeout(() => r("going"), 400))]);
      if (outcome === "failed") return apiError(502, "That book couldn't be fetched.");
      if (outcome === "kept") return apiJson(cache.status(address));
    }
    return apiJson(cache.status(address));
  } catch (error) {
    if (error instanceof FilePreparing) return apiJson({ ready: false, preparing: true, progress: Math.round(error.progress * 100) / 100, stage: error.stage });
    throw error;
  }
}
