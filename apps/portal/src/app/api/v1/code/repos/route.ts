import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, requireProject } from "@/lib/code";
import { createRepository, repositories } from "@/lib/code/forgejo";

/** The Kimono Git repositories Code can work on. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async (config) => { requireProject(user); return apiJson({ repositories: await repositories(config) }); });
}

/** Starts a new project: `{ name }`. A private repository in Kimono Git, ready to work on. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return code(user, async (config) => { requireProject(user); return apiJson(await createRepository(config, String((read.body as { name?: unknown }).name ?? "")), 201); });
}
