import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { listAccounts } from "@/lib/directory";
import { picturePaths } from "@/lib/pictures";
import { getPlatformSettings } from "@/lib/settings";
import { watchConfig, watchIdentity } from "@/lib/watch/config";
import type { Person } from "./watch-app";
import { WatchEntry, WatchOff } from "./watch-entry";
import "./watch.css";

export const metadata = { title: "Kimono Watch" };

/** Kimono Watch on the web: the household's films, series and anime, played in the browser. */
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
    {watchConfig(settings).enabled ? <WatchEntry me={me} household={[me, ...others].slice(0, 6)} /> : <WatchOff />}
  </AppShell>;
}
