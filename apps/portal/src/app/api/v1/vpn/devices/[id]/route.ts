import { apiError, apiJson, apiUser, failure, unauthorized } from "@/lib/api-v1";
import { disconnectDevice, removeDevice } from "@/lib/mesh";
import { vpnMember, vpnView } from "@/lib/vpn-view";

/** POST {intent:"disconnect"|"remove"}: signs one of your devices out, or forgets it. Answers with the VPN as it now is. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { intent } = await request.json().catch(() => ({})) as { intent?: string };
  if (intent !== "disconnect" && intent !== "remove") return apiError(400, "Say whether to sign it out or remove it.");
  try {
    const { member } = await vpnMember(user);
    if (!member) return apiError(403, "You don't have Kimono VPN yet.");
    const id = (await params).id;
    await (intent === "remove" ? removeDevice(user, id) : disconnectDevice(user, id));
    return apiJson(await vpnView(user));
  } catch (error) { return failure(error, "That device couldn't be changed."); }
}
