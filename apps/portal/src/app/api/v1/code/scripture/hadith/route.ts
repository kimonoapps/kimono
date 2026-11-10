import { apiError, apiUser, unauthorized } from "@/lib/api-v1";
import { hadith } from "@/lib/code/scripture";

/** A cited hadith: `?book=bukhari&n=1`. Arabic, English and (where there is one) French, with its grades. */
export async function GET(request: Request) {
  if (!await apiUser()) return unauthorized();
  const params = new URL(request.url).searchParams;
  try {
    const found = await hadith(params.get("book") ?? "", Number(params.get("n")));
    if (!found) return apiError(404, "No such hadith.");
    return Response.json(found, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch {
    return apiError(502, "The hadith couldn't be reached.");
  }
}
