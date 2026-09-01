import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { getAppDefinition, type ConfigurationField } from "@/lib/definitions";
import {
  appHostname,
  getPlatformSettings,
  installDefinition,
  saveAppEnvironment,
  saveAppSetup,
  savePlatformBrand,
  tunnelZones,
} from "@/lib/settings";
import { Compartment } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { DoorBack } from "@/components/door-back";
import { AppBloom } from "@kimono/ui";
import { accentOf } from "@/lib/apps";
import { RunJoint } from "@/components/run-joint";
import { Door, Seal, SealLink, StatedSeal } from "@kimono/ui";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type View = "setup" | "settings" | "environment" | "storage";
const views: Array<{ id: View; label: string }> = [
  { id: "setup", label: "Setup" },
  { id: "settings", label: "Settings" },
  { id: "environment", label: "Advanced" },
  { id: "storage", label: "Storage" },
];

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "owner" && session.user.role !== "admin")) redirect("/");
}

function EnvironmentInput({ field, value, configured }: { field: ConfigurationField; value: string; configured: boolean }) {
  const common = {
    id: `env-${field.key}`,
    name: `env.${field.key}`,
    defaultValue: field.kind === "secret" ? "" : value,
    placeholder: field.kind === "secret" && configured ? "Configured — leave blank to keep" : field.default,
  };
  if (field.kind === "toggle") return <input id={common.id} name={common.name} type="checkbox" defaultChecked={(value || field.default || "off") === "on"} />;
  if (field.kind === "select") return <select {...common}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>;
  return <input {...common} type={field.kind === "secret" ? "password" : field.kind === "number" || field.kind === "bytes" ? "number" : field.kind === "email" ? "email" : "text"} />;
}

