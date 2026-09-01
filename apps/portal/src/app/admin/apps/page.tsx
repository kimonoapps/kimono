import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { accentOf } from "@/lib/apps";
import { AdminNavigation } from "@/components/admin-navigation";
import { scanAppDefinitions } from "@/lib/definitions";
import { getPlatformSettings, tunnelIsReady } from "@/lib/settings";
import { redirect } from "next/navigation";
import { AppsCatalog, type CatalogApp } from "./apps-catalog";

export const metadata = { title: "Applications · Admin" };

export default async function AdminAppsPage({ searchParams }: { searchParams: Promise<{ intent?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/");

  const [settings, scan, query] = await Promise.all([getPlatformSettings(), scanAppDefinitions(), searchParams]);
  const apps: CatalogApp[] = scan.definitions.filter((definition) => definition.metadata.id !== "kimono-portal").map((definition) => {
    const instance = settings.apps[definition.metadata.id];
    const tunnel = instance?.tunnelId ? settings.tunnels[instance.tunnelId] : undefined;
    const tunnelConnected = tunnelIsReady(tunnel);
    const endpoint = definition.spec.services.some((service) => service.endpoint);
    const route = instance ? Object.values(settings.routes).find((candidate) => candidate.appId === instance.id && candidate.tunnelId === instance.tunnelId) : undefined;
    let state: CatalogApp["state"] = "available";
    let stateLabel = "Available";
    let stateDetail = "Not installed";
    if (instance) {
      if (!instance.enabled) { state = "disabled"; stateLabel = "Disabled"; stateDetail = "Installed, but not running"; }
      else if (definition.metadata.id === "kimono-portal") { state = "system"; stateLabel = "System"; stateDetail = "Kimono administration"; }
      else if (!instance.tunnelId) { state = "private"; stateLabel = "Private"; stateDetail = "Running without a public tunnel"; }
      else if (!tunnel) { state = "problem"; stateLabel = "Needs attention"; stateDetail = "Selected tunnel no longer exists"; }
      else if (!tunnelConnected) { state = "problem"; stateLabel = "Needs attention"; stateDetail = `${tunnel.name} is not connected`; }
      else if (endpoint && !route?.enabled) { state = "problem"; stateLabel = "Needs attention"; stateDetail = "Public route is not active"; }
      else { state = "public"; stateLabel = "Public"; stateDetail = `Through ${tunnel.name}`; }
    }
    return {
      id: definition.metadata.id,
      name: instance?.name || definition.metadata.name,
      description: definition.metadata.description,
      category: definition.metadata.category,
      version: definition.metadata.version,
      source: definition.source,
      iconUrl: definition.iconUrl,
      accent: accentOf(instance?.colors || definition.metadata.colors),
      installed: Boolean(instance),
      enabled: instance?.enabled || false,
      state,
      stateLabel,
      stateDetail,
      hostname: instance && state === "public" ? instance.domain.includes(".") ? instance.domain : `${instance.domain}.${settings.baseDomain}` : undefined,
    };
  });

  return (
    <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
      <div className="page admin-page">
        <AdminNavigation active="apps" />
        <header className="admin-list-header">
          <div>
            <h1>{query.intent === "publish" ? "Publish an app" : "Applications"}</h1>
            <p>{query.intent === "publish" ? "Choose the app you want to make available outside your home." : "Install, publish, and manage the apps on this server."}</p>
          </div>
        </header>

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
