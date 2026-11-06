import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { ask, code, CodeProblem, db, editAsk, efforts, modelChoices, workspaceAs, shareOf, type Attachment, type Effort, type ModelChoice } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

const isAttachment = (value: unknown): value is Attachment => {
  const a = value as Attachment;
  return Boolean(a) && typeof a.name === "string" && typeof a.path === "string" && /^\/attachments\/[^/]+$/.test(a.path) && typeof a.size === "number" && typeof a.type === "string";
};

/** Sends the agent a message: `{ text, attachments?, effort? }`, attachments as the attachments call returned them. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return code(user, (config) => {
    const body = read.body as { text?: unknown; attachments?: unknown; effort?: unknown; model?: unknown };
    const effort = efforts.includes(body.effort as Effort) ? body.effort as Effort : undefined;
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (attachments.length > 10 || !attachments.every(isAttachment)) throw new CodeProblem("Attach up to ten files.");
    const event = ask(config, workspaceAs(db(), id, user.username, "edit", shareOf(request)), user, String(body.text ?? ""), attachments, effort, modelChoices.includes(body.model as ModelChoice) ? body.model as ModelChoice : undefined);
    return apiJson(event, 202);
  });
}

/**
 * Changes a message the person sent earlier and runs it again from there: `{ seq, text, effort?, model? }`.
 * It and everything after it go; the agent carries on from just before it.
 */
export async function PATCH(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return code(user, (config) => {
    const body = read.body as { seq?: unknown; text?: unknown; effort?: unknown; model?: unknown };
    if (!Number.isInteger(body.seq) || (body.seq as number) < 1) throw new CodeProblem("Say which message to change.");
    const effort = efforts.includes(body.effort as Effort) ? body.effort as Effort : undefined;
    const event = editAsk(config, workspaceAs(db(), id, user.username, "edit", shareOf(request)), user, body.seq as number, String(body.text ?? ""), effort, modelChoices.includes(body.model as ModelChoice) ? body.model as ModelChoice : undefined);
    return apiJson(event, 202);
  });
}
