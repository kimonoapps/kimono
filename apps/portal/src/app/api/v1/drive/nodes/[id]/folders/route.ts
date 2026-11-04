import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { createFolder, db, drive } from "@/lib/drive";

/** Makes a folder inside this one: `{ name }`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return drive(() => apiJson(createFolder(db(), id, user.username, (read.body as { name?: unknown }).name), 201));
}
