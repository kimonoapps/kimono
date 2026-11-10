import { apiError, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db } from "@/lib/code";
import { createSkill, setSkill, type CustomSkillInput } from "@/lib/code/skills";
import { skillsCatalog as catalog, skillViewer } from "@/lib/code/skills-api";

/** The skills catalog, with which ones this person has on, and whether they may publish. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async () => catalog(user), false);
}

/**
 * `{ id, enabled }` turns one skill on or off. `{ create: { name, description,
 * kind, body, published? } }` writes a new skill of this person's own (only an
 * admin may publish it at once). Answers with the catalog.
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = read.body as { id?: unknown; enabled?: unknown; create?: unknown };
  if (body.create && typeof body.create === "object") {
    const input = body.create as CustomSkillInput;
    return code(user, async () => {
      createSkill(db(), { ...skillViewer(user), author: user.name || user.username }, input);
      return catalog(user);
    }, false);
  }
  if (typeof body.id !== "string" || typeof body.enabled !== "boolean") return apiError(400, "Say which skill, and on or off.");
  const id = body.id;
  const enabled = body.enabled;
  return code(user, async () => {
    try { setSkill(db(), user.username, id, enabled); } catch { return apiError(404, "That skill isn't here."); }
    return catalog(user);
  }, false);
}
