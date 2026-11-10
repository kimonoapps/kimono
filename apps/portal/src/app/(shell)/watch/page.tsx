import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { signOutCompletely } from "@/lib/sign-out";
import { AppShell } from "@/components/app-shell";
import { listAccounts } from "@/lib/directory";
import { picturePaths } from "@/lib/pictures";
import { getPlatformSettings } from "@/lib/settings";
import { watchConfig, watchIdentity } from "@/lib/watch/config";
import type { Person } from "./watch-app";
import { WatchEntry, WatchOff } from "./watch-entry";
import "./watch.css";

/* Watch's own tab: its name once (not "· Kimono" again), and its bloom (./icon/[file]/route.ts). */
export const metadata: Metadata = {
  title: { absolute: "Kimono Watch" },
  icons: {
    icon: [
      { url: "/watch/icon/icon.svg", type: "image/svg+xml" },
      { url: "/watch/icon/48.png", sizes: "48x48", type: "image/png" },
      { url: "/watch/icon/32.png", sizes: "32x32", type: "image/png" },
      { url: "/watch/icon/16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: { url: "/watch/icon/180.png", sizes: "180x180" },
  },
};

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
  const [accounts, pictures] = await Promise.all([listAccounts(), picturePaths()]);
  const username = session.user.username;
  const me: Person = { username, name: session.user.name?.trim() || username, picture: pictures[username.toLowerCase()] ?? session.user.image ?? null };
  /* One profile per person in the household, you first. */
  const others = accounts.filter((a) => a.username !== username).map((a) => ({ username: a.username, name: a.name || a.username, picture: pictures[a.username.toLowerCase()] ?? null }));
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={app}>
    {watchConfig(settings).enabled ? <WatchEntry me={me} household={[me, ...others].slice(0, 6)} accent={app.accent} signOut={signOut} /> : <WatchOff accent={app.accent} />}
  </AppShell>;
}
