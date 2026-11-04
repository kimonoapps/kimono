import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { codeConfig, codeIdentity, missing } from "@/lib/code/config";
import { getPlatformSettings } from "@/lib/settings";
import { CodeApp } from "./code-app";
import "./code.css";

export const metadata = { title: "Kimono Code" };

/** Kimono Code: coding agents working in their own sandbox on your Kimono Git repositories. */
export default async function CodePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const settings = await getPlatformSettings();
  const config = codeConfig(settings);
  const admin = session.user.role === "owner" || session.user.role === "admin";
  if (!config.enabled || !admin) redirect(admin ? "/admin/apps/kimono-code" : "/");
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={await codeIdentity(settings)}>
    <Suspense>
      <CodeApp blocked={missing(config)} />
    </Suspense>
  </AppShell>;
}
