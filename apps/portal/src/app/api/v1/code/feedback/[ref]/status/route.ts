import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db, isAdmin } from "@/lib/code";
import { setStatus } from "@/lib/code/feedback";

type Context = { params: Promise<{ ref: string }> };

/** Marks a piece of feedback, for administrators: `{ status: "done" | "ignored" | null }`, null putting it back to do. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!isAdmin(user)) return apiError(403, "Feedback is for administrators.");
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const asked = (read.body as { status?: unknown }).status;
  if (asked !== "done" && asked !== "ignored" && asked !== null) return apiError(400, "Say done, ignored or null.");
  const { ref } = await params;
  return code(user, () => setStatus(db(), ref, asked) ? apiJson({ status: asked }) : apiError(404, "That feedback isn't here."), false);
}
