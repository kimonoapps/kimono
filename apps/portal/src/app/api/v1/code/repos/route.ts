import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db, requireProject } from "@/lib/code";
import { createRepository, ownProject, repositories } from "@/lib/code/forgejo";
import { workspacesOf } from "@/lib/code/model";

/** The person's Kimono Git repositories: their own, and the ones shared with them. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async (config) => {
    requireProject(user);
    /* Their projects still in Kimono AI's own account come to theirs first, so they're in the list. */
    for (const workspace of workspacesOf(db(), user.username)) await ownProject(db(), config, workspace, user).catch(() => {});
    return apiJson({ repositories: await repositories(config, user) });
  });
}

/** Starts a new project: `{ name }`. A private repository in Kimono Git, ready to work on. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return code(user, async (config) => { requireProject(user); return apiJson(await createRepository(config, user, String((read.body as { name?: unknown }).name ?? "")), 201); });
}
