import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { appRegistry, catalogApps } from "@/lib/apps";
import { scanAppDefinitions } from "@/lib/definitions";
import { getPlatformSettings } from "@/lib/settings";
import { redirect } from "next/navigation";
import { AppsCatalog } from "./apps-catalog";

export const metadata = { title: "Applications · Admin" };

export default async function AdminAppsPage({ searchParams }: { searchParams: Promise<{ intent?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/");

  const [settings, scan, query] = await Promise.all([getPlatformSettings(), scanAppDefinitions(), searchParams]);
  const publish = query.intent === "publish";
  const apps = catalogApps(appRegistry(settings, scan.definitions), publish ? "publish" : undefined);

  return (
    <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
      <div className="page admin-apps">
        <div className="topbar">
          <Crossing kind="kakejiku" className="back" href={publish ? "/admin/apps" : "/admin"} aria-label={publish ? "Back to Applications" : "Back to Admin"}><LineIcon name="back" /></Crossing>
          <span><h1>{publish ? "Publish an app" : "Applications"}</h1><p className="sub">{publish ? "Choose the app you want to reach from outside your home." : "Configure, publish and manage the apps on this server."}</p></span>
          {publish ? null : <div className="end"><Crossing kind="kakejiku" className="k-seal k-tone-quiet" href="/admin/apps?intent=publish">Publish an app</Crossing></div>}
        </div>
        {scan.errors.length ? (
          <details className="scan-errors" open>
            <summary>{scan.errors.length} definition {scan.errors.length === 1 ? "error" : "errors"}</summary>
            <ul>{scan.errors.map((error) => <li key={error}>{error}</li>)}</ul>
          </details>
        ) : null}
        <AppsCatalog apps={apps} intent={publish ? "publish" : undefined} />
      </div>
    </AppShell>
  );
}
