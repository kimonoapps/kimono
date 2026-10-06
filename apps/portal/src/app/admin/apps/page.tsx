import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { appRegistry, catalogApps } from "@/lib/apps";
import { AdminNavigation } from "@/components/admin-navigation";
import { scanAppDefinitions } from "@/lib/definitions";
import { getPlatformSettings } from "@/lib/settings";
import { redirect } from "next/navigation";
import { AppsCatalog } from "./apps-catalog";
import { PageHeader } from "@kimono/ui";

export const metadata = { title: "Applications · Admin" };

export default async function AdminAppsPage({ searchParams }: { searchParams: Promise<{ intent?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/");

  const [settings, scan, query] = await Promise.all([getPlatformSettings(), scanAppDefinitions(), searchParams]);
  const apps = catalogApps(appRegistry(settings, scan.definitions), query.intent === "publish" ? "publish" : undefined);

  return (
    <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
      <div className="page admin-page">
        <AdminNavigation active="apps" />
        <PageHeader
          title={query.intent === "publish" ? "Publish an app" : "Applications"}
          description={query.intent === "publish" ? "Choose the app you want to make available outside your home." : "Configure, publish, and manage the apps on this server."}
        />

        {scan.errors.length ? (
          <details className="scan-errors" open>
            <summary>{scan.errors.length} definition {scan.errors.length === 1 ? "error" : "errors"}</summary>
            <ul>{scan.errors.map((error) => <li key={error}>{error}</li>)}</ul>
          </details>
        ) : null}
        <AppsCatalog apps={apps} intent={query.intent === "publish" ? "publish" : undefined} />
      </div>
    </AppShell>
  );
}
