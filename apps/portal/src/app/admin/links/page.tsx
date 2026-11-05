import { Crossing } from "@/components/crossing";
import { InkBlot } from "@kimono/ui";
import { auth } from "@/auth";
import { LineIcon } from "@/components/line-icon";
import { AppShell } from "@/components/app-shell";
import { getPlatformSettings } from "@/lib/settings";
import { redirect } from "next/navigation";

export const metadata = { title: "Useful links · Admin" };

type Destination = { name: string; description: string; href: string; action?: string; icon: "link" | "user" };

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
      description: "Create one with the Kimono invitation flow and send the link. They pick a username and password, and can sign in to every app you've published.",
      href: `${admin}/flow/stages/invitations`,
      action: "Create invite",
      icon: "link",
    },
    {
      name: "People",
      description: "Everyone who can sign in. Reset a password, deactivate an account, or change a name.",
      href: `${admin}/identity/users`,
      icon: "user",
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
      <div className="topbar">
        <Crossing kind="kakejiku" className="back" href="/admin" aria-label="Back to Admin"><LineIcon name="back" /></Crossing>
        <span><h1>Useful links</h1><p className="sub">The places Kimono hands off to, so you are not hunting for an address.</p></span>
      </div>

      <div className="label">People and invites</div>
      {settings.identityDomain
        ? <div className="seg links-seg">{identityDestinations(settings.identityDomain).map((destination) => <Destination key={destination.href} {...destination} />)}</div>
        : <div className="card links-missing"><b>Kimono doesn&rsquo;t know your sign-in address yet</b><p className="lead">Set the identity domain on the server and reload this page, and these links appear.</p></div>}
    </div>
  </AppShell>;
}

/** One errand: an ink icon, what it is in a line, and the way there on the right. */
function Destination({ name, description, href, action = "Open", icon }: Destination) {
  return <div className="row links-row">
    <InkBlot tint={icon === "link" ? "#a84d63" : "#5c7150"} seed={name}><LineIcon name={icon} /></InkBlot>
    <span className="text"><b>{name}</b><small>{description}</small></span>
    {/* eslint-disable-next-line no-restricted-syntax -- Authentik's console opens in a new tab; there is no page change to make. */}
    <a className="k-seal k-tone-quiet links-go" href={href} target="_blank" rel="noreferrer">{action}<LineIcon name="out" /></a>
  </div>;
}
