import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { driveConfig, driveIdentity } from "@/lib/drive/config";
import { getPlatformSettings } from "@/lib/settings";
import { DriveApp } from "./drive-app";
import "./drive.css";

export const metadata = { title: { absolute: "Kimono Drive" } };

/** Kimono Drive on the web: the spaces you share files in. */
export default async function DrivePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const settings = await getPlatformSettings();
  if (!driveConfig(settings).enabled) redirect(session.user.role === "owner" || session.user.role === "admin" ? "/admin/apps/kimono-drive" : "/");
  const { view } = await searchParams;
  /* Drive's rooms sit under its pin in the rail, as in the mockup. */
  const rooms = [
    { href: "/drive", label: "Spaces", here: !view },
    { href: "/drive?view=shared", label: "Shared with you", here: view === "shared" },
    { href: "/drive?view=recent", label: "Recent", here: view === "recent" },
    { href: "/drive?view=trash", label: "Trash", here: view === "trash" },
  ];
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={await driveIdentity(settings)} rooms={rooms}>
    <Suspense>
      <DriveApp me={{ username: session.user.username, name: session.user.name || session.user.username }} />
    </Suspense>
  </AppShell>;
}
