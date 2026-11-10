import { apiError, apiUser, unauthorized } from "@/lib/api-v1";
import { tafsir } from "@/lib/code/scripture";

/** One tafsir on one verse: `?id=169&key=7:80`. */
export async function GET(request: Request) {
  if (!await apiUser()) return unauthorized();
  const params = new URL(request.url).searchParams;
  try {
    const found = await tafsir(Number(params.get("id")), params.get("key") ?? "");
    if (!found) return apiError(404, "No such tafsir.");
    return Response.json(found, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch {
    return apiError(502, "The tafsir couldn't be reached.");
  }
}
