import { apiError, apiJson, apiUser, crossSite, failure, unauthorized } from "@/lib/api-v1";
import { setGuest, vpnView } from "@/lib/vpn-view";

/** PUT {username, invited}: lets someone reach your devices, or stops letting them. */
export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { username, invited } = await (request.headers.get("content-type")?.startsWith("application/json") ? request.json() : Promise.reject(new Error("Send JSON."))).catch(() => ({})) as { username?: string; invited?: boolean };
  if (!username || typeof invited !== "boolean") return apiError(400, "Say who, and whether they're in.");
  try { await setGuest(user, username, invited); return apiJson(await vpnView(user)); } catch (error) { return failure(error, "That couldn't be changed."); }
}
