import { accentRamp, InkPortraitFrame, type AppIdentity } from "@kimono/ui";
import type { Palette } from "@/lib/settings";
import { cx } from "@kimono/ui";
import type { CSSProperties } from "react";
import { recordAccount, holdsMeshAccess } from "@/lib/directory";
import { Portrait } from "@/components/portrait";
import { picturePathFor } from "@/lib/pictures";
import { UpdateBanner } from "@/components/update-banner";
import { PageTransition } from "@/components/page-transition";
import { Rail, type RailApp, type RailRoom } from "@/components/rail";
import { defaultPins } from "@/lib/default-pins";
import { appRegistry, launcherApps } from "@/lib/apps";
import { getPlatformSettings } from "@/lib/settings";
import { scanAppDefinitions } from "@/lib/definitions";

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
  /** Which of the house's own places this is. */
  active?: "home" | "admin" | "account";
  /** When set, the page belongs to this app: its pin opens and takes the app's colour. */
  app?: AppIdentity;
  /** The app's own rooms, shown beneath its pin in the rail. */
  rooms?: RailRoom[];
};

/** Derive app actions from the app's own colour. */
function appPalette(app: AppIdentity): CSSProperties {
  const ramp = accentRamp(app.accent);
  return {
    "--k-app-accent": ramp.deep,
    "--k-accent": ramp.deep,
    "--k-accent-deep": `color-mix(in srgb, ${ramp.deep} 82%, #24221f)`,
    "--k-accent-pale": ramp.tint,
  } as CSSProperties;
}

/** The apps someone can open, in the shape the rail and the grid need. */
export async function railApps(username: string): Promise<(RailApp & { mobileApp?: import("@/lib/apps").KimonoApp["mobileApp"] })[]> {
  const [settings, catalog] = await Promise.all([getPlatformSettings(), scanAppDefinitions()]);
  return launcherApps(appRegistry(settings, catalog.definitions), { mesh: await holdsMeshAccess(username) })
    .map((app) => ({ id: app.id, name: app.shortName, description: app.description, href: app.href, external: app.external, accent: app.accent, glyph: app.glyph, iconUrl: app.iconUrl, mobileApp: app.mobileApp }));
}

export async function AppShell({ children, user, active, app, rooms }: Props) {
  /* Recording who signs in is what lets an administrator grant Kimono VPN to a
     real account instead of typing a username and hoping. */
  await recordAccount(user);
  const displayName = user.name?.trim() || user.username;
  /* Kimono's own picture first; the identity provider's only if none was set here. */
  const picture = await picturePathFor(user.username) ?? user.image ?? null;
  const apps = await railApps(user.username);
  const admin = user.role === "owner" || user.role === "admin";
  return (
    <div className={cx("app-frame", app && "in-app")} style={app ? appPalette(app) : undefined}>
      <Rail
        apps={apps}
        current={app?.id}
        rooms={rooms}
        active={active}
        admin={admin}
        defaultPins={defaultPins(apps)}
        you={<InkPortraitFrame seed={user.username} weight={6}><Portrait name={displayName} username={user.username} picture={picture} size={26} /></InkPortraitFrame>}
      />
      <main className="main-content">
        <PageTransition>
          {active === "admin" && admin ? <div className="admin-update"><UpdateBanner username={user.username} /></div> : null}
          {children}
        </PageTransition>
      </main>
    </div>
  );
}
