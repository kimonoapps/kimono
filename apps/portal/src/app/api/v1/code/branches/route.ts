import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code } from "@/lib/code";
import { branches } from "@/lib/code/forgejo";

/** A repository's branches: `?owner=…&name=…`. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner") || "";
  const name = url.searchParams.get("name") || "";
  if (!owner || !name) return apiError(400, "Choose a repository.");
  return code(user, async (config) => apiJson({ branches: await branches(config, owner, name) }));
}
