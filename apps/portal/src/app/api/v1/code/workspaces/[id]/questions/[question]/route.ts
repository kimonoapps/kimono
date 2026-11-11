import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { answerQuestions, code, db, shareOf, workspaceAs } from "@/lib/code";

type Context = { params: Promise<{ id: string; question: string }> };

/** The person's answers to the agent's questions: { answers: [{ picked: [labels], other? }] } in order, or { skip: true }. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id, question } = await params;
  return code(user, (config) => apiJson(answerQuestions(config, workspaceAs(db(), id, user.username, "edit", shareOf(request)), user, question, read.body as { answers?: unknown; skip?: unknown })));
}
