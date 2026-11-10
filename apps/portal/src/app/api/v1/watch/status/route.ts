import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { status, watch } from "@/lib/watch";

/** Watch's health, for owners and admins: TMDB, AIOStreams and nzbdav, setup, and the last error. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (user.role !== "owner" && user.role !== "admin") return apiError(403, "Only owners and admins can see this.");
  return watch(async (cfg) => apiJson(await status(cfg)));
}
