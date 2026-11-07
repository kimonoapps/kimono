import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, createProject, db, projectsOf } from "@/lib/code";

/** This person's projects: folders they keep chats in. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async () => apiJson({ projects: projectsOf(db(), user.username) }), false);
}

/** A new project: { name }. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return code(user, async () => apiJson(createProject(db(), user.username, (read.body as { name?: unknown }).name), 201), false);
}
