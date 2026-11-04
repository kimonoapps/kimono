import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { db, drive, trashOf } from "@/lib/drive";

/** Everything in your spaces' trash, newest first. It is emptied after 30 days. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return drive(() => apiJson({ items: trashOf(db(), user.username) }));
}
