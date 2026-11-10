import { apiError, apiUser, unauthorized } from "@/lib/api-v1";
import { quranPassage } from "@/lib/code/scripture";

/** A cited passage: `?ref=7:80-81`. Its verses in Arabic with English and French, one verse of context on each side, and the tafsirs on offer. */
export async function GET(request: Request) {
  if (!await apiUser()) return unauthorized();
  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  try {
    const passage = await quranPassage(ref);
    if (!passage) return apiError(404, "No such verse.");
    return Response.json(passage, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch {
    return apiError(502, "The Quran couldn't be reached.");
  }
}
