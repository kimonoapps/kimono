import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { ask, code, CodeProblem, db, workspaceFor, type Attachment } from "@/lib/code";

type Context = { params: Promise<{ id: string }> };

const isAttachment = (value: unknown): value is Attachment => {
  const a = value as Attachment;
  return Boolean(a) && typeof a.name === "string" && typeof a.path === "string" && /^\/attachments\/[^/]+$/.test(a.path) && typeof a.size === "number" && typeof a.type === "string";
};

/** Sends the agent a message: `{ text, attachments? }`, attachments as the attachments call returned them. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  return code(user, (config) => {
    const body = read.body as { text?: unknown; attachments?: unknown };
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (attachments.length > 10 || !attachments.every(isAttachment)) throw new CodeProblem("Attach up to ten files.");
    const event = ask(config, workspaceFor(db(), id, user.username), user, String(body.text ?? ""), attachments);
    return apiJson(event, 202);
  });
}
