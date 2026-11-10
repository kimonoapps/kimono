import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { attachAll, code, db, ensure, fromDrive, who, workspaceAs, shareOf } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

/**
 * Files from Drive for the next message: `{ nodes: [ids] }`. They are copied
 * into the task's folder (so they become part of the project) and come back
 * as attachments, ready to send, in the order asked. One over 20 MB stays a
 * Drive file: the way to attach something that big is to upload it into the
 * chat's folder (upload-folder) and then name it here.
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
    /* The sandbox is woken (or made again) first: the files go straight into it. */
    await ensure(config, workspace, who(user));
    const picked = await fromDrive(db(), config, workspace, user.username, (read.body as { nodes?: unknown }).nodes);
    const small = await attachAll(config, workspace, user, picked.flatMap((p) => "bytes" in p ? [p] : []));
    let next = 0;
    return apiJson({ attachments: picked.map((p) => "attachment" in p ? p.attachment : small[next++]) }, 201);
  });
}
