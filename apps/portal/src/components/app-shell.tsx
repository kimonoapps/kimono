import { NavDoor } from "@/components/nav-door";
import { AppLockup, KimonoMark, accentRamp, type AppIdentity } from "@kimono/ui";
import Link from "next/link";
import Image from "next/image";
import type { Palette } from "@/lib/settings";
import { signOut } from "@/auth";
import { cx } from "@kimono/ui";
import type { CSSProperties } from "react";
import { recordAccount } from "@/lib/directory";
import { Crossing } from "@/components/crossing";

type Props = {
  children: React.ReactNode;
  user: {
    name?: string | null;
    email?: string | null;
    username: string;
    role: string;
    image?: string | null;
  };
  brandColors?: Palette;
  active?: "home" | "admin";
  /**
   * When set, the shell wears the app rather than the Portal: the app's lockup
   * replaces the Kimono mark and the Portal's own rooms step aside. Being in an
   * app should feel like being in an app, not like reading a page about one.
   */
  app?: AppIdentity;
};

function authentikAccountUrl() {
  try {
    return process.env.AUTHENTIK_ISSUER
      ? new URL("/if/user/#/settings", process.env.AUTHENTIK_ISSUER).toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Inside an app, the accent *is* the app's colour: seals, the tab of a
 * compartment that wants you, focus rings. Kimono's sakura is the house
 * colour, and a room should not be painted in it.
 */
function appPalette(app: AppIdentity): CSSProperties {
  const ramp = accentRamp(app.accent);
  return {
    "--k-app-accent": ramp.deep,
    "--k-accent": ramp.deep,
    "--k-accent-pale": ramp.tint,
    "--vermillion": ramp.deep,
    "--sakura": ramp.soft,
    "--sakura-pale": ramp.tint,
  } as CSSProperties;
}

export async function AppShell({ children, user, active = "home", app }: Props) {
  /* Recording who signs in is what lets an administrator grant Kimono VPN to a
     real account instead of typing a username and hoping. */
  await recordAccount(user);
  const displayName = user.name?.trim() || user.username;
  const accountUrl = authentikAccountUrl();
  const avatarStyle = user.image
    ? { backgroundImage: `url(${JSON.stringify(user.image)})` }
    : undefined;
  /* Only a real picture earns a portrait. There is no invented stand-in. */
  const yokeContents = <>
    <i /><i />
    <strong>Kimono account</strong>
  </>;
  return (
    <div className={cx("app-frame", app && "in-app")} style={app ? appPalette(app) : undefined}>
      <header className="top-header">
        <div className="header-inner">
          {/* The lockup is where people reach for the way out, so it is the way
              out. The blossom in the account menu remains the ceremonial one. */}
          {app
            ? <Link href="/" className="brand-link in-app-brand" aria-label="Back to Kimono"><AppLockup identity={app} /></Link>
            : <Link href="/" className="brand-link"><KimonoMark /></Link>}
          {app ? <span className="main-nav" /> : <nav className="main-nav" aria-label="Main navigation">
            <NavDoor href="/" label="Home" here={active === "home"} />
            {user.role === "owner" || user.role === "admin"
              ? <NavDoor href="/admin" label="Admin" here={active === "admin"} />
              : null}
          </nav>}
          <details className="profile-menu">
            <summary className="profile-chip" aria-label="Open account menu">
              {user.image ? <span className="avatar has-image" style={avatarStyle} /> : null}
              <span className="profile-copy"><strong>{displayName}</strong><small>@{user.username} · {user.role}</small></span>
              <span className="profile-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="profile-popover">
              {/* Leaving an app is a blossom, the same crossing that brought
                  you in — it is the one motion that means "an app". */}
              {app ? <Crossing className="signout-charm return-charm" kind="hanafubuki" href="/">
                <span className="charm-copy"><strong>Kimono</strong><small>Back to your apps</small></span>
                <span className="charm-arrow" aria-hidden="true">→</span>
              </Crossing> : null}
              {accountUrl
                ? <a className="account-yoke" href={accountUrl} aria-label="Open your Kimono account">{yokeContents}</a>
                : <div className="account-yoke" aria-hidden="true">{yokeContents}</div>}
              <form action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}>
                <button className="signout-charm" type="submit">
                  <span className="charm-copy"><strong>Sign out</strong><small>Close this session</small></span>
                  <span className="charm-arrow" aria-hidden="true">→</span>
                </button>
              </form>
            </div>
          </details>
        </div>
      </header>
      <main className="main-content">{children}</main>
    </div>
  );
}
