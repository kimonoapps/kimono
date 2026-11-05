import { Crossing, CrossingSeal } from "@/components/crossing";
import { AppBloom, Choice, InkBlot, InkCard, Seal } from "@kimono/ui";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { HoldSeal } from "@/components/hold-seal";
import { JointSwitch } from "@/components/joint-switch";
import { LineIcon } from "@/components/line-icon";
import { appIdentity, appRegistry } from "@/lib/apps";
import { scanAppDefinitions } from "@/lib/definitions";
import { renderDeploymentPlan } from "@/lib/deployment";
import { planDigest, readReconcilerStatus } from "@/lib/desired-state";
import { createDirectTunnel, deleteTunnel, renameTunnel, getPlatformSettings, saveTunnel, tunnelIsReady } from "@/lib/settings";
import { getTunnelProvider, listTunnelProviders } from "@/lib/tunnel-providers";
import { redirect } from "next/navigation";

export const metadata = { title: "Connectivity · Admin" };

const list = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * Connectivity (design/mockups/m3-everywhere.html): server state is one dot at
 * the top. Each connection is a card showing the apps that use it as blooms.
 * Renaming and deleting open from ⋯; deleting is held, because it takes apps
 * offline. Tokens and the raw plan sit behind "For troubleshooting".
 */
