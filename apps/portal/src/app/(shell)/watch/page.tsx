import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { getPlatformSettings } from "@/lib/settings";
import { watchConfig, watchIdentity } from "@/lib/watch/config";

export const metadata = { title: "Kimono Watch" };

/** Kimono Watch on the web. The phone and TV apps come first; this page grows into the web player. */
export default async function WatchPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const settings = await getPlatformSettings();
  const admin = session.user.role === "owner" || session.user.role === "admin";
  if (!watchConfig(settings).enabled && admin) redirect("/admin/apps/kimono-watch");
  const app = await watchIdentity(settings);
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={app}>
    <div style={{ display: "grid", placeItems: "center", minHeight: "60vh", textAlign: "center", padding: "0 16px" }}>
      <p>{watchConfig(settings).enabled ? "Watch on your phone or TV." : "Watch isn't switched on."}</p>
    </div>
  </AppShell>;
}
