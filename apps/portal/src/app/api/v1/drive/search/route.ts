import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { db, drive, searchNodes } from "@/lib/drive";

/** Files and folders in your spaces whose names contain `q`, closest first. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return drive(() => apiJson({ items: searchNodes(db(), user.username, query.slice(0, 200)) }));
}
