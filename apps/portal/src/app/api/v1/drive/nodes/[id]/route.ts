import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { childrenOf, db, drive, DriveProblem, moveNode, nodeFor, renameNode, trashNode, withoutBlob } from "@/lib/drive";

type Context = { params: Promise<{ id: string }> };

/** A folder (with its path and contents) or a file. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return drive(() => {
    const node = nodeFor(db(), id, user.username);
    if (node.kind === "folder") return apiJson(childrenOf(db(), id, user.username));
    return apiJson({ file: withoutBlob(node) });
  });
}

/** Renames and/or moves: `{ name?, parent? }`. */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return drive(() => {
    const body = read.body as { name?: unknown; parent?: unknown };
    if (body.name === undefined && body.parent === undefined) throw new DriveProblem("Send a new name or a folder to move it to.");
    let node = body.parent !== undefined ? moveNode(db(), id, user.username, String(body.parent)) : nodeFor(db(), id, user.username, "editor");
    if (body.name !== undefined) node = renameNode(db(), id, user.username, body.name);
    return apiJson(withoutBlob(node as typeof node & { blob?: unknown }));
  });
}

/** Moves to the trash, where it stays for 30 days. */
export async function DELETE(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return drive(() => { trashNode(db(), id, user.username); return apiJson({ trashed: true }); });
}
