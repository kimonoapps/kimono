import { apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db } from "@/lib/code";
import { deleteSkill, updateSkill, type CustomSkillInput } from "@/lib/code/skills";
import { skillsCatalog as catalog, skillViewer } from "@/lib/code/skills-api";

/** Changes a skill someone here wrote: `{ name?, description?, kind?, body?, published? }`. Publishing is for admins. Answers with the catalog. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return code(user, async () => {
    updateSkill(db(), skillViewer(user), id, read.body as CustomSkillInput);
    return catalog(user);
  }, false);
}

/** Deletes a skill: its writer's own, or a published one by an admin. Answers with the catalog. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, async () => {
    deleteSkill(db(), skillViewer(user), id);
    return catalog(user);
  }, false);
}
