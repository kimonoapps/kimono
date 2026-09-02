import { Seal, SealLink, StatedSeal } from "@kimono/ui";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { VpnRooms } from "@/components/app-rooms";
import { Panel, PanelEmpty, Panels, SectionHeading, Workspace } from "@/components/panel";
import { describeLastSeen, devicesFor, disconnectDevice, readMesh, removeDevice } from "@/lib/mesh";
import { meshContext } from "./shared";
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

  return <AppShell user={session.user} brandColors={settings.brand.colors} app={identity}>
    <div className="page admin-page">
      <VpnRooms here="devices" />

      {query.error ? <p className="admin-notice error">{query.error}</p> : null}
      {query.done ? <p className="admin-notice success">{query.done}</p> : null}

      <Workspace>
        {!member
          ? <PanelEmpty title="Kimono VPN is not switched on" action={<SealLink href="/">Back to Kimono</SealLink>}>
              Ask whoever runs this Kimono to switch it on for @{session.user.username}, and your devices will appear here.
            </PanelEmpty>
          : <>
              <SectionHeading
                title="Your devices"
                description="These reach each other directly, wherever they are."
                meta={devices.length ? `${connected} of ${devices.length} connected` : undefined}
              />
              {!mesh.available
                ? <PanelEmpty title="Not connected to the mesh">{mesh.reason}</PanelEmpty>
                : devices.length
                  ? <Panels>
                      {devices.map((device) => {
                        const expiry = describeExpiry(device.expiry);
                        return <Panel
                          key={device.id}
                          label={device.online ? "Online" : "Offline"}
                          title={device.name}
                          state={<StatedSeal state={device.online ? "running" : "quiet"}>{device.online ? "Connected" : "Offline"}</StatedSeal>}
                          action={<div className="device-actions">
                            <form action={act}>
                              <input type="hidden" name="device" value={device.id} />
                              <input type="hidden" name="intent" value="disconnect" />
                              <Seal tone="quiet" type="submit">Sign out</Seal>
                            </form>
                            <form action={act}>
                              <input type="hidden" name="device" value={device.id} />
                              <input type="hidden" name="intent" value="remove" />
                              <Seal tone="danger" type="submit">Remove</Seal>
                            </form>
                          </div>}
                        >
                          <dl className="device-facts">
                            <div><dt>Seen</dt><dd>{describeLastSeen(device)}</dd></div>
                            {device.addresses.length ? <div><dt>Address</dt><dd>{device.addresses.map((address) => <code key={address}>{address}</code>)}</dd></div> : null}
                            {expiry ? <div><dt>Sign-in</dt><dd>{expiry}</dd></div> : null}
                          </dl>
                        </Panel>;
                      })}
                    </Panels>
                  : <PanelEmpty title="No devices yet" action={<SealLink href="/vpn/connect">Connect a device</SealLink>}>
                      Nothing of yours has joined this mesh. Adding one takes about a minute.
                    </PanelEmpty>}

              <SectionHeading
                title="Meshes you can reach"
                description="People who invited you. Their devices answer from yours."
                meta={hosts.length ? `${hosts.length}` : undefined}
              />
              {hosts.length
                ? <Panels>
                    {hosts.map((host) => <Panel key={host.username} label="Host" title={host.displayName}
                      action={<SealLink href="/vpn/people" tone="quiet">People</SealLink>}>
                      <p>@{host.username} invited you in.</p>
                    </Panel>)}
                  </Panels>
                : <PanelEmpty title="Nobody has invited you" action={<SealLink href="/vpn/people" tone="quiet">Invite someone</SealLink>}>
                    Your devices reach each other. Reaching someone else&rsquo;s takes an invitation.
                  </PanelEmpty>}
            </>}
      </Workspace>
    </div>
  </AppShell>;
}
