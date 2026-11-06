import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { codeConfig, codeIdentity, missing } from "@/lib/code/config";
import { getPlatformSettings } from "@/lib/settings";
import { driveIdentity } from "@/lib/drive/config";
import { CodeApp } from "./code-app";
import "./code.css";

export const metadata = { title: "Kimono AI" };

/** Kimono AI: one assistant for the household, in a sandbox of its own; projects on Kimono Git for administrators. */
export default async function CodePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const settings = await getPlatformSettings();
  const config = codeConfig(settings);
  const admin = session.user.role === "owner" || session.user.role === "admin";
  if (!config.enabled) redirect(admin ? "/admin/apps/kimono-code" : "/");
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={await codeIdentity(settings)}>
    <Suspense>
      <CodeApp blocked={missing(config)} admin={admin} driveApp={await driveIdentity(settings)} me={session.user.username} />
    </Suspense>
  </AppShell>;
}
