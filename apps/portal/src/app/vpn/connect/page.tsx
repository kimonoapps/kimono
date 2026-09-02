import { Command, Reveal, Rows, Seal } from "@kimono/ui";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { VpnRooms } from "@/components/app-rooms";
import { Panel, PanelEmpty, Panels, SectionHeading, Workspace } from "@/components/panel";
import { createEnrolmentKey } from "@/lib/mesh";
import { meshContext } from "../shared";
import { redirect } from "next/navigation";

export const metadata = { title: "Connect · Kimono VPN" };

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ key?: string; error?: string }> }) {
  const { session, settings, identity, member } = await meshContext();
  const query = await searchParams;
  const mesh = settings.meshDomain || `mesh.${settings.baseDomain}`;

  /* Only a machine with no browser needs a key, and even then it is minted for
     the person asking rather than by an administrator at a shell. */
  async function mintKey() {
    "use server";
    const current = await auth();
    if (!current?.user) redirect("/login");
    const minted = await createEnrolmentKey(current.user);
    if ("error" in minted) redirect(`/vpn/connect?error=${encodeURIComponent(minted.error)}`);
    redirect(`/vpn/connect?key=${encodeURIComponent(minted.key)}`);
  }

  if (!member) {
    return <AppShell user={session.user} brandColors={settings.brand.colors} app={identity}>
      <div className="page admin-page">
        <VpnRooms here="connect" />
        <Workspace>
          <PanelEmpty title="Kimono VPN is not switched on">
            Ask whoever runs this Kimono to switch it on for @{session.user.username}. Until then a device you added would reach nothing.
          </PanelEmpty>
        </Workspace>
      </div>
    </AppShell>;
  }

  return <AppShell user={session.user} brandColors={settings.brand.colors} app={identity}>
    <div className="page admin-page">
      <VpnRooms here="connect" />

      {query.error ? <p className="admin-notice error">{query.error}</p> : null}

      <Workspace>
        <SectionHeading
          title="Add a device"
          description="Install Tailscale, point it at your Kimono, and sign in with the account you are using now."
        />
        <Panels>
          <Panel label="Device" title="Sign in on the device">
            <p>No key, no copying secrets around — the device asks Kimono who you are, the same way this page did.</p>
            <Rows>
              <Reveal title="Phone" summary="iOS or Android">
                <p>Install <strong>Tailscale</strong>. Before signing in, open the account menu, choose a custom coordination server, and enter:</p>
                <Command>{mesh}</Command>
                <p>Sign in with your Kimono account. The phone appears under Devices within seconds.</p>
              </Reveal>

              <Reveal title="Laptop" summary="macOS, Windows or Linux desktop">
                <p>Install Tailscale, then run this. A browser opens and you sign in with Kimono:</p>
                <Command>{`tailscale up --login-server https://${mesh}`}</Command>
              </Reveal>

              <Reveal title="How this works" summary="Why no port needs opening">
                <p>
                  The mesh speaks the Tailscale protocol, but the coordination server is yours, at {mesh}, and it
                  checks your Kimono account before letting a device in. Both ends connect outward and meet in the
                  middle, so nothing is opened on your router and nothing of yours passes through anyone
                  else&rsquo;s infrastructure.
                </p>
              </Reveal>
            </Rows>
          </Panel>
        </Panels>

        <SectionHeading
          title="A machine with no browser"
          description="A headless server cannot open a sign-in page, so it joins with a key instead."
        />
        <Panels>
          <Panel
            label="Key"
            title={query.key ? "Your key is ready" : "Only if you need one"}
            wants={Boolean(query.key)}
            action={query.key ? undefined : <form action={mintKey}><Seal tone="quiet" type="submit">Create a key</Seal></form>}
          >
            {query.key
              ? <>
                  <p>It works once and expires in thirty minutes. Run this on the machine you are adding:</p>
                  <Command>{`tailscale up --login-server https://${mesh} --authkey ${query.key}`}</Command>
                  <p>The key on its own, if the machine wants it separately:</p>
                  <Command>{query.key}</Command>
                </>
              : <p>Most devices never need this. A server without a browser does.</p>}
          </Panel>
          <Panel label="Server" title="Joining a server">
            <p>Install Kimono on it, then join with the key above:</p>
            <Command>{`curl -fsSL https://${settings.baseDomain}/install.sh | sudo sh\nsudo kimono node install`}</Command>
          </Panel>
          <Panel label="Care" title="A key is not a sign-in">
            <p>
              A machine joined with a key is not signed in as you — it belongs to your mesh account
              without ever meeting the identity provider. Use one only where a browser cannot open, and
              sign in normally everywhere else, so every device answers to the same account.
            </p>
          </Panel>
        </Panels>
      </Workspace>
    </div>
  </AppShell>;
}
