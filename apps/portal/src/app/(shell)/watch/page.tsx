import { appOffer } from "@/lib/app-offer";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { signOutCompletely } from "@/lib/sign-out";
import { AppShell } from "@/components/app-shell";
import { picturePaths } from "@/lib/pictures";
import { getPlatformSettings } from "@/lib/settings";
import { watchConfig, watchIdentity } from "@/lib/watch/config";
import type { Person } from "./watch-app";
import { WatchEntry, WatchOff } from "./watch-entry";
import "./watch.css";

/* Watch's own tab: its name once (not "· Kimono" again); its icon comes from ./layout.tsx. */
export const metadata: Metadata = { title: { absolute: "Kimono Watch" } };

/** Kimono Watch on the web: the household's films, series and anime, played in the browser. */
/* Signing out from Watch's settings: the whole session, as the account page does. */
async function signOut() {
  "use server";
  await signOutCompletely();
  redirect("/login");
}

export default async function WatchPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const settings = await getPlatformSettings();
  const admin = session.user.role === "owner" || session.user.role === "admin";
  if (!watchConfig(settings).enabled && admin) redirect("/admin/apps/kimono-watch");
  const app = await watchIdentity(settings);
  const [pictures, offer] = await Promise.all([picturePaths(), appOffer()]);
  const username = session.user.username;
  const me: Person = { username, name: session.user.name?.trim() || username, picture: pictures[username.toLowerCase()] ?? session.user.image ?? null };
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={app}>
    {watchConfig(settings).enabled ? <WatchEntry me={me} household={[me]} accent={app.accent} signOut={signOut} phoneApp={Boolean(offer.android) || offer.ios} /> : <WatchOff accent={app.accent} />}
  </AppShell>;
}
