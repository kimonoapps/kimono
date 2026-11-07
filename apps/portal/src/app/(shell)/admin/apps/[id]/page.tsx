import { ProviderMark } from "@/components/provider-mark";
import { auth } from "@/auth";
import { appBackupSelection, readBackupConfig, readBackupStatus, saveAppBackups } from "@/lib/backups";
import { backupCatalog } from "@/lib/backup-catalog";
import { AppShell } from "@/components/app-shell";
import { getAppDefinition, type ConfigurationField } from "@/lib/definitions";
import {
  getPlatformSettings,
  configureDefinition,
  saveAppEnvironment,
  saveAppSetup,
  savePlatformBrand,
  tunnelIsReady,
  tunnelZones,
} from "@/lib/settings";
import { AppBloom, Choice, InkBlot, InkCard, Seal } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { JointSwitch } from "@/components/joint-switch";
import { SaveBar } from "@/components/save-bar";
import { accentOf, appRegistry } from "@/lib/apps";
import { notFound, redirect } from "next/navigation";
import { db, grantUsage, takeBackGrant } from "@/lib/code";
import { AiUsage } from "./ai-usage";

type View = "setup" | "settings" | "people" | "environment" | "backups";
const views: Array<{ id: View; label: string }> = [
  { id: "setup", label: "Setup" },
  { id: "settings", label: "Settings" },
  { id: "people", label: "People" },
  { id: "environment", label: "Advanced" },
  { id: "backups", label: "Backups" },
];

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "owner" && session.user.role !== "admin")) redirect("/");
  return session.user;
}

