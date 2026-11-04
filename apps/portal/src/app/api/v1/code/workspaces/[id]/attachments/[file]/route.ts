import { apiUser, unauthorized } from "@/lib/api-v1";
import { attachmentBytes, code, db, workspaceFor } from "@/lib/code";

type Context = { params: Promise<{ id: string; file: string }> };

const pictures = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** A file someone attached, as the timeline shows it: pictures inline, anything else downloaded. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id, file } = await params;
  const type = new URL(request.url).searchParams.get("type") || "";
  return code(user, async () => {
    const bytes = await attachmentBytes(workspaceFor(db(), id, user.username), decodeURIComponent(file));
    const picture = pictures.has(type);
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
