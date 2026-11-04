import { AppShell, railApps } from "@/components/app-shell";
import { AppTiles } from "@/components/app-card";
import { getPlatformSettings } from "@/lib/settings";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { KimonoAppOffer } from "@/components/kimono-app-offer";
import { appOffer } from "@/lib/app-offer";
import { homeLines } from "@/lib/home-lines";

/* Home is the app grid: every app lives here, and pinning one puts it in the rail. */
export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [settings, apps, offer] = await Promise.all([getPlatformSettings(), railApps(session.user.username), appOffer()]);
  const lines = homeLines(session.user.username, apps.map((app) => app.id));
  const tiles = apps.map((app) => ({ ...app, line: lines[app.id] }));
  const displayName = session.user.name?.split(" ")[0] || session.user.username || "home";

  return (
    <AppShell user={session.user} brandColors={settings.brand.colors} active="home">
      <div className="page home-page">
        <header className="home-greeting">
          <p className="hero-kicker">Your household</p>
          <h1>Welcome home, <strong>{displayName}.</strong></h1>
        </header>
        <AppTiles apps={tiles} />
        <KimonoAppOffer android={Boolean(offer.android)} ios={offer.ios} />
      </div>
    </AppShell>
  );
}
