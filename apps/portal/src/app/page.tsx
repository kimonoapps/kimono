import { AppShell } from "@/components/app-shell";
import { AppLauncher } from "@/components/app-card";
import { appRegistry, launcherApps } from "@/lib/apps";
import { getPlatformSettings } from "@/lib/settings";
import { scanAppDefinitions } from "@/lib/definitions";
import { auth } from "@/auth";
import { holdsMeshAccess } from "@/lib/directory";
import { redirect } from "next/navigation";
import { KimonoAppOffer } from "@/components/kimono-app-offer";
import { readReleases } from "@/lib/app-releases";
import { portalOrigin } from "@/lib/account";

/** Where the Kimono app looks unless told otherwise. */
const appDefault = "www.kimonolabs.dev";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [settings, catalog] = await Promise.all([getPlatformSettings(), scanAppDefinitions()]);

  const displayName = session.user.name?.split(" ")[0] || session.user.username || "home";
  const { releases, iosLink } = await readReleases();
  const newest = (platform: "android" | "ios") => releases.filter((r) => r.platform === platform).sort((a, b) => b.build - a.build)[0];
  const android = newest("android");
  const host = new URL(portalOrigin()).host;

  return (
    <AppShell user={session.user} brandColors={settings.brand.colors} >
      <div className="page home-page">
        <header className="home-hero">
          <div className="hero-copy">
            <p className="hero-kicker">Your household</p>
            <h1>Welcome home, <strong>{displayName}.</strong></h1>
          </div>
        </header>
        <KimonoAppOffer offer={{
          android: android ? { version: android.version, build: android.build, size: android.size ?? null } : null,
          ios: newest("ios") ? { link: iosLink } : null,
          address: host === appDefault || host === "kimonolabs.dev" ? null : host,
        }} />
        <AppLauncher apps={launcherApps(appRegistry(settings, catalog.definitions), {
          mesh: await holdsMeshAccess(session.user.username),
        })} />
      </div>
    </AppShell>
  );
}
