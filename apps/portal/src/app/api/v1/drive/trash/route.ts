import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { db, drive, emptyTrash, root, trashOf } from "@/lib/drive";
import { removeBlob } from "@/lib/drive/storage";

/** Everything in your spaces' trash, newest first. It is emptied after 30 days. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return drive(() => apiJson({ items: trashOf(db(), user.username) }));
}

/** Empties it now, in every space you can edit. */
export async function DELETE() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return drive(async () => {
    const blobs = emptyTrash(db(), user.username);
    await Promise.all(blobs.map((blob) => removeBlob(root, blob)));
    return apiJson({ removed: blobs.length });
  });
}
