import { Compartment, Seal, SealLink, StatedSeal, Tray } from "@kimono/ui";
import { auth } from "@/auth";
import { AdminNavigation } from "@/components/admin-navigation";
import { AppShell } from "@/components/app-shell";
import { scanAppDefinitions } from "@/lib/definitions";
import { renderDeploymentPlan } from "@/lib/deployment";
import { planDigest, readReconcilerStatus } from "@/lib/desired-state";
import { createDirectTunnel, getPlatformSettings, saveTunnel, tunnelIsReady } from "@/lib/settings";
import { getTunnelProvider, listTunnelProviders } from "@/lib/tunnel-providers";
import Image from "next/image";
import { RunJoint } from "@/components/run-joint";
import { redirect } from "next/navigation";

export const metadata = { title: "Connectivity · Admin" };

export default async function InfrastructurePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/");
  const [settings, scan, query, deployment] = await Promise.all([getPlatformSettings(), scanAppDefinitions(), searchParams, readReconcilerStatus()]);
  const tunnelProviders = listTunnelProviders();
  const tunnels = Object.values(settings.tunnels);
  const plan = renderDeploymentPlan(settings, scan.definitions);
  const digest = planDigest(plan);
  /* Anything the reconciler has not caught up to yet is still on its way. */
  const deploymentState = !deployment || deployment.planDigest !== digest ? "pending" : deployment.state;
  const deploymentLabel = { pending: "Deploying", applying: "Deploying", ready: "Live", failed: "Needs attention" }[deploymentState] || "Deploying";
  const deploymentMessage = deploymentState === "pending"
    ? "Your latest changes are being rolled out to the server."
    : deployment?.message || "";

  async function addDirect() {
    "use server";
    const current = await auth();
    if (!current?.user || (current.user.role !== "owner" && current.user.role !== "admin")) redirect("/");
    try { await createDirectTunnel("Direct"); }
    catch (error) { redirect(`/admin/infrastructure?error=${encodeURIComponent(error instanceof Error ? error.message : "Connection could not be created")}`); }
    redirect("/admin/infrastructure?saved=1");
  }

  async function updateTunnel(form: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user || (current.user.role !== "owner" && current.user.role !== "admin")) redirect("/");
    try { await saveTunnel(form); }
    catch (error) { redirect(`/admin/infrastructure?error=${encodeURIComponent(error instanceof Error ? error.message : "Connection could not be saved")}`); }
    redirect("/admin/infrastructure?saved=1");
  }

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page admin-page">
      <AdminNavigation active="infrastructure" />
      <header className="admin-workspace-header">
        <div><h1>Connectivity</h1><p>Publish apps securely outside your home.</p></div>
        <SealLink href="/admin/apps?intent=publish">Publish an app</SealLink>
      </header>

      <Compartment label="Deployment" wants={deploymentState === "failed"}>
        <div className="connection-body">
          <div className="connection-body-copy">
            <span className="connection-name"><h3>Server state</h3><StatedSeal state={deploymentState === "ready" ? "running" : deploymentState === "failed" ? "wants" : "private"}>{deploymentLabel}</StatedSeal></span>
            <p>{deploymentMessage}</p>
            {deployment?.failedActions?.length ? <ul className="plan-warnings">{deployment.failedActions.map((action) => <li key={action}>{action}</li>)}</ul> : null}
          </div>
        </div>
      </Compartment>

      {query.saved ? <p className="admin-notice success">Connection saved.</p> : null}
      {query.error ? <p className="admin-notice error">{query.error}</p> : null}

      <main className="connectivity-workspace">
        <header className="workspace-section-heading">
          <div><h2>Your connections</h2><p>Apps use these encrypted connections when you publish them.</p></div>
          <span>{tunnels.length} {tunnels.length === 1 ? "connection" : "connections"}</span>
        </header>

        {tunnels.length ? <Tray className="connection-tray">{tunnels.map((tunnel) => {
          const connected = tunnelIsReady({ ...tunnel, enabled: true });
          const assignedApps = Object.values(settings.apps).filter((app) => app.tunnelId === tunnel.id);
          /* A connection that still needs your hands wants the tab. Nothing else does. */
          const state = connected && tunnel.enabled ? "running" as const : connected ? "private" as const : "wants" as const;
          const stateLabel = connected && tunnel.enabled ? "Connected" : connected ? "Paused" : "Setup needed";
          return <Compartment key={tunnel.id} label={getTunnelProvider(tunnel.provider)?.name || tunnel.provider} wants={!connected}>
            <div className="connection-body">
              <div className="connection-body-copy">
                <span className="connection-name"><h3>{tunnel.name}</h3><StatedSeal state={state}>{stateLabel}</StatedSeal></span>
                {assignedApps.length
                  ? <ul className="connection-apps">{assignedApps.map((app) => <li key={app.id}><Image src={`/api/app-definitions/${app.id}/icon`} alt="" width={28} height={28} unoptimized />{app.name}</li>)}</ul>
                  : <p>Not used by an app yet</p>}
              </div>
              {tunnel.provider === "cloudflare" ? <SealLink href={`/admin/infrastructure/cloudflare?id=${encodeURIComponent(tunnel.id)}`} tone={connected ? "quiet" : "primary"}>{connected ? "Manage" : "Finish setup"}</SealLink> : null}
            </div>
          </Compartment>;
        })}</Tray> : <div className="connectivity-empty"><h2>No connections yet</h2><p>Start by choosing an app to publish. Kimono will guide you through the connection only when it is needed.</p><SealLink href="/admin/apps?intent=publish">Choose an app</SealLink></div>}

        <details className="admin-technical-details">
          <summary><span><strong>Technical settings</strong><small>Credentials, additional connections, and deployment output</small></span></summary>
          <div className="technical-details-body">
            <div className="technical-section-heading"><h3>Connections</h3>
              <span className="technical-section-actions">
                <form action={addDirect}><Seal type="submit" tone="quiet">Add direct connection</Seal></form>
                <SealLink href="/admin/infrastructure/cloudflare" tone="quiet">Connect Cloudflare</SealLink>
              </span>
            </div>
            <div className="resource-list">{tunnels.map((tunnel) => <details key={tunnel.id}>
              <summary><span><strong>{tunnel.name}</strong><code>{tunnel.id}</code></span><span>{tunnel.provider}</span></summary>
              <form action={updateTunnel} className="compact-resource-form">
                <input type="hidden" name="id" value={tunnel.id} />
                <RunJoint defaultChecked={tunnel.enabled} label="Use this connection" />
                <label><span>Name</span><input name="name" defaultValue={tunnel.name} required /></label>
                <label><span>Provider</span><select name="provider" defaultValue={tunnel.provider}>{tunnelProviders.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}</select></label>
                <div className="form-divider">Remote connector</div>
                <label><span>Tunnel token</span><input name="TUNNEL_TOKEN" type="password" placeholder={tunnel.configuration.TUNNEL_TOKEN ? "Configured — leave blank to keep" : ""} /></label>
                <div className="form-divider">Local connector</div>
                <label><span>Tunnel ID</span><input name="TUNNEL_ID" defaultValue={tunnel.configuration.TUNNEL_ID?.value} /></label>
                <label><span>Credentials file</span><input name="CREDENTIALS_FILE" defaultValue={tunnel.configuration.CREDENTIALS_FILE?.value} /></label>
                <Seal type="submit">Save</Seal>
              </form>
            </details>)}</div>
            <details className="runtime-preview">
              <summary><span><strong>Server runtime</strong><small>{Object.keys(plan.compose.services).length} services · {plan.warnings.length} warnings</small></span><span>View output</span></summary>
              <div className="plan-actions"><a className="k-seal k-tone-quiet" href="/api/deployment" target="_blank" rel="noreferrer">Open raw plan ↗</a></div>
              {plan.warnings.length ? <ul className="plan-warnings">{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
              <pre>{JSON.stringify(plan, null, 2)}</pre>
            </details>
          </div>
        </details>
      </main>
    </div>
  </AppShell>;
}
