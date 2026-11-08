import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db } from "@/lib/code";
import { setSkill, skillsOf } from "@/lib/code/skills";

/** The skills catalog, with which ones this person has on. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async () => apiJson({ skills: skillsOf(db(), user.username) }), false);
}

/** Turns one skill on or off: `{ id, enabled }`. Answers with the catalog. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = read.body as { id?: unknown; enabled?: unknown };
  if (typeof body.id !== "string" || typeof body.enabled !== "boolean") return apiError(400, "Say which skill, and on or off.");
  const id = body.id;
  const enabled = body.enabled;
  return code(user, async () => {
    try { setSkill(db(), user.username, id, enabled); } catch { return apiError(404, "That skill isn't here."); }
    return apiJson({ skills: skillsOf(db(), user.username) });
  }, false);
}
