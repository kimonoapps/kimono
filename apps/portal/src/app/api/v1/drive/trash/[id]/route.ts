import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { db, drive, purgeNode, root } from "@/lib/drive";
import { removeBlob } from "@/lib/drive/storage";

type Context = { params: Promise<{ id: string }> };

/** Deletes one thing in the trash for good, with whatever is inside it. */
export async function DELETE(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return drive(async () => {
    const blobs = purgeNode(db(), id, user.username);
    await Promise.all(blobs.map((blob) => removeBlob(root, blob)));
    return apiJson({ removed: blobs.length });
  });
}