function EnvironmentInput({ field, value, configured, label }: { field: ConfigurationField; value: string; configured: boolean; label?: string }) {
  const common = {
    id: `env-${field.key}`,
    name: `env.${field.key}`,
    defaultValue: field.kind === "secret" ? "" : value,
    placeholder: field.kind === "secret" && configured ? "Configured — leave blank to keep" : field.default,
  };
  if (field.kind === "toggle") return <input id={common.id} name={common.name} type="checkbox" defaultChecked={(value || field.default || "off") === "on"} />;
  if (field.kind === "select") return <Choice label={label} id={common.id} name={common.name} defaultValue={value || field.options?.[0]} options={(field.options ?? []).map((option) => ({ value: option, label: option }))} />;
  return <input {...common} type={field.kind === "secret" ? "password" : field.kind === "number" || field.kind === "bytes" ? "number" : field.kind === "email" ? "email" : "text"} />;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const definition = await getAppDefinition((await params).id);
  return { title: `${definition?.metadata.name ?? "App"} · Admin` };
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
  const [backupConfig, backupStatus] = await Promise.all([readBackupConfig(), readBackupStatus()]);
  const backup = appBackupSelection(backupConfig, backupCatalog(settings, [definition]), id);
  // An app that keeps its own settings document earns a Settings view; the
  // Advanced view stays what it has always been, this stack's variables.
  const availableViews = views.filter((item) => (item.id !== "settings" || definition.spec.configuration.some((field) => field.target === "settings")) && (item.id !== "backups" || id !== "kimono-portal") && (item.id !== "people" || id === "kimono-code"));
  const selectedView = availableViews.some((item) => item.id === query.view) ? query.view as View : "setup";
  const viewHref = (view: View) => `/admin/apps/${id}?view=${view}`;
  const setupHref = `/admin/apps/${id}?view=setup`;
  const environmentHref = `/admin/apps/${id}?view=environment`;
  const settingsHref = `/admin/apps/${id}?view=settings`;
  const backupsHref = `/admin/apps/${id}?view=backups`;
  const peopleHref = `/admin/apps/${id}?view=people`;

  async function startSetup() {
    "use server";
    await requireAdmin();
    const currentDefinition = await getAppDefinition(id);
    if (!currentDefinition) throw new Error("App definition no longer exists");
    await configureDefinition(currentDefinition);
    redirect(`/admin/apps/${id}?saved=configured`);
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

  /* More of Kimono AI for someone, on top of their share, until this week or these 5 hours end. */
  async function giveUsage(form: FormData) {
    "use server";
    const admin = await requireAdmin();
    const username = String(form.get("username") || ""), window = form.get("window") === "five_hour" ? "five_hour" : "week";
    try { grantUsage(db(), username, window, Number(form.get("extra")) / 100, admin.username || "admin"); }
    catch (error) { redirect(`${peopleHref}&error=${encodeURIComponent(error instanceof Error ? error.message : "That couldn't be given")}`); }
    redirect(`${peopleHref}&saved=1`);
  }

  async function takeBackUsage(form: FormData) {
    "use server";
    await requireAdmin();
    takeBackGrant(db(), Number(form.get("grant")));
    redirect(`${peopleHref}&saved=1`);
  }

  async function saveBackups(form: FormData) {
    "use server";
    await requireAdmin();
    try { await saveAppBackups(id, form); }
    catch (error) { redirect(`${backupsHref}&error=${encodeURIComponent(error instanceof Error ? error.message : "Backup choices could not be saved")}`); }
    redirect(`${backupsHref}&saved=1`);
  }

  const fieldQuery = query.q?.trim().toLowerCase() || "";
  const matching = definition.spec.configuration.filter((field) => !fieldQuery || [field.key, field.label, field.group, field.description || ""].some((value) => value.toLowerCase().includes(fieldQuery)));
  const fields = matching.filter((field) => field.target !== "settings");
  const settingsFields = matching.filter((field) => field.target === "settings");
  const groups = Map.groupBy(fields, (field) => field.group);
  const settingsGroups = Map.groupBy(settingsFields, (field) => field.group);
  const availableTunnels = Object.values(settings.tunnels).filter((tunnel) => tunnelIsReady(tunnel));
  const hasSelectedTunnel = availableTunnels.some((tunnel) => tunnel.id === instance?.tunnelId);

  const registered = appRegistry(settings, [definition]).find((app) => app.catalogHref === `/admin/apps/${id}`);
  const problem = registered?.state === "problem" ? registered.stateDetail : null;
  const dot = !instance ? <span className="k-ink-dot">Not set up</span>
    : problem ? <span className="k-ink-dot k-wants">Needs you</span>
    : instance.enabled ? <span className="k-ink-dot k-running">Running</span>
    : <span className="k-ink-dot">Off</span>;
  const name = instance?.name || definition.metadata.name;
  const identity = { id, name: definition.metadata.shortName, glyph: definition.metadata.glyph, accent: accentOf((id === "kimono-portal" ? settings.brand.colors : instance?.colors) || definition.metadata.colors) };
  const colors = id === "kimono-portal" ? settings.brand.colors : instance?.colors;
  const canRun = Boolean(instance) && id !== "kimono-portal" && definition.spec.setupReady !== false;
  /* Built-in apps have no address to choose: one column instead of an empty left half. */
  const split = Boolean(problem || id === "kimono-portal" || !definition.spec.portalPath || definition.spec.manualSetup);
  const back = query.intent === "publish" ? "/admin/apps?intent=publish" : "/admin/apps";

  const fieldList = (list: ConfigurationField[], showKey: boolean) => list.map((field) => {
    const override = instance!.environment[field.key];
    const value = override?.value || field.default || "";
    if (field.kind === "toggle") return <div className="pw-switch" key={field.key}><span><b>{field.label}</b>{showKey ? <code>{field.key}</code> : null}{field.description ? <small>{field.description}</small> : null}</span><JointSwitch name={`env.${field.key}`} defaultChecked={(value || "off") === "on"} label={field.label} /></div>;
    return <div className="env-field" key={field.key}>
      {field.kind === "select"
        ? <EnvironmentInput field={field} value={value} configured={Boolean(override)} label={field.label} />
        : <label className="field" htmlFor={`env-${field.key}`}><small>{field.label}</small><EnvironmentInput field={field} value={value} configured={Boolean(override)} /></label>}
      {showKey || field.description ? <p className="env-help">{showKey ? <code>{field.key}</code> : null}{field.description}</p> : null}
    </div>;
  });

  return (
    <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
      <div className="page app-page">
        <div className="topbar">
          <Crossing kind="kakejiku" className="back" href={back} aria-label="Back to Applications"><LineIcon name="back" /></Crossing>
          <AppBloom className="bloom app-page-bloom" identity={identity} glyphHref={definition.iconUrl} />
          <span><h1>{name}</h1><p className="sub">{definition.metadata.description}</p></span>
          <div className="end">{dot}{canRun && selectedView === "setup" ? <JointSwitch name="enabled" form="app-setup" defaultChecked={instance!.enabled} label={`Run ${name}`} /> : null}</div>
        </div>

        {instance && availableViews.length > 1 ? <nav className="tabs app-tabs" aria-label="Application views">
          {availableViews.map((item) => <Crossing kind="kakejiku" key={item.id} href={viewHref(item.id)} aria-current={selectedView === item.id ? "page" : undefined}>{item.label}</Crossing>)}
        </nav> : null}

        {query.saved ? <p className="app-notice">{query.saved === "configured" ? "Setup started. Configure this app before turning it on." : "Changes saved."}</p> : null}
        {query.error ? <p className="app-notice is-error">{query.error}</p> : null}

        {!instance ? (
          <div className="card app-start">
            {definition.spec.setupReady === false
              ? <><h3>Configuration coming soon</h3><p className="lead">This app stays off until its configuration is available.</p></>
              : <><h3>Set up {definition.metadata.shortName}</h3><p className="lead">This saves a configuration. Turning on a hosted app asks your server to deploy it.</p><form action={startSetup}><Seal type="submit">Start setup</Seal></form></>}
          </div>
        ) : null}

        {instance && selectedView === "setup" ? <>
          <form id="app-setup" action={saveSetup} className={split ? "cols wide" : "stack app-single"}>
            <div className="stack">
              {problem ? <InkCard colour="#a84d63" seed={`app-problem-${id}`}><div className="card" style={{ background: "var(--primary-container)" }}>
                <b style={{ color: "var(--on-primary-container)" }}>{instance.tunnelId ? "Its public connection is gone" : "It needs you"}</b>
                <p style={{ color: "var(--on-primary-container)", fontSize: 15 }}>{problem}. Pick another connection below, or keep it private.</p>
              </div></InkCard> : null}
              {id === "kimono-portal" ? <div className="card"><h3>Address</h3><label className="field"><small>Base domain</small><input name="baseDomain" defaultValue={settings.baseDomain} required /></label><p className="lead">App short names are placed beneath this domain.</p></div> : null}
              {id !== "kimono-portal" && !definition.spec.portalPath ? <div className="card"><h3>Who can reach it</h3>
                {availableTunnels.length ? <div className="access">
                  <label className="opt"><input className="k-ink-radio" type="radio" name="tunnelId" value="none" defaultChecked={!hasSelectedTunnel} /><span className="text"><b>Keep private</b><small>Only inside your home and on Kimono VPN</small></span></label>
                  {availableTunnels.map((tunnel) => {
                    const zones = tunnelZones(tunnel);
                    const matchedZone = zones.toSorted((a, b) => b.name.length - a.name.length).find((zone) => instance.domain === zone.name || instance.domain.endsWith(`.${zone.name}`));
                    const subdomain = matchedZone ? instance.domain === matchedZone.name ? "@" : instance.domain.slice(0, -(matchedZone.name.length + 1)) : definition.metadata.shortName.toLowerCase();
                    return <div className="opt-group" key={tunnel.id}>
                      <label className="opt"><input className="k-ink-radio" type="radio" name="tunnelId" value={tunnel.id} defaultChecked={instance.tunnelId === tunnel.id} /><span className="text"><b>{tunnel.name}</b><small>{tunnel.provider === "cloudflare" ? "Cloudflare" : tunnel.provider}{tunnel.configuration.ACCOUNT_NAME?.value ? ` · ${tunnel.configuration.ACCOUNT_NAME.value}` : ""}</small></span><ProviderMark provider={tunnel.provider} /></label>
                      {tunnel.provider === "cloudflare" && zones.length
                        ? <div className="domain"><label className="field"><small>Subdomain</small><input name={`subdomain.${tunnel.id}`} defaultValue={subdomain} /></label><span>.</span><Choice label="Domain" name={`zone.${tunnel.id}`} defaultValue={matchedZone?.name || zones[0].name} options={zones.map((zone) => ({ value: zone.name, label: zone.name }))} /></div>
                        : <div className="domain single"><label className="field"><small>App name or full address</small><input name={`domain.${tunnel.id}`} defaultValue={instance.domain} /></label></div>}
                    </div>;
                  })}
                </div> : <>
                  <input type="hidden" name="tunnelId" value="none" />
                  <p className="lead">{query.intent === "publish" ? "Connect Cloudflare to give it a public address." : "Private: reachable only inside your home and on Kimono VPN."}{instance.tunnelId ? " Its previous connection is gone." : ""}</p>
                </>}
                <Crossing kind="kakejiku" className="txt" href={`/admin/infrastructure/cloudflare?app=${encodeURIComponent(id)}`}><LineIcon name="plus" />New connection</Crossing>
              </div> : null}
              {definition.spec.manualSetup ? <div className="card"><h3>{definition.spec.manualSetup.title}</h3><p className="lead">{definition.spec.manualSetup.description}</p><ol className="manual-steps">{definition.spec.manualSetup.steps.map((step) => <li key={step}>{step}</li>)}</ol></div> : null}
            </div>
            <div className="stack">
              <div className="card"><h3>Name and look</h3>
                {id === "kimono-portal" ? null : <label className="field"><small>Name</small><input name="name" defaultValue={instance.name} required /></label>}
                <div className="look">
                  <AppBloom className="bloom" identity={identity} glyphHref={definition.iconUrl} />
                  <span className="swatches">{(colors || definition.metadata.colors).map((color, index) => <label key={index} className="swatch" style={{ background: color }}><input type="color" name={`color${index}`} defaultValue={color} aria-label={`Colour ${index + 1}`} /></label>)}</span>
                </div>
              </div>
              {id !== "kimono-portal" && !definition.spec.portalPath ? <div className="card"><h3>Internet access</h3><div className="pw-switch"><span><small>Let {definition.metadata.shortName} make outbound connections, for link previews and imports.</small></span><JointSwitch name="internetAccess" defaultChecked={instance.networkPolicy.internetAccess} label="Allow internet access" /></div></div> : null}
            </div>
          </form>
          <SaveBar formId="app-setup" label="Save app setup" />
        </> : null}

        {instance && (selectedView === "settings" || selectedView === "environment") ? <>
          <div className="app-view-head">
            <p className="lead">{selectedView === "settings" ? `How ${instance.name} behaves. Kimono holds these, so this is the only place they change.` : "Variables from this app's definition."}</p>
            <form className="search"><LineIcon name="search" /><input name="q" defaultValue={query.q} placeholder={selectedView === "settings" ? "Filter settings" : "Filter variables"} aria-label="Filter" /><input type="hidden" name="view" value={selectedView} /></form>
          </div>
          <form id={`app-${selectedView}`} action={selectedView === "settings" ? saveSettings : saveEnvironment} className="env-groups">
            <input type="hidden" name="target" value={selectedView} />
            {[...(selectedView === "settings" ? settingsGroups : groups).entries()].map(([group, groupFields]) => <div className="card" key={group}><h3>{group}</h3>{fieldList(groupFields, selectedView === "environment")}</div>)}
            {!(selectedView === "settings" ? settingsFields : fields).length ? <p className="lead">{fieldQuery ? "Nothing matches this filter." : selectedView === "settings" ? "This app has no settings." : "This app has no variables to set."}</p> : null}
            {selectedView === "environment" ? <details className="card managed-env"><summary>{definition.spec.managedEnvironment.length} variables managed by Kimono</summary><p className="lead">Derived from domains, credentials, services and deployment state. Edit the app definition if the stack itself needs to change.</p><div>{definition.spec.managedEnvironment.map((key) => <code key={key}>{key}</code>)}</div></details> : null}
          </form>
          <SaveBar formId={`app-${selectedView}`} label={selectedView === "settings" ? "Save settings" : "Save environment"} />
        </> : null}

        {instance && selectedView === "people" ? <AiUsage give={giveUsage} takeBack={takeBackUsage} me={{ username: session.user.username ?? "", role: session.user.role }} /> : null}

        {instance && selectedView === "backups" ? (!backupConfig ? (
          <div className="card app-start"><span className="row-lead"><InkBlot tint="#5c7150" seed="no-storage"><LineIcon name="archive" /></InkBlot><span><h3>No storage yet</h3><p className="lead">Connect storage, then choose what to keep from {instance.name}.</p></span></span><Crossing kind="kakejiku" className="k-seal" href="/admin/backups">Set up backups</Crossing></div>
        ) : !backup.items.length ? (
          <div className="card app-start"><h3>Unprotected</h3><p className="lead">This app declares nothing to back up, so its data is not kept.</p><Crossing kind="kakejiku" className="txt" href="/admin/backups">All backups</Crossing></div>
        ) : <>
          <form id="app-backups" action={saveBackups} className="cols wide">
            <div className="stack">
              <div className="label" style={{ margin: "0 0 0 20px" }}>What to keep</div>
              <div className="seg">
                {backup.items.map((item) => <div className="row" key={item.id}><span className="text"><b>{item.label}</b><small>{item.description} · {{ files: "live file copy", postgres: "PostgreSQL export", sqlite: "SQLite export", settings: "configuration file" }[item.method]}</small></span><JointSwitch name={`item.${item.id}`} defaultChecked={backupConfig.items[item.id] ?? item.enabledByDefault} label={`Keep ${item.label}`} /></div>)}
              </div>
            </div>
            <div className="stack">
              <div className="card"><div className="pw-switch"><span><b>Back up {definition.metadata.shortName}</b><small>{backupConfig.enabled ? `Nightly at ${String(backupConfig.hourUTC).padStart(2, "0")}:00 UTC` : "Schedule paused"} · last upload {backupStatus?.lastSuccess ? new Date(backupStatus.lastSuccess).toUTCString().replace(/:\d\d GMT$/, " UTC") : "never"}</small></span><JointSwitch name="enabled" defaultChecked={backup.enabled} label="Back up this app" /></div>
                <Crossing kind="kakejiku" className="txt" href="/admin/backups">All backups</Crossing></div>
              {definition.spec.volumes.length ? <details className="card"><summary><b>Volumes on disk</b></summary><div className="volumes">{definition.spec.volumes.map((volume) => <div key={volume.id}><b>{volume.backupLabel || volume.id}</b><code>{volume.service}:{volume.path}</code><small>{volume.backupDescription || "Persistent app data"}</small></div>)}</div></details> : null}
            </div>
          </form>
          <SaveBar formId="app-backups" label="Save backups" />
        </>) : null}
      </div>
    </AppShell>
  );
}
