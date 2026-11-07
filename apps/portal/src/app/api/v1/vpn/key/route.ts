import { apiError, apiJson, apiUser, crossSite, failure, unauthorized } from "@/lib/api-v1";
import { createEnrolmentKey } from "@/lib/mesh";
import { vpnMember } from "@/lib/vpn-view";

/** POST: a one-time key for a machine with no browser, as /vpn/connect makes. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    const { member, settings } = await vpnMember(user);
    if (!member) return apiError(403, "You don't have Kimono VPN yet.");
    const minted = await createEnrolmentKey(user);
    if ("error" in minted) return apiError(400, minted.error);
    const mesh = settings.meshDomain || `mesh.${settings.baseDomain}`;
    return apiJson({ key: minted.key, expiresAt: minted.expiresAt, command: `tailscale up --login-server https://${mesh} --authkey ${minted.key}` });
  } catch (error) { return failure(error, "A key couldn't be made."); }
}
