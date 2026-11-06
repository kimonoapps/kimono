import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { linksOn, artifactSharing, code, db, setArtifactPublic, shareArtifact, workspaceAs } from "@/lib/code";
import { artifactOf } from "@/lib/code/artifacts";
import { CodeProblem } from "@/lib/code/model";

type Context = { params: Promise<{ id: string; name: string }> };

/** An artifact's link and who may open it: { token, public, people }. The chat's owner's alone. */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id, name } = await params;
  return code(user, (config) => {
    const workspace = workspaceAs(db(), id, user.username, "owner");
    if (!artifactOf(db(), workspace.id, name.toLowerCase())) throw new CodeProblem("That artifact isn't here.", 404);
    return apiJson(linksOn(config, artifactSharing(db(), workspace.id, name.toLowerCase())));
  }, false);
}

/** Lets someone open it (`{ username, on: true }`), or not any more (`on: false`). */
export async function PUT(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id, name } = await params;
  const body = read.body as { username?: unknown; on?: unknown };
  return code(user, (config) => apiJson(linksOn(config, shareArtifact(db(), workspaceAs(db(), id, user.username, "owner"), name.toLowerCase(), body.username, body.on !== false))), false);
}

/** Opens its link to anyone (`{ public: true }`), or only to the people it's shared with (`{ public: false }`). */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id, name } = await params;
  const open = (read.body as { public?: unknown }).public === true;
  return code(user, (config) => {
    if (open && !config.publicLinks) throw new CodeProblem("Public links are switched off on this Kimono.", 403);
    return apiJson(linksOn(config, setArtifactPublic(db(), workspaceAs(db(), id, user.username, "owner"), name.toLowerCase(), open)));
  }, false);
}
