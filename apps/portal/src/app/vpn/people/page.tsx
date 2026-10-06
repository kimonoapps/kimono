import { CrossingSeal } from "@/components/crossing";
import { Seal } from "@kimono/ui";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { VpnRooms } from "@/components/app-rooms";
import { Panel, PanelEmpty, PanelForm, Panels, SectionHeading, Workspace } from "@/components/panel";
import { listAccounts, readMeshMembers, setMeshGuests, type MeshMember } from "@/lib/directory";
import { publishDesiredState } from "@/lib/desired-state";
import { getPlatformSettings } from "@/lib/settings";
import { meshContext } from "../shared";
import { redirect } from "next/navigation";

export const metadata = { title: "People · Kimono VPN" };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ error?: string; invited?: string }> }) {
  const { session, settings, identity, members, member } = await meshContext();
  const query = await searchParams;
  const me = session.user.username;

  async function invite(form: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user) redirect("/login");
    const guest = String(form.get("guest") || "").toLowerCase();
    try {
      const known = await readMeshMembers();
      const mine = known[current.user.username];
      if (!mine) throw new Error("You do not have Kimono VPN yet");
      if (!known[guest]) throw new Error(`@${guest} does not have Kimono VPN yet`);
      await setMeshGuests(current.user.username, [...mine.guests, guest]);
      await publishDesiredState(await getPlatformSettings());
    } catch (error) {
      redirect(`/vpn/people?error=${encodeURIComponent(error instanceof Error ? error.message : "That invitation could not be sent")}`);
    }
    redirect(`/vpn/people?invited=${encodeURIComponent(guest)}`);
  }

  async function withdraw(form: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user) redirect("/login");
    const guest = String(form.get("guest") || "").toLowerCase();
    const known = await readMeshMembers();
    const mine = known[current.user.username];
    if (mine) {
      await setMeshGuests(current.user.username, mine.guests.filter((item) => item !== guest));
      await publishDesiredState(await getPlatformSettings());
    }
    redirect("/vpn/people");
  }

  const guests = (member?.guests || []).map((username) => members[username]).filter(Boolean) as MeshMember[];
  const hosts = Object.values(members).filter((other) => other.username !== me && other.guests.includes(me));
  const accounts = await listAccounts();
  const invitable = member
    ? Object.values(members)
        .filter((other) => other.username !== me && !member.guests.includes(other.username))
        .map((other) => ({ username: other.username, name: accounts.find((a) => a.username === other.username)?.name || other.displayName }))
    : [];

  return <AppShell user={session.user} brandColors={settings.brand.colors} app={identity}>
    <div className="page admin-page">
      <VpnRooms here="people" />

      {query.error ? <p className="admin-notice error">{query.error}</p> : null}
      {query.invited ? <p className="admin-notice success">@{query.invited} can now reach your devices.</p> : null}

      <Workspace>
        <SectionHeading
          title="People you let in"
          description="Your mesh is yours alone until you invite someone. Invitations go one way."
          meta={guests.length ? `${guests.length} ${guests.length === 1 ? "guest" : "guests"}` : undefined}
        />

        {guests.length
          ? <Panels>
              {guests.map((guest) => <Panel
                key={guest.username}
                label="Guest"
                title={guest.displayName}
                action={<form action={withdraw}>
                  <input type="hidden" name="guest" value={guest.username} />
                  <Seal tone="danger" type="submit">Remove</Seal>
                </form>}
              >
                <p>@{guest.username} reaches your devices. You do not reach theirs unless they invite you back.</p>
              </Panel>)}
            </Panels>
          : <PanelEmpty title="Nobody else reaches your devices">
              Invite someone and their devices can reach yours — not the other way round.
            </PanelEmpty>}

        {invitable.length ? <Panels>
          <PanelForm label="Invite" title="Invite someone" action={invite} submit={<Seal type="submit">Invite</Seal>}>
            <label className="invite-field">
              <select name="guest" required defaultValue="">
                <option value="" disabled>Choose someone</option>
                {invitable.map((person) => <option key={person.username} value={person.username}>{person.name} · @{person.username}</option>)}
              </select>
            </label>
          </PanelForm>
        </Panels> : null}

        <SectionHeading
          title="Meshes you can reach"
          description="People who have invited you into theirs."
          meta={hosts.length ? `${hosts.length}` : undefined}
        />

        {hosts.length
          ? <Panels>
              {hosts.map((host) => <Panel key={host.username} label="Host" title={host.displayName}>
                <p>@{host.username} invited you, so your devices reach theirs.</p>
              </Panel>)}
            </Panels>
          : <PanelEmpty title="Nobody has invited you" action={<CrossingSeal href="/vpn" tone="quiet">Your devices</CrossingSeal>}>
              When someone invites you into their mesh, their devices become reachable from yours.
            </PanelEmpty>}
      </Workspace>
    </div>
  </AppShell>;
}
