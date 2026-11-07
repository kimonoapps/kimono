import { Crossing } from "@/components/crossing";
import { InkBlot, Seal } from "@kimono/ui";
import { LineIcon } from "@/components/line-icon";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { describeLastSeen, devicesFor, disconnectDevice, readMesh, removeDevice } from "@/lib/mesh";
import { meshContext } from "./shared";
import { requestServiceRestart } from "@/lib/kimono-services";
import { redirect } from "next/navigation";

export const metadata = { title: "Devices · Kimono VPN" };

/** An expiry only matters once it is close enough to interrupt someone. */
function describeExpiry(expiry: string | null) {
  if (!expiry) return "Never expires";
  const at = Date.parse(expiry);
  if (Number.isNaN(at)) return null;
  const days = Math.round((at - Date.now()) / 86400000);
  if (days < 0) return "Sign-in expired";
  if (days === 0) return "Sign-in expires today";
  if (days <= 14) return `Sign-in expires in ${days} day${days === 1 ? "" : "s"}`;
  return null;
}

export default async function VpnPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const { session, settings, identity, member, members } = await meshContext();
  const [mesh, query] = await Promise.all([readMesh(), searchParams]);
  const devices = mesh.available && member ? devicesFor(mesh.devices, session.user) : [];
  const connected = devices.filter((device) => device.online).length;
  const hosts = Object.values(members).filter((other) => other.username !== session.user.username && other.guests.includes(session.user.username));

  async function act(form: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user) redirect("/login");
    const id = String(form.get("device") || "");
    const intent = String(form.get("intent") || "");
    /* redirect() reports itself by throwing, so it stays outside the catch. */
    let outcome: string;
    try {
      const device = intent === "remove"
        ? await removeDevice(current.user, id)
        : await disconnectDevice(current.user, id);
      outcome = `done=${encodeURIComponent(`${device.name} was ${intent === "remove" ? "removed" : "signed out"}`)}`;
    } catch (error) {
      outcome = `error=${encodeURIComponent(error instanceof Error ? error.message : "That device could not be changed")}`;
    }
    redirect(`/vpn?${outcome}`);
  }

  /* The mesh not answering is the one problem a person can't fix from a device on it: an administrator restarts it from here. */
  async function restartMesh() {
    "use server";
    const current = await auth();
    if (!current?.user || !["owner", "admin"].includes(current.user.role)) redirect("/vpn");
    let outcome = `done=${encodeURIComponent("Restarting the VPN. Give it a minute.")}`;
    try { await requestServiceRestart("headscale"); }
    catch (error) { outcome = `error=${encodeURIComponent(error instanceof Error ? error.message : "The VPN couldn't be restarted")}`; }
    redirect(`/vpn?${outcome}`);
  }
  const admin = ["owner", "admin"].includes(session.user.role);

  const isPhone = (name: string) => /phone|pixel|ipad|android|galaxy|mobile/i.test(name);

  /* design/mockups/m3-everywhere.html, VPN: one list, a moss dot for online, sign out on hover, Connect as the floating button. */
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={identity}>
    <div className="page vpn-page">
      <div className="topbar"><span><h1>Your devices</h1><p className="sub">These reach each other directly, wherever they are.{devices.length ? ` ${connected} of ${devices.length} connected.` : ""}</p></span></div>
      {query.error ? <p role="alert" className="app-notice is-error">{query.error}</p> : null}
      {query.done ? <p role="status" className="app-notice">{query.done}</p> : null}

      {!member
        ? <div className="card vpn-empty"><b>Kimono VPN isn&rsquo;t switched on for you</b><p className="lead">Ask whoever runs this Kimono to switch it on for @{session.user.username}, and your devices will appear here.</p></div>
        : <>
            {!mesh.available
              ? <div className="card vpn-empty"><b>Not connected to the mesh</b><p className="lead">{mesh.reason}</p>{admin ? <form action={restartMesh}><Seal type="submit">Restart the VPN</Seal></form> : null}</div>
              : devices.length
                ? <div className="seg devices">
                    {devices.map((device) => <div className="row swipe" key={device.id}>
                      <InkBlot tint={device.online ? "#5c7150" : "#8a7c77"} seed={device.id}><LineIcon name={isPhone(device.name) ? "phone" : "laptop"} /></InkBlot>
                      <span className="text"><b>{device.name}</b><small>{device.addresses[0] ? <code>{device.addresses[0]}</code> : null}{device.addresses[0] ? " · " : ""}{describeLastSeen(device)}{describeExpiry(device.expiry) ? ` · ${describeExpiry(device.expiry)}` : ""}</small></span>
                      <span className={device.online ? "k-ink-dot k-running" : "k-ink-dot"}>{device.online ? "Connected" : "Offline"}</span>
                      <form action={act} className="reveal">
                        <input type="hidden" name="device" value={device.id} />
                        <input type="hidden" name="intent" value={device.online ? "disconnect" : "remove"} />
                        <Seal tone="danger" compact type="submit">{device.online ? "Sign out" : "Remove"}</Seal>
                      </form>
                    </div>)}
                  </div>
                : <div className="card vpn-empty"><b>No devices yet</b><p className="lead">Nothing of yours has joined. Adding one takes about a minute.</p></div>}

            <div className="label">Meshes you can reach</div>
            {hosts.length
              ? <div className="seg">{hosts.map((host) => <Crossing kind="kakejiku" className="row" key={host.username} href="/vpn/people">
                  <InkBlot tint="#5c7150" seed={host.username}><LineIcon name="user" /></InkBlot>
                  <span className="text"><b>{host.displayName}&rsquo;s devices</b><small>@{host.username} invited you</small></span><span className="go" />
                </Crossing>)}</div>
              : <p className="lead vpn-none">Nobody has invited you yet. <Crossing kind="kakejiku" href="/vpn/people">Invite someone</Crossing></p>}
            <Crossing kind="kakejiku" className="fab" href="/vpn/connect"><LineIcon name="plus" />Connect a device</Crossing>
          </>}
    </div>
  </AppShell>;
}
