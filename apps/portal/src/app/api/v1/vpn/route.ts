import { apiJson, apiUser, failure, unauthorized } from "@/lib/api-v1";
import { vpnView } from "@/lib/vpn-view";

/** Kimono VPN as the website's /vpn shows it: your devices, who you let in, who let you in. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  try { return apiJson(await vpnView(user)); } catch (error) { return failure(error, "Kimono VPN couldn't be read."); }
}
