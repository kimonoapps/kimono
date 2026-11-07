import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db } from "@/lib/code";
import { profileOf, remember, setInstructions } from "@/lib/code/memory";

/** This person's instructions and memories. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async () => apiJson(profileOf(db(), user.username)), false);
}

/** { instructions } replaces their instructions; { remember, title? } keeps a memory. Answers with both. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return code(user, async () => {
    const body = read.body as { instructions?: unknown; remember?: unknown; title?: unknown };
    if (body.instructions !== undefined) setInstructions(db(), user.username, body.instructions);
    if (body.remember !== undefined) remember(db(), user.username, body.remember, "person", Date.now(), body.title);
    return apiJson(profileOf(db(), user.username));
  }, false);
}