export default async function InfrastructurePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; sheet?: string; id?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/");
  const [settings, scan, query, deployment] = await Promise.all([getPlatformSettings(), scanAppDefinitions(), searchParams, readReconcilerStatus()]);
  const tunnelProviders = listTunnelProviders();
  const tunnels = Object.values(settings.tunnels);
  const registry = new Map(appRegistry(settings, scan.definitions).map((app) => [app.id, app]));
  const plan = renderDeploymentPlan(settings, scan.definitions);
  const digest = planDigest(plan);
  /* Anything the reconciler has not caught up to yet is still on its way. */
  const deploymentState = !deployment || deployment.planDigest !== digest ? "pending" : deployment.state;
  const live = { pending: "Deploying", applying: "Deploying", ready: "Server live", failed: "Server needs you" }[deploymentState] || "Deploying";
  const managed = query.sheet === "manage" ? settings.tunnels[query.id || ""] : undefined;
  const managedApps = managed ? Object.values(settings.apps).filter((app) => app.tunnelId === managed.id) : [];

  async function requireAdmin() {
    "use server";
    const current = await auth();
    if (!current?.user || !["owner", "admin"].includes(current.user.role)) redirect("/");
  }
  async function addDirect() {
    "use server";
    await requireAdmin();
    try { await createDirectTunnel("Direct"); }
    catch (error) { redirect(`/admin/infrastructure?sheet=tokens&error=${encodeURIComponent(error instanceof Error ? error.message : "Connection could not be created")}`); }
    redirect("/admin/infrastructure?sheet=tokens&saved=1");
  }
  async function updateTunnel(form: FormData) {
    "use server";
    await requireAdmin();
    try { await saveTunnel(form); }
    catch (error) { redirect(`/admin/infrastructure?sheet=tokens&error=${encodeURIComponent(error instanceof Error ? error.message : "Connection could not be saved")}`); }
    redirect("/admin/infrastructure?saved=1");
  }
  async function manageTunnel(form: FormData) {
    "use server";
    await requireAdmin();
    const id = String(form.get("id") || "");
    try {
      if (form.get("action") === "rename") await renameTunnel(id, String(form.get("name") || ""));
      else if (form.get("action") === "delete") await deleteTunnel(id, form.get("confirmed") === "on");
      else throw new Error("Unknown connection action");
    } catch (error) { redirect(`/admin/infrastructure?sheet=manage&id=${encodeURIComponent(id)}&error=${encodeURIComponent(error instanceof Error ? error.message : "Connection could not be changed")}`); }
    redirect("/admin/infrastructure?saved=1");
  }

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page connectivity-page">
      <div className="topbar">
        <Crossing kind="kakejiku" className="back" href="/admin" aria-label="Back to Admin"><LineIcon name="back" /></Crossing>
        <span><h1>Connectivity</h1><p className="sub">Publish apps securely outside your home.</p></span>
        <div className="end"><span className={deploymentState === "ready" ? "k-ink-dot k-running" : deploymentState === "failed" ? "k-ink-dot k-wants" : "k-ink-dot"} title={deploymentState === "pending" ? "Your latest changes are being rolled out to the server." : deployment?.message}>{live}</span></div>
      </div>
      {query.saved && !query.sheet ? <p role="status" className="app-notice">Connection saved.</p> : null}
      {query.error && !query.sheet ? <p role="alert" className="app-notice is-error">{query.error}</p> : null}
      {deploymentState === "failed" ? <InkCard colour="#a84d63" seed="deploy-failed"><div className="card" style={{ background: "var(--primary-container)", color: "var(--on-primary-container)" }}>
        <b>The server couldn&rsquo;t apply your latest changes</b>
        {deployment?.message ? <p style={{ fontSize: 15 }}>{deployment.message}</p> : null}
        {deployment?.failedActions?.length ? <ul className="plan-warnings">{deployment.failedActions.map((action) => <li key={action}>{action}</li>)}</ul> : null}
      </div></InkCard> : null}

      <div className="label">Your connections</div>
      <div className="cols connection-cols">
        {tunnels.map((tunnel) => {
          const connected = tunnelIsReady({ ...tunnel, enabled: true });
          const apps = Object.values(settings.apps).filter((app) => app.tunnelId === tunnel.id).map((app) => registry.get(app.id)).filter((app) => app !== undefined);
          const provider = getTunnelProvider(tunnel.provider)?.name || tunnel.provider;
          const account = tunnel.configuration.ACCOUNT_NAME?.value;
          return <div className="card white connection-card" key={tunnel.id}>
            <div className="connection-head">
              <InkBlot tint={tunnel.provider === "cloudflare" ? "#c25a00" : "#74565c"} seed={`tunnel-${tunnel.id}`}><LineIcon name="cloud" /></InkBlot>
              <span className="connection-name"><b>{tunnel.name}</b><small>{provider}{account ? ` · ${account}` : ""}</small></span>
              <span className={connected && tunnel.enabled ? "k-ink-dot k-running" : connected ? "k-ink-dot" : "k-ink-dot k-wants"}>{connected && tunnel.enabled ? "Connected" : connected ? "Paused" : "Setup needed"}</span>
              <Crossing kind="kakejiku" className="iconbtn" href={`/admin/infrastructure?sheet=manage&id=${encodeURIComponent(tunnel.id)}`} aria-label={`Rename or delete ${tunnel.name}`}>⋯</Crossing>
            </div>
            <div className="connection-apps">
              {apps.length ? <span className="bloom-stack">{apps.slice(0, 4).map((app) => <AppBloom key={app.id} className="bloom" identity={appIdentity(app)} glyphHref={app.iconUrl} size="mark" />)}</span> : null}
              <span className="connection-use">{apps.length ? `${list(apps.map((app) => app.shortName || app.name))} ${apps.length === 1 ? "uses" : "use"} this` : "No app uses this yet"}</span>
              {tunnel.provider === "cloudflare" ? <Crossing kind="kakejiku" className="txt" href={`/admin/infrastructure/cloudflare?id=${encodeURIComponent(tunnel.id)}`}>{connected ? "Manage" : "Finish setup"}</Crossing> : null}
            </div>
          </div>;
        })}
        <InkCard colour="#4e2b37" seed="add-connection" className="connection-add-ink"><div className="card connection-add">
          <InkBlot tint="#74565c" seed="add-connection"><LineIcon name="plus" /></InkBlot>
          <b>Add a connection</b>
          <p>Sign in to Cloudflare and Kimono creates a tunnel with its own credentials.</p>
          <CrossingSeal href="/admin/infrastructure/cloudflare">Connect Cloudflare</CrossingSeal>
        </div></InkCard>
      </div>

      <div className="label">For troubleshooting</div>
      <div className="seg">
        <Crossing kind="kakejiku" className="row" href="/admin/infrastructure?sheet=tokens"><InkBlot tint="#8a7c77" seed="tokens"><LineIcon name="key" /></InkBlot><span className="text"><b>Tokens and direct connections</b><small>Tunnel tokens, credentials files, add a direct connection</small></span><span className="go" /></Crossing>
        <Crossing kind="kakejiku" className="row" href="/admin/infrastructure?sheet=runtime"><InkBlot tint="#8a7c77" seed="runtime"><LineIcon name="gear" /></InkBlot><span className="text"><b>Server runtime</b><small>{Object.keys(plan.compose.services).length} services · {plan.warnings.length} warning{plan.warnings.length === 1 ? "" : "s"} · raw plan</small></span><span className="go" /></Crossing>
      </div>

      {managed ? <div className="scrim open"><div className="sheet">
        <span className="handle" />
        <h3>{managed.name}</h3>
        {query.error ? <p role="alert" className="app-notice is-error">{query.error}</p> : null}
        <form action={manageTunnel} className="sheet-row">
          <input type="hidden" name="id" value={managed.id} />
          <input type="hidden" name="action" value="rename" />
          <label className="field"><small>Connection name</small><input name="name" defaultValue={managed.name} required maxLength={120} /></label>
          <Seal type="submit" tone="quiet">Rename</Seal>
        </form>
        <span className="pw-rule" aria-hidden="true" />
        <form action={manageTunnel} className="sheet-danger">
          <input type="hidden" name="id" value={managed.id} />
          <input type="hidden" name="action" value="delete" />
          <input type="hidden" name="confirmed" value="on" />
          <b>Delete this connection</b>
          <p className="lead">This removes {managed.name} from Kimono and stops its public routes. Apps and their data are kept.{managed.provider === "cloudflare" ? " The tunnel and DNS records stay in Cloudflare; remove them there if you no longer need them." : ""}</p>
          {managedApps.length ? <p className="sheet-warning">{list(managedApps.map((app) => app.name))} will stop working outside your home.{managedApps.some((app) => app.definitionId === "kimono-portal") ? " That includes this portal, so you'll only reach it from home or Kimono VPN." : ""}</p> : null}
          <HoldSeal label="Hold to delete" holdingLabel="Keep holding to delete" />
        </form>
        <div className="sheet-actions"><Crossing kind="kakejiku" className="k-seal k-tone-quiet" href="/admin/infrastructure">Done</Crossing></div>
      </div></div> : null}

      {query.sheet === "tokens" ? <div className="scrim open"><div className="sheet tall">
        <span className="handle" />
        <h3>Tokens and direct connections</h3>
        <p className="lead">For troubleshooting. Cloudflare sign-in sets all of this for you.</p>
        {query.error ? <p role="alert" className="app-notice is-error">{query.error}</p> : null}
        {tunnels.map((tunnel) => <details className="card low token-card" key={tunnel.id}>
          <summary><b>{tunnel.name}</b><code>{tunnel.id}</code></summary>
          <form action={updateTunnel} className="token-form">
            <input type="hidden" name="id" value={tunnel.id} />
            <div className="pw-switch"><span><b>Use this connection</b></span><JointSwitch name="enabled" defaultChecked={tunnel.enabled} label="Use this connection" /></div>
            <div className="sheet-pair">
              <label className="field"><small>Name</small><input name="name" defaultValue={tunnel.name} required /></label>
              <Choice label="Provider" name="provider" defaultValue={tunnel.provider} options={tunnelProviders.map((provider) => ({ value: provider.id, label: provider.name }))} />
            </div>
            <label className="field"><small>Tunnel token (remote connector)</small><input name="TUNNEL_TOKEN" type="password" placeholder={tunnel.configuration.TUNNEL_TOKEN ? "Configured, leave blank to keep" : ""} /></label>
            <div className="sheet-pair">
              <label className="field"><small>Tunnel ID (local connector)</small><input name="TUNNEL_ID" defaultValue={tunnel.configuration.TUNNEL_ID?.value} /></label>
              <label className="field"><small>Credentials file</small><input name="CREDENTIALS_FILE" defaultValue={tunnel.configuration.CREDENTIALS_FILE?.value} /></label>
            </div>
            <div className="sheet-actions"><Seal type="submit">Save</Seal></div>
          </form>
        </details>)}
        <div className="sheet-actions">
          <form action={addDirect}><Seal type="submit" tone="quiet">Add direct connection</Seal></form>
          <Crossing kind="kakejiku" className="k-seal" href="/admin/infrastructure">Done</Crossing>
        </div>
      </div></div> : null}

      {query.sheet === "runtime" ? <div className="scrim open"><div className="sheet tall">
        <span className="handle" />
        <h3>Server runtime</h3>
        <p className="lead">{Object.keys(plan.compose.services).length} services · {plan.warnings.length} warning{plan.warnings.length === 1 ? "" : "s"}</p>
        {plan.warnings.length ? <ul className="plan-warnings">{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        <pre className="raw-plan">{JSON.stringify(plan, null, 2)}</pre>
        <div className="sheet-actions">
          <CrossingSeal href="/api/deployment" tone="quiet" target="_blank" rel="noreferrer">Open raw plan</CrossingSeal>
          <Crossing kind="kakejiku" className="k-seal" href="/admin/infrastructure">Done</Crossing>
        </div>
      </div></div> : null}
    </div>
  </AppShell>;
}
