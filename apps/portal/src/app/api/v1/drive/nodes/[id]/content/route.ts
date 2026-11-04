import { apiUser, unauthorized } from "@/lib/api-v1";
import { blobPath, db, drive, DriveProblem, nodeFor, root, sendFile, typeOf } from "@/lib/drive";

type Context = { params: Promise<{ id: string }> };

/** The file's bytes, with ranges for seeking. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return drive(() => {
    const node = nodeFor(db(), id, user.username);
    if (node.kind !== "file" || !node.blob) throw new DriveProblem("That's a folder.");
    return sendFile(request, blobPath(root, node.blob), { name: node.name, size: node.size, type: typeOf(node.name), etag: node.blob, shared: false });
  });
}
export const HEAD = GET;
