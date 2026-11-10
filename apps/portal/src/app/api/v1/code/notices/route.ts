import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { code, db } from "@/lib/code";
import { notices, noticeSeen, seeNotice } from "@/lib/code/skills";

/** Whether this person has acknowledged a notice: `?notice=islam`. */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const notice = new URL(request.url).searchParams.get("notice") ?? "";
  if (!notices.has(notice)) return apiError(404, "No such notice.");
  return code(user, async () => apiJson({ seen: noticeSeen(db(), user.username, notice) }), false);
}

/** Acknowledges one, for good: `{ notice }`. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const notice = (read.body as { notice?: unknown }).notice;
  if (typeof notice !== "string" || !notices.has(notice)) return apiError(404, "No such notice.");
  return code(user, async () => { seeNotice(db(), user.username, notice); return apiJson({ seen: true }); }, false);
}
