import "server-only";

import { nativeAppEnabled } from "./apps";
import { listAccounts, readMeshMembers, setMeshGuests, type MeshMember } from "./directory";
import { publishDesiredState } from "./desired-state";
import { ownApp } from "./kimono-apps";
import { describeLastSeen, devicesFor, readMesh } from "./mesh";
import { getPlatformSettings } from "./settings";

/*
 * 網 Kimono VPN, for the phone: what the website's /vpn rooms show (Devices,
 * People, Connect), as JSON. The phone only looks after the mesh; joining it
 * is Tailscale's, pointed at this Kimono.
 */

type Person = { username: string; email?: string | null };

/** An expiry only matters once it is close enough to interrupt someone (as /vpn). */
function describeExpiry(expiry: string | null) {
  if (!expiry) return null;
  const at = Date.parse(expiry);
  if (Number.isNaN(at)) return null;
  const days = Math.round((at - Date.now()) / 86400000);
  if (days < 0) return "Sign-in expired";
  if (days === 0) return "Sign-in expires today";
  if (days <= 14) return `Sign-in expires in ${days} day${days === 1 ? "" : "s"}`;
  return null;
}

/** Throws a sentence when the VPN isn't on here, or isn't on for this person. */
export async function vpnMember(person: Person) {
  const settings = await getPlatformSettings();
  if (!nativeAppEnabled(ownApp("kimono-vpn"), settings)) throw new Error("Kimono VPN isn't switched on here.");
  const members = await readMeshMembers().catch(() => ({} as Record<string, MeshMember>));
  const member = members[person.username.toLowerCase()];
  return { settings, members, member };
}

export async function vpnView(person: Person) {
  const { settings, members, member } = await vpnMember(person);
  const me = person.username.toLowerCase();
  const mesh = settings.meshDomain || `mesh.${settings.baseDomain}`;
  if (!member) return { member: false, mesh, available: false, reason: null, devices: [], guests: [], hosts: [], invitable: [] };
  const [reading, accounts] = await Promise.all([readMesh(), listAccounts().catch(() => [])]);
  const nameOf = (username: string) => accounts.find((account) => account.username === username)?.name || members[username]?.displayName || username;
  return {
    member: true,
    mesh,
    available: reading.available,
    reason: reading.available ? null : reading.reason,
    devices: reading.available ? devicesFor(reading.devices, person).map((device) => ({
      id: device.id, name: device.name, addresses: device.addresses, online: device.online,
      seen: describeLastSeen(device), expiry: describeExpiry(device.expiry),
    })) : [],
    guests: member.guests.filter((username) => members[username]).map((username) => ({ username, name: nameOf(username) })),
    hosts: Object.values(members).filter((other) => other.username !== me && other.guests.includes(me)).map((host) => ({ username: host.username, name: host.displayName })),
    invitable: Object.values(members).filter((other) => other.username !== me && !member.guests.includes(other.username)).map((other) => ({ username: other.username, name: nameOf(other.username) })),
  };
}

/** Lets [guest] reach this person's devices, or stops letting them. */
export async function setGuest(person: Person, guest: string, invited: boolean) {
  const { members, member } = await vpnMember(person);
  if (!member) throw new Error("You don't have Kimono VPN yet.");
  const who = guest.toLowerCase();
  if (invited && !members[who]) throw new Error(`@${who} doesn't have Kimono VPN yet.`);
  await setMeshGuests(member.username, (current) => invited ? [...current, who] : current.filter((item) => item !== who));
  await publishDesiredState(await getPlatformSettings());
}
