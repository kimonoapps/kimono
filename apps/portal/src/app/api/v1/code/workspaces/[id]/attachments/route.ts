import { apiError, apiJson, apiUser, crossSite, readLimited, unauthorized } from "@/lib/api-v1";
import { attach, code, db, maxAttachmentBytes, workspaceAs, shareOf } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/** Puts a file in the sandbox for the next message: the raw bytes, `?name=`, and its type as Content-Type. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const name = new URL(request.url).searchParams.get("name") || "";
  if (!name) return apiError(400, "Name the file.");
  const body = await readLimited(request, maxAttachmentBytes);
  if (!body) return apiError(413, "Attachments can be up to 20 MB.");
  const type = (request.headers.get("content-type") || "").split(";")[0].trim();
  return code(user, async (config) => apiJson(await attach(config, workspaceAs(db(), id, user.username, "edit", shareOf(request)), user, name, type, body), 201));
}
