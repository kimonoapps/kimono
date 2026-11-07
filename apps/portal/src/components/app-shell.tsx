import { cache } from "react";
import type { AppIdentity } from "@kimono/ui";
import type { Palette } from "@/lib/settings";
import { holdsMeshAccess } from "@/lib/directory";
import { UpdateBanner } from "@/components/update-banner";
import type { RailApp, RailRoom } from "@/components/rail";
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
  /** The app this page belongs to. The frame reads it from the address; kept so pages say what they are. */
  app?: AppIdentity;
  /** Unused: the frame lists each app's rooms (app/(shell)/layout.tsx). */
  rooms?: RailRoom[];
};

/** The apps someone can open, in the shape the rail and the grid need. */
/* The layout and the home page both ask during one render; they share the answer. */
export const railApps = cache(async (username: string): Promise<(RailApp & { mobileApp?: import("@/lib/apps").KimonoApp["mobileApp"] })[]> => {
  const [settings, catalog, mesh] = await Promise.all([getPlatformSettings(), scanAppDefinitions(), holdsMeshAccess(username)]);
  return launcherApps(appRegistry(settings, catalog.definitions), { mesh })
    .map((app) => ({ id: app.id, name: app.shortName, description: app.description, href: app.href, external: app.external, accent: app.accent, glyph: app.glyph, iconUrl: app.iconUrl, mobileApp: app.mobileApp }));
});

/**
 * A signed-in page's part of the frame. The rail and the frame around the page
 * live in app/(shell)/layout.tsx so they persist between pages; which app this
 * is, its colour and its rooms are read there from the address. What's left
 * here is the page's own: the update notice on admin pages.
 */
export async function AppShell({ children, user, active }: Props) {
  const admin = user.role === "owner" || user.role === "admin";
  return <>
    {active === "admin" && admin ? <div className="admin-update"><UpdateBanner username={user.username} /></div> : null}
    {children}
  </>;
}
