import { apiUser, unauthorized } from "@/lib/api-v1";
import { sendFile } from "@/lib/drive/storage";
import { attachmentPath, codeOpen, db, shareOf, workspaceAs } from "@/lib/code";

type Context = { params: Promise<{ id: string; file: string }> };

/* Shown as themselves: pictures, video and sound so they play, and PDFs in the browser's viewer (the sandbox below still lets it). Anything else downloads, so a page or an SVG never runs as Kimono. */
const inline = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
  "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/flac", "application/pdf"]);

/** A file someone attached or Kimono AI sent, as the timeline shows it: pictures, video, sound and PDFs inline, anything else downloaded. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  const share = shareOf(request);
  if (!user && !share) return unauthorized();
  const { id, file } = await params;
  const type = new URL(request.url).searchParams.get("type") || "";
  return codeOpen(user, async () => {
    const stored = decodeURIComponent(file);
    const path = attachmentPath(workspaceAs(db(), id, user?.username ?? null, "read", share), stored);
    const picture = inline.has(type);
    /* Streamed with ranges, so a video seeks and a big file isn't held in memory. */
    const response = await sendFile(request, path, { name: stored.slice(7) || stored, size: 0, type: picture ? type : "application/octet-stream", etag: stored, shared: false });
    if (response.status === 404) return new Response("Not found", { status: 404 });
    response.headers.set("Content-Type", picture ? type : "application/octet-stream");
    response.headers.set("Content-Disposition", picture ? "inline" : "attachment");
    response.headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    response.headers.set("Cache-Control", "private, max-age=86400");
    return response;
  });
}
