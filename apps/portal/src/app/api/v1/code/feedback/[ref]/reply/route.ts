import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db, isAdmin } from "@/lib/code";
import { replyTo } from "@/lib/code/feedback";

type Context = { params: Promise<{ ref: string }> };

/**
 * Replies to a thumb, for administrators: `{ note? }`. The person sees
 * "Thank you for your feedback!" under the answer they rated, and the note
 * if there is one. Sending again changes the reply.
 */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!isAdmin(user)) return apiError(403, "Replying to feedback is for administrators.");
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const note = (read.body as { note?: unknown }).note;
  const { ref } = await params;
  return code(user, () => {
    const reply = replyTo(db(), ref, user.username, typeof note === "string" ? note : "");
    return reply ? apiJson({ reply }) : apiError(404, "That feedback isn't here, or has no one to reply to.");
  }, false);
}
