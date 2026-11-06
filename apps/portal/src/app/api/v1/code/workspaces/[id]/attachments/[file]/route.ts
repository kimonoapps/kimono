import { apiUser, unauthorized } from "@/lib/api-v1";
import { attachmentBytes, code, db, workspaceFor } from "@/lib/code";

type Context = { params: Promise<{ id: string; file: string }> };

/* Shown as themselves: pictures, and video and sound so they play. Anything else downloads, so a page or an SVG never runs as Kimono. */
const inline = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
  "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/flac"]);

/** A file someone attached or Kimono AI sent, as the timeline shows it: pictures, video and sound inline, anything else downloaded. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id, file } = await params;
  const type = new URL(request.url).searchParams.get("type") || "";
  return code(user, async () => {
    const bytes = await attachmentBytes(workspaceFor(db(), id, user.username), decodeURIComponent(file));
    const picture = inline.has(type);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": picture ? type : "application/octet-stream",
        "Content-Disposition": picture ? "inline" : "attachment",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=86400",
      },
    });
  }, false);
}