export default async function AppManagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; q?: string; saved?: string; error?: string; intent?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/");

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [definition, settings] = await Promise.all([getAppDefinition(id), getPlatformSettings()]);
  if (!definition) notFound();
  const instance = settings.apps[id];
  // An app that keeps its own settings document earns a Settings view; the
  // Advanced view stays what it has always been, this stack's variables.
  const availableViews = views.filter((item) => item.id !== "settings" || definition.spec.configuration.some((field) => field.target === "settings"));
  const selectedView = availableViews.some((item) => item.id === query.view) ? query.view as View : "setup";
  const viewHref = (view: View) => `/admin/apps/${id}?view=${view}`;
  const setupHref = `/admin/apps/${id}?view=setup`;
  const environmentHref = `/admin/apps/${id}?view=environment`;
  const settingsHref = `/admin/apps/${id}?view=settings`;

  async function install() {
    "use server";
    await requireAdmin();
    const currentDefinition = await getAppDefinition(id);
    if (!currentDefinition) throw new Error("App definition no longer exists");
    await installDefinition(currentDefinition);
    redirect(`/admin/apps/${id}?saved=installed`);
  }

  async function saveSetup(form: FormData) {
    "use server";
    await requireAdmin();
    try {
      if (id === "kimono-portal") await savePlatformBrand(form);
      else {
        const currentDefinition = await getAppDefinition(id);
        if (!currentDefinition) throw new Error("App definition no longer exists");
        await saveAppSetup(currentDefinition, form);
      }
    } catch (error) {
      redirect(`${setupHref}&error=${encodeURIComponent(error instanceof Error ? error.message : "Settings could not be saved")}`);
    }
    redirect(`${setupHref}&saved=1`);
  }

  async function saveEnvironment(form: FormData) {
    "use server";
    await requireAdmin();
    try {
      const currentDefinition = await getAppDefinition(id);
      if (!currentDefinition) throw new Error("App definition no longer exists");
      await saveAppEnvironment(currentDefinition, form);
    }
    catch (error) { redirect(`${environmentHref}&error=${encodeURIComponent(error instanceof Error ? error.message : "Environment could not be saved")}`); }
    redirect(`${environmentHref}&saved=1`);
  }

  async function saveSettings(form: FormData) {
    "use server";
    await requireAdmin();
    try {
      const currentDefinition = await getAppDefinition(id);
      if (!currentDefinition) throw new Error("App definition no longer exists");
      await saveAppEnvironment(currentDefinition, form);
    }
    catch (error) { redirect(`${settingsHref}&error=${encodeURIComponent(error instanceof Error ? error.message : "Settings could not be saved")}`); }
    redirect(`${settingsHref}&saved=1`);
  }

  const fieldQuery = query.q?.trim().toLowerCase() || "";
  const matching = definition.spec.configuration.filter((field) => !fieldQuery || [field.key, field.label, field.group, field.description || ""].some((value) => value.toLowerCase().includes(fieldQuery)));
  const fields = matching.filter((field) => field.target !== "settings");
  const settingsFields = matching.filter((field) => field.target === "settings");
  const groups = Map.groupBy(fields, (field) => field.group);
  const settingsGroups = Map.groupBy(settingsFields, (field) => field.group);
  const availableTunnels = Object.values(settings.tunnels).filter((tunnel) => tunnel.enabled && Boolean(tunnel.configuration.TUNNEL_TOKEN || (tunnel.configuration.TUNNEL_ID && tunnel.configuration.CREDENTIALS_FILE)));
  const hasSelectedTunnel = availableTunnels.some((tunnel) => tunnel.id === instance?.tunnelId);
  const publishedHost = instance && hasSelectedTunnel ? appHostname(instance.domain, settings.baseDomain) : null;

  /* The rail states what the server is doing right now; the form below changes it. */
  const runState = !instance
    ? { key: "uninstalled", label: "Not installed", detail: "No containers created yet", seal: "quiet" as const }
    : instance.enabled
      ? { key: "running", label: "Running", detail: publishedHost || "Only inside your home", seal: "running" as const }
      : { key: "off", label: "Off", detail: "Installed, not running", seal: "private" as const };

  return (
    <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
      <div className="page admin-page">
        <div className="app-workspace">
          <aside className="app-rail">
            <DoorBack href={query.intent === "publish" ? "/admin/apps?intent=publish" : "/admin/apps"} />
            <div className="rail-identity">
              <AppBloom identity={{ id, name: definition.metadata.shortName, accent: accentOf(instance?.colors || definition.metadata.colors) }} glyphHref={definition.iconUrl} />
              <h1>{instance?.name || definition.metadata.name}</h1>
              <p>{definition.metadata.description}</p>
            </div>
            <p className={`state-plate is-${runState.key}`}>
              <StatedSeal state={runState.seal}>{runState.label}</StatedSeal>
              <small>{runState.detail}</small>
            </p>
            {instance ? (
              <nav className="rail-nav" aria-label="Application management">
                {availableViews.map((item) => <Link key={item.id} href={viewHref(item.id)} aria-current={selectedView === item.id ? "page" : undefined}>{item.label}</Link>)}
              </nav>
            ) : null}
          </aside>

          <div className="app-panel">
            {query.saved ? <p className="admin-notice success">{query.saved === "installed" ? "App installed. Turn it on when you have finished setting it up." : "Changes saved."}</p> : null}
            {query.error ? <p className="admin-notice error">{query.error}</p> : null}

            {!instance ? (
              <section className="install-definition">
                <div><h2>Install this app</h2><p>Nothing starts until you configure and turn it on.</p></div>
                <form action={install}><Seal type="submit">Install app</Seal></form>
              </section>
            ) : (
              <div className="management-panel">
              {selectedView === "setup" ? (
                <form action={saveSetup} className="management-form app-setup-form k-tray">
                  <header><h2>{id === "kimono-portal" ? "Platform identity" : "App settings"}</h2></header>
                  {id === "kimono-portal" ? (
                    <label className="settings-field"><span>Base domain</span><input name="baseDomain" defaultValue={settings.baseDomain} required /><small>App short names are placed beneath this domain.</small></label>
                  ) : <>
                    <Compartment label="General" className="setup-section setup-general"><div><RunJoint defaultChecked={instance.enabled} /><label className="settings-field"><span>Name</span><input name="name" defaultValue={instance.name} required /></label></div></Compartment>
                    <Compartment label="Access" wants={!availableTunnels.length} className={`setup-section setup-address ${!availableTunnels.length ? "needs-tunnel" : ""}`}>{!availableTunnels.length ? <div className="tunnel-empty-state"><input type="hidden" name="tunnelId" value="none" /><h4>{query.intent === "publish" ? "Connect to publish" : "Private"}</h4><p>{query.intent === "publish" ? "Give this app a public address." : "Reachable only inside your home."}</p>{instance.tunnelId ? <p className="tunnel-missing-warning">Previous connection is gone.</p> : null}<div className="tunnel-empty-actions"><SealLink href={`/admin/infrastructure/cloudflare?app=${encodeURIComponent(id)}`}>Connect Cloudflare</SealLink></div></div> : <fieldset className="tunnel-picker"><legend><span>Availability</span><Link href={`/admin/infrastructure/cloudflare?app=${encodeURIComponent(id)}`}>New connection →</Link></legend>
                      <article className="tunnel-choice private-choice"><label><input type="radio" name="tunnelId" value="none" defaultChecked={!hasSelectedTunnel} /><span className="provider-monogram">—</span><span><strong>Keep private</strong><small>Do not publish a public hostname</small></span></label></article>
                      {availableTunnels.map((tunnel) => {
                        const zones = tunnelZones(tunnel);
                        const matchedZone = zones.toSorted((a, b) => b.name.length - a.name.length).find((zone) => instance.domain === zone.name || instance.domain.endsWith(`.${zone.name}`));
                        const subdomain = matchedZone ? instance.domain === matchedZone.name ? "@" : instance.domain.slice(0, -(matchedZone.name.length + 1)) : definition.metadata.shortName.toLowerCase();
                        return <article className="tunnel-choice" key={tunnel.id}><label><input type="radio" name="tunnelId" value={tunnel.id} defaultChecked={instance.tunnelId === tunnel.id} /><span className="provider-monogram">{tunnel.provider === "cloudflare" ? "CF" : tunnel.provider.slice(0, 2).toUpperCase()}</span><span><strong>{tunnel.name}</strong><small>{tunnel.configuration.ACCOUNT_NAME?.value || tunnel.provider}</small></span></label>{tunnel.provider === "cloudflare" && zones.length ? <div className="tunnel-domain-fields"><label><span>Subdomain</span><input name={`subdomain.${tunnel.id}`} defaultValue={subdomain} /></label><span className="domain-dot">.</span><label><span>Domain</span><select name={`zone.${tunnel.id}`} defaultValue={matchedZone?.name || zones[0].name}>{zones.map((zone) => <option key={zone.id} value={zone.name}>{zone.name}</option>)}</select></label></div> : <div className="tunnel-domain-fields single-domain-field"><label><span>App name or complete hostname</span><input name={`domain.${tunnel.id}`} defaultValue={instance.domain} /></label></div>}</article>;
                      })}
                    </fieldset>}</Compartment>
                  </>}
                  <details className="appearance-settings">
                    <summary><span><strong>Appearance</strong><small>App flower and colors</small></span></summary>
                    <fieldset className="palette-field"><legend className="sr-only">Application colors</legend><div className="palette-editor"><AppBloom identity={{ id, name: definition.metadata.shortName, accent: accentOf((id === "kimono-portal" ? settings.brand.colors : instance?.colors) || definition.metadata.colors) }} glyphHref={definition.iconUrl} /><div className="color-row">{(id === "kimono-portal" ? settings.brand.colors : instance.colors).map((color, index) => <label key={index}><input type="color" name={`color${index}`} defaultValue={color} /><span>{color}</span></label>)}</div></div></fieldset>
                  </details>
                  {id !== "kimono-portal" ? <details className="setup-advanced"><summary>Advanced connectivity</summary><label className="settings-toggle"><input type="checkbox" name="internetAccess" defaultChecked={instance.networkPolicy.internetAccess} /><span>Allow this app to make outbound internet connections</span></label></details> : null}
                  <footer><Seal type="submit">Save app setup</Seal></footer>
                </form>
              ) : null}

              {selectedView === "settings" ? (
                <>
                  <header className="panel-heading"><div><h2>Settings</h2><p>How {instance.name} behaves. Kimono holds these, so this page is the only place they change.</p></div>
                    <form className="panel-search"><input name="q" defaultValue={query.q} placeholder="Filter settings" /><input type="hidden" name="view" value="settings" /><button type="submit">Search</button></form>
                  </header>
                  <form action={saveSettings} className="management-form env-form">
                    <input type="hidden" name="target" value="settings" />
                    {[...settingsGroups.entries()].map(([group, groupFields]) => (
                      <section className="environment-group" key={group}>
                        <h3>{group}</h3>
                        {groupFields.map((field) => {
                          const override = instance.environment[field.key];
                          return <label className="environment-field" key={field.key} htmlFor={`env-${field.key}`}>
                            <span><strong>{field.label}</strong>{field.description ? <small>{field.description}</small> : null}</span>
                            <EnvironmentInput field={field} value={override?.value || field.default || ""} configured={Boolean(override)} />
                          </label>;
                        })}
                      </section>
                    ))}
                    {!settingsFields.length ? <p className="catalog-empty">No settings match this filter.</p> : null}
                    <footer><Seal type="submit">Save settings</Seal></footer>
                  </form>
                </>
              ) : null}

              {selectedView === "environment" ? (
                <>
                  <header className="panel-heading"><div><h2>Environment</h2><p>Variables exposed by this app’s file-backed definition.</p></div>
                    <form className="panel-search"><input name="q" defaultValue={query.q} placeholder="Filter variables" /><input type="hidden" name="view" value="environment" /><button type="submit">Search</button></form>
                  </header>
                  <form action={saveEnvironment} className="management-form env-form">
                    <input type="hidden" name="target" value="environment" />
                    {[...groups.entries()].map(([group, groupFields]) => (
                      <section className="environment-group" key={group}>
                        <h3>{group}</h3>
                        {groupFields.map((field) => {
                          const override = instance.environment[field.key];
                          return <label className="environment-field" key={field.key} htmlFor={`env-${field.key}`}>
                            <span><strong>{field.label}</strong><code>{field.key}</code>{field.description ? <small>{field.description}</small> : null}</span>
                            <EnvironmentInput field={field} value={override?.value || field.default || ""} configured={Boolean(override)} />
                          </label>;
                        })}
                      </section>
                    ))}
                    {!fields.length ? <p className="catalog-empty">No environment variables match this filter.</p> : null}
                    <details className="managed-environment"><summary>{definition.spec.managedEnvironment.length} variables managed by Kimono</summary><p>These are derived from domains, credentials, services, and deployment state. Edit the app definition if the stack contract itself needs to change.</p><div>{definition.spec.managedEnvironment.map((key) => <code key={key}>{key}</code>)}</div></details>
                    <footer><Seal type="submit">Save environment</Seal></footer>
                  </form>
                </>
              ) : null}

              {selectedView === "storage" ? (
                <section>
                  <header className="panel-heading"><div><h2>Storage</h2><p>Persistent volumes declared by the app stack.</p></div></header>
                  {definition.spec.volumes.length ? <div className="storage-table">{definition.spec.volumes.map((volume) => <div key={volume.id}><strong>{volume.id}</strong><code>{volume.service}:{volume.path}</code><span>{volume.backup ? "Included in backups" : "Not backed up"}</span></div>)}</div> : <p className="catalog-empty">This app does not declare persistent volumes.</p>}
                </section>
              ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
