import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { identityOf, ownApp } from "@/lib/kimono-apps";
import { getPlatformSettings } from "@/lib/settings";
import { DriveApp } from "./drive-app";
import "./drive.css";

export const metadata = { title: "Kimono Drive" };

/** Kimono Drive on the web: the spaces you share files in. */
export default async function DrivePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const settings = await getPlatformSettings();
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={identityOf(ownApp("kimono-drive"))}>
    <Suspense>
      <DriveApp me={{ username: session.user.username, name: session.user.name || session.user.username }} />
    </Suspense>
  </AppShell>;
}
