import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { appOffer } from "@/lib/app-offer";
import { getPlatformSettings } from "@/lib/settings";
import { AppGuide } from "./app-guide";
import "./get-app.css";

export const metadata = { title: "Get the app" };

/** How to get the Kimono app on this phone, one step at a time. */
export default async function GetAppPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [settings, offer, query] = await Promise.all([getPlatformSettings(), appOffer(), searchParams]);
  const asked = query.for === "ios" || query.for === "android" ? query.for : null;
  return <AppShell user={session.user} brandColors={settings.brand.colors}>
    <div className="page get-app-page">
      <AppGuide offer={offer} asked={asked} email={session.user.email ?? null} />
    </div>
  </AppShell>;
}
