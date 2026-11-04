import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { db, drive, recentFiles } from "@/lib/drive";

/** The files in your spaces changed most recently, newest first. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return drive(() => apiJson({ items: recentFiles(db(), user.username) }));
}
