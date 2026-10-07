import { NavDoor } from "@/components/nav-door";
import { AppLockup, KimonoMark, accentRamp, type AppIdentity } from "@kimono/ui";
import type { Palette } from "@/lib/settings";
import { redirect } from "next/navigation";
import { signOutCompletely } from "@/lib/sign-out";
import { cx } from "@kimono/ui";
import type { CSSProperties } from "react";
import { recordAccount } from "@/lib/directory";
import { Crossing } from "@/components/crossing";
import { Portrait } from "@/components/portrait";
import { picturePathFor } from "@/lib/pictures";

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
  /** Which header door is open. The account is neither room. */
  active?: "home" | "admin" | "account";
  /**
   * When set, the shell wears the app rather than the Portal: the app's lockup
   * replaces the Kimono mark and the Portal's own rooms step aside. Being in an
   * app should feel like being in an app, not like reading a page about one.
   */
  app?: AppIdentity;
};

/** Derive app actions and transition colours from the same bloom palette. */
function appPalette(app: AppIdentity): CSSProperties {
  const ramp = accentRamp(app.accent);
  return {
    "--k-app-accent": ramp.deep,
    "--k-accent": ramp.deep,
    "--k-accent-deep": `color-mix(in srgb, ${ramp.deep} 82%, #24221f)`,
    "--k-accent-pale": ramp.tint,
  } as CSSProperties;
}

export async function AppShell({ children, user, active = "home", app }: Props) {
  /* Recording who signs in is what lets an administrator grant Kimono VPN to a
     real account instead of typing a username and hoping. */
  await recordAccount(user);
  const displayName = user.name?.trim() || user.username;
  /* Kimono's own picture first; the identity provider's only if none was set here. */
  const picture = await picturePathFor(user.username) ?? user.image ?? null;
  return (
    <div className={cx("app-frame", app && "in-app")} style={app ? appPalette(app) : undefined}>
      <header className="top-header">
        <div className="header-inner">
          {/* The lockup is where people reach for the way out, so it is the way out. */}
          {app
            ? <Crossing kind="hanafubuki" href="/" className="brand-link in-app-brand" aria-label="Back to Kimono"><AppLockup identity={app} /></Crossing>
            : <Crossing kind="kakejiku" href="/" className="brand-link"><KimonoMark /></Crossing>}
          {app ? <span className="main-nav" /> : <nav className="main-nav" aria-label="Main navigation">
            <NavDoor href="/" label="Home" here={active === "home"} />
            {user.role === "owner" || user.role === "admin"
              ? <NavDoor href="/admin" label="Admin" here={active === "admin"} />
              : null}
          </nav>}
          <details className="profile-menu">
            <summary className="profile-chip" aria-label="Open account menu">
              <Portrait name={displayName} username={user.username} picture={picture} size={34} className="avatar" />
              <span className="profile-copy"><strong>{displayName}</strong><small>{user.role}</small></span>
              <span className="profile-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="profile-popover">
              <div className="profile-identity"><strong>{displayName}</strong><small>@{user.username} · {user.role}</small></div>
              {/* Leaving an app is a blossom, the same crossing that brought
                  you in — it is the one motion that means "an app". */}
              {app ? <Crossing className="profile-item profile-return" kind="hanafubuki" href="/">
                <span>Back to Kimono</span><small>All your apps</small>
              </Crossing> : null}
              <Crossing kind="kakejiku" className="profile-item" href="/account"><span>Your account</span><small>Picture, name, password and devices</small></Crossing>
              <form action={async () => {
                "use server";
                await signOutCompletely();
                redirect("/login");
              }}>
                <button className="profile-item profile-signout" type="submit">
                  <span>Sign out</span><small>Close this session</small>
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
