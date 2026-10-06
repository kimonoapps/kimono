import { auth } from "@/auth";
import { getPlatformSettings } from "@/lib/settings";
import { identityOf, ownApp } from "@/lib/kimono-apps";
import { readMeshMembers, type MeshMember } from "@/lib/directory";
import { notFound, redirect } from "next/navigation";
import { nativeAppEnabled } from "@/lib/apps";

/** Everything a Kimono VPN room needs before it can draw anything. */
export async function meshContext() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const settings = await getPlatformSettings();
  if (!nativeAppEnabled(ownApp("kimono-vpn"), settings)) notFound();
  const members = await readMeshMembers().catch(() => ({} as Record<string, MeshMember>));
  if (!members[session.user.username]) notFound();
  return {
    session,
    settings,
    members,
    member: members[session.user.username],
    identity: identityOf(ownApp("kimono-vpn")),
  };
}
