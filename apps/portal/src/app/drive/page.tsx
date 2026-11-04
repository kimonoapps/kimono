import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { driveConfig, driveIdentity } from "@/lib/drive/config";
import { getPlatformSettings } from "@/lib/settings";
import { DriveApp } from "./drive-app";
import "./drive.css";

export const metadata = { title: "Kimono Drive" };

/** Kimono Drive on the web: the spaces you share files in. */
export default async function DrivePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const settings = await getPlatformSettings();
  if (!driveConfig(settings).enabled) redirect(session.user.role === "owner" || session.user.role === "admin" ? "/admin/apps/kimono-drive" : "/");
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={await driveIdentity(settings)}>
    <Suspense>
      <DriveApp me={{ username: session.user.username, name: session.user.name || session.user.username }} />
    </Suspense>
  </AppShell>;
}
