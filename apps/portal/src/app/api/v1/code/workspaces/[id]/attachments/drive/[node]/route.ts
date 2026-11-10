import { apiUser, unauthorized } from "@/lib/api-v1";
import { sendFile } from "@/lib/drive/storage";
import { codeOpen, db, driveAttachment, shareOf, workspaceAs } from "@/lib/code";
import { inline } from "../../inline";

type Context = { params: Promise<{ id: string; node: string }> };

/** An attachment over 20 MB, which is a file in the chat's Drive folder: shown to whoever can read the chat, as the others are. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  const share = shareOf(request);
  if (!user && !share) return unauthorized();
  const { id, node } = await params;
  const type = new URL(request.url).searchParams.get("type") || "";
  return codeOpen(user, async () => {
    const file = driveAttachment(workspaceAs(db(), id, user?.username ?? null, "read", share), decodeURIComponent(node));
    const picture = inline.has(type);
    const response = await sendFile(request, file.path, { name: file.name, size: file.size, type: picture ? type : "application/octet-stream", etag: node, shared: false });
    if (response.status === 404) return new Response("Not found", { status: 404 });
    response.headers.set("Content-Type", picture ? type : "application/octet-stream");
    response.headers.set("Content-Disposition", picture ? "inline" : "attachment");
    response.headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    response.headers.set("Cache-Control", "private, max-age=86400");
    return response;
  });
}
