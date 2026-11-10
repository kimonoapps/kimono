import { apiError, apiUser, unauthorized } from "@/lib/api-v1";
import { code, isAdmin } from "@/lib/code";
import { keptFilePath } from "@/lib/code/kept-files";
import { sendFile } from "@/lib/drive/storage";

type Context = { params: Promise<{ id: string; name: string }> };

/* Shown as themselves: pictures, video and sound, and PDFs in the browser's viewer (the sandbox below still lets it). Anything else downloads. */
const inline = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
  "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/flac", "application/pdf"]);

/** A file a chat in the feedback bank names, kept beside it (lib/code/kept-files.ts), for an administrator to open. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!isAdmin(user)) return apiError(403, "The feedback bank is for administrators.");
  const { id, name } = await params;
  const type = new URL(request.url).searchParams.get("type") || "";
  return code(user, async () => {
    const stored = decodeURIComponent(name);
    const path = keptFilePath(id, stored);
    if (!path) return new Response("Not found", { status: 404 });
    const shown = inline.has(type);
    const response = await sendFile(request, path, { name: stored.slice(7) || stored, size: 0, type: shown ? type : "application/octet-stream", etag: `${id}-${stored}`, shared: false });
    if (response.status === 404) return new Response("Not found", { status: 404 });
    response.headers.set("Content-Type", shown ? type : "application/octet-stream");
    response.headers.set("Content-Disposition", shown ? "inline" : "attachment");
    response.headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    response.headers.set("Cache-Control", "private, max-age=86400");
    return response;
  }, false);
}
