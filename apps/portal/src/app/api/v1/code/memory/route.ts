import { apiJson, apiUser, readJson, unauthorized } from "@/lib/api-v1";
import { code, db } from "@/lib/code";
import { profileOf, remember, setInstructions } from "@/lib/code/memory";

/** This person's instructions and memories. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async () => apiJson(profileOf(db(), user.username)), false);
}

/** { instructions } replaces their instructions; { remember } keeps a memory. Answers with both. */
export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return code(user, async () => {
    const body = read.body as { instructions?: unknown; remember?: unknown };
    if (body.instructions !== undefined) setInstructions(db(), user.username, body.instructions);
    if (body.remember !== undefined) remember(db(), user.username, body.remember, "person");
    return apiJson(profileOf(db(), user.username));
  }, false);
}
