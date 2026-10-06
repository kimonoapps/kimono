import { AppShell } from "@/components/app-shell";
import { AppLauncher } from "@/components/app-card";
import { appRegistry, launcherApps } from "@/lib/apps";
import { getPlatformSettings } from "@/lib/settings";
import { scanAppDefinitions } from "@/lib/definitions";
import { auth } from "@/auth";
import { holdsMeshAccess } from "@/lib/directory";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [settings, catalog] = await Promise.all([getPlatformSettings(), scanAppDefinitions()]);

  const displayName = session.user.name?.split(" ")[0] || session.user.username || "home";

  return (
    <AppShell user={session.user} brandColors={settings.brand.colors} >
      <div className="page home-page">
        <header className="home-hero">
          <div className="hero-copy">
            <p className="hero-kicker">Your household</p>
            <h1>Welcome home, <strong>{displayName}.</strong></h1>
          </div>
        </header>
        <AppLauncher apps={launcherApps(appRegistry(settings, catalog.definitions), {
          mesh: await holdsMeshAccess(session.user.username),
        })} />
      </div>
    </AppShell>
  );
}
