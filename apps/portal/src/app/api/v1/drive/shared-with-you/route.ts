import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { db, drive, sharedWithYou } from "@/lib/drive";

/**
 * Folders and files shared with you from spaces you aren't in, newest first.
 * Each stands on its own (parentId null, sharedWithYou true); open a folder as
 * usual (GET nodes/:id) to go inside. The change log carries them too.
 */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return drive(() => apiJson({ items: sharedWithYou(db(), user.username) }));
}
