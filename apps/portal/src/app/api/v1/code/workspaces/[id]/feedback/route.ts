import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db, feedbackVersions, shareOf, workspaceAs } from "@/lib/code";
import { rate, ratingsOf } from "@/lib/code/feedback";

type Context = { params: Promise<{ id: string }> };

/** The thumbs you gave this chat's answers, by the seq of each answer's end. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  return code(user, () => {
    workspaceAs(db(), id, user.username, "read", shareOf(request));
    return apiJson({ ratings: ratingsOf(db(), id, user.username) });
  }, false);
}

/** Thumbs up or down on one answer (`{ seq, rating: 1 | -1 | null, note? }`); null takes it back. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const { id } = await params;
  const body = read.body as { seq?: unknown; rating?: unknown; note?: unknown };
  const seq = typeof body.seq === "number" && Number.isInteger(body.seq) ? body.seq : null;
  const rating = body.rating === 1 || body.rating === -1 ? body.rating : body.rating === null ? null : undefined;
  if (seq === null || rating === undefined) return apiError(400, "Say which answer, and up or down.");
  return code(user, async (config) => {
    workspaceAs(db(), id, user.username, "read", shareOf(request));
    const versions = rating === null ? undefined : await feedbackVersions(config);
    try { rate(db(), id, seq, user.username, rating, typeof body.note === "string" ? body.note : "", Date.now(), versions); }
    catch { return apiError(404, "That answer isn't here."); }
    return apiJson({ ratings: ratingsOf(db(), id, user.username) });
  }, false);
}
