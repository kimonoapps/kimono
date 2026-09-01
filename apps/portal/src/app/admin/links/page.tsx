import { Compartment, Note, Row, Rows, SealLink } from "@kimono/ui";
import { auth } from "@/auth";
import { AdminNavigation } from "@/components/admin-navigation";
import { AppShell } from "@/components/app-shell";
import { getPlatformSettings } from "@/lib/settings";
import { redirect } from "next/navigation";

export const metadata = { title: "Useful links · Admin" };

type Destination = { name: string; description: string; href: string; action?: string };

/**
 * Kimono hands identity off to Authentik rather than reimplementing it. Only the
 * errands worth a shortcut live here: inviting someone, and fixing an account
 * afterwards. Everything else in that console is a rabbit hole, not a link.
 */
function identityDestinations(identityDomain: string): Destination[] {
  const admin = `https://${identityDomain}/if/admin/#`;
  return [
    {
      name: "Invite someone",
      description: "Create an invitation, choosing the Kimono invitation enrollment flow, then send the link it gives you. Whoever opens it picks a username and password and can then sign in to every app you have published.",
      href: `${admin}/flow/stages/invitations`,
      action: "Create invite",
    },
    {
      name: "People",
      description: "Everyone who can sign in. Reset a password, deactivate an account, or change a name.",
      href: `${admin}/identity/users`,
    },
  ];
}

export default async function LinksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/");
  const settings = await getPlatformSettings();

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page admin-page">
      <AdminNavigation active="links" />
      <header className="admin-workspace-header">
        <div>
          <h1>Useful links</h1>
          <p>The places Kimono hands off to, so you are not hunting for an address.</p>
        </div>
      </header>

      <Compartment label="People" wants={!settings.identityDomain}>
        {settings.identityDomain
          ? <Rows>{identityDestinations(settings.identityDomain).map((destination) => <Destination key={destination.href} {...destination} />)}</Rows>
          : <Note>
              Kimono does not know your sign-in address yet, so it cannot link to account management.
              Set the identity domain on the server and reload this page.
            </Note>}
      </Compartment>
    </div>
  </AppShell>;
}

function Destination({ name, description, href, action = "Open" }: Destination) {
  return <Row title={name} action={<SealLink href={href} target="_blank" rel="noreferrer">{action}</SealLink>}>
    {description}
  </Row>;
}
