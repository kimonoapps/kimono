import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { attach, code, db, fromDrive, workspaceAs, shareOf } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/**
 * Files from Drive for the next message: `{ nodes: [ids] }`. They are copied
 * into the task's folder (so they become part of the project) and come back
 * as attachments, ready to send.
 */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return code(user, async (config) => {
    const workspace = workspaceAs(db(), id, user.username, "edit", shareOf(request));
    const files = await fromDrive(db(), config, workspace, user.username, (read.body as { nodes?: unknown }).nodes);
    const attachments = [];
    for (const file of files) attachments.push(await attach(config, workspace, user, file.name, file.type, file.bytes));
    return apiJson({ attachments }, 201);
  });
}
