import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { AppBloom, InkBlot, InkCard, Seal } from "@kimono/ui";
import { appIdentity, appRegistry } from "@/lib/apps";
import { getPlatformSettings } from "@/lib/settings";
import { scanAppDefinitions } from "@/lib/definitions";
import { backupCatalog } from "@/lib/backup-catalog";
import { appBackupSelection, readBackupConfig, readBackupStatus, requestBackup, saveBackups } from "@/lib/backups";
import { redirect } from "next/navigation";
import { backupHealth, RestoreSheet, StorageSheet, when } from "./machinery";
import { BackupRefresh } from "./refresh";

export const metadata = { title: "Backups · Admin" };

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["owner", "admin"].includes(session.user.role)) redirect("/");
  return session;
}

/**
 * Backups (design/mockups/m3-everywhere.html): the state of things leads, then
 * the apps in one list with what each keeps. Storage and schedule are a calm
 * card you rarely touch; changing them and restoring open as sheets, because
 * they're occasional, careful tasks. What each app keeps is chosen on its page.
 */
export default async function BackupsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; queued?: string; sheet?: string }> }) {
  const session = await requireAdmin();
  const [settings, scan, config, status, query] = await Promise.all([getPlatformSettings(), scanAppDefinitions(), readBackupConfig(), readBackupStatus(), searchParams]);
  const catalog = backupCatalog(settings, scan.definitions);
  const registry = new Map(appRegistry(settings, scan.definitions).map(app => [app.id, app]));
  const health = backupHealth(config, status);
  const order = ["problem", "private", "disabled"];

  const cards = Object.values(settings.apps).filter((app) => app.definitionId !== "kimono-portal").map((app) => {
    const registered = registry.get(app.id);
    const base = {
      id: app.id,
      name: registered?.name || app.name,
      description: registered?.description || "App definition is unavailable",
      iconUrl: registered?.iconUrl,
      identity: registered ? appIdentity(registered) : null,
    };
    const selection = appBackupSelection(config, catalog, app.id);
    const count = `${selection.items.length} item${selection.items.length === 1 ? "" : "s"}`;
    const card = !selection.items.length
      ? { state: "disabled", dot: "k-ink-dot", label: "Unprotected", detail: "Declares nothing to back up" }
      : !selection.enabled
        ? { state: "disabled", dot: "k-ink-dot", label: "Off", detail: `${count} available` }
        : !selection.kept.length
          ? { state: "problem", dot: "k-ink-dot k-wants", label: "Nothing kept", detail: "Every item is switched off" }
          : !config
            ? { state: "private", dot: "k-ink-dot", label: "Waiting", detail: `${selection.kept.length} of ${count} chosen; add storage to keep them` }
          : { state: "private", dot: "k-ink-dot k-running", label: "Protected", detail: selection.kept.length === selection.items.length ? selection.kept.map((item) => item.label).join(", ") : `${selection.kept.length} of ${count}` };
    return { ...base, rank: order.indexOf(card.state), ...card };
  }).toSorted((left, right) => left.rank - right.rank || left.name.localeCompare(right.name));
  const protectedCount = cards.filter((card) => card.label === "Protected").length;

  async function save(form: FormData) {
    "use server";
    await requireAdmin();
    try { await saveBackups(form); }
    catch (error) { redirect(`/admin/backups?error=${encodeURIComponent(error instanceof Error ? error.message : "Backup settings could not be saved")}`); }
    redirect("/admin/backups?saved=1");
  }
  async function run(form: FormData) {
    "use server";
    await requireAdmin();
    const action = String(form.get("action"));
    try {
      if (action !== "backup" && action !== "check" && action !== "restore") throw new Error("Unknown operation");
      await requestBackup(action, String(form.get("snapshot") || ""), String(form.get("appId") || ""));
    } catch (error) { redirect(`/admin/backups?error=${encodeURIComponent(error instanceof Error ? error.message : "Operation could not be queued")}`); }
    redirect("/admin/backups?queued=1");
  }

  const busy = status?.state === "running";
  const ready = Boolean(config?.recoverySaved) && !busy;
  const hero = {
    running: { background: "var(--tertiary-container)", color: "var(--on-tertiary-container)", ink: "#5c7150", icon: "check" as const, title: busy ? "Backing up now" : "Nightly, and up to date" },
    wants: { background: "var(--primary-container)", color: "var(--on-primary-container)", ink: "#a84d63", icon: "bell" as const, title: "Backups need you" },
    private: { background: "var(--sc)", color: "var(--on-surface)", ink: "#4e2b37", icon: "archive" as const, title: config?.recoverySaved ? "Paused" : "Save the recovery kit" },
    quiet: { background: "var(--sc)", color: "var(--on-surface)", ink: "#4e2b37", icon: "cloud" as const, title: "Not set up yet" },
  }[health.state];
  const lastLine = config ? [`Last upload ${when(status?.lastSuccess) || "never"}`, health.state === "running" ? health.line : null, status?.lastCheck ? `checked ${when(status.lastCheck)}` : null].filter(Boolean).join(" · ") : health.line;
  const heroCard = <div className="hero backup-hero" style={{ background: hero.background, color: hero.color }}>
    <InkBlot tint={hero.ink} seed={`backup-${health.state}`} strong><LineIcon name={hero.icon} /></InkBlot>
    <span><h2 style={{ color: hero.color }}>{hero.title}</h2><p>{health.state === "running" ? lastLine : health.line}</p></span>
  </div>;

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page backups-page">
      <BackupRefresh active={busy || Boolean(query.queued)} />
      <div className="topbar">
        <Crossing kind="kakejiku" className="back" href="/admin" aria-label="Back to Admin"><LineIcon name="back" /></Crossing>
        <h1>Backups</h1>
        {config ? <div className="end">
          <Crossing kind="kakejiku" className="k-seal k-tone-quiet" href="/admin/backups?sheet=restore">Restore a copy</Crossing>
          <form action={run}><Seal name="action" value="backup" type="submit" disabled={!ready}>{busy ? "Backing up" : "Back up now"}</Seal></form>
        </div> : null}
      </div>
      {query.error ? <p role="alert" className="app-notice is-error">{query.error}</p> : null}
      {query.saved ? <p role="status" className="app-notice">Backup settings saved.</p> : null}
      {query.queued ? <p role="status" className="app-notice">Queued. This page follows along.</p> : null}
      {scan.errors.map((error) => <p className="app-notice is-error" key={error}>{error}</p>)}

      {health.state === "running" || health.state === "wants" ? <InkCard colour={hero.ink} seed="backup-hero">{heroCard}</InkCard> : heroCard}

      <div className="cols backup-cols">
        <div><div className="label">{config ? `Apps · ${protectedCount} of ${cards.length} protected` : "Apps · nothing kept yet"}</div>
          <div className="seg">
            {cards.map((card) => <Crossing className="row" kind="kakejiku" href={`/admin/apps/${card.id}?view=backups`} key={card.id}>
              {card.identity ? <AppBloom className="bloom" identity={card.identity} glyphHref={card.iconUrl || undefined} size="mark" /> : <InkBlot tint="#8a7c77" seed={card.id}><LineIcon name="folder" /></InkBlot>}
              <span className="text"><b>{card.name}</b><small>{card.detail}</small></span>
              <span className={card.dot}>{card.label}</span>
            </Crossing>)}
          </div></div>
        <div className="stack"><div className="label">Where and when</div>
          <div className="card backup-where">
            {config ? <>
              <div className="where-row"><InkBlot tint="#74565c" seed="b2"><LineIcon name="cloud" /></InkBlot><span><b>Backblaze B2</b><small><code>{config.bucket}</code> · folder <code>{config.prefix}</code></small></span><Crossing kind="kakejiku" className="txt" href="/admin/backups?sheet=storage">Change</Crossing></div>
              <div className="where-row"><span><b>{config.enabled ? `Nightly at ${String(config.hourUTC).padStart(2, "0")}:00 UTC` : "Schedule paused"}</b><small>Keeps {config.daily} daily, {config.weekly} weekly, {config.monthly} monthly</small></span><span className={config.enabled ? "k-ink-dot k-running" : "k-ink-dot"}>{config.enabled ? "On" : "Paused"}</span></div>
              <div className="where-row"><span><b>Recovery kit</b><small>{config.recoverySaved ? "Stored off this server" : "Not confirmed yet; nothing runs until it is"}</small></span>{config.recoverySaved ? <span className="chip t-ter">Saved</span> : <Crossing kind="kakejiku" className="txt" href="/admin/backups?sheet=storage">Confirm</Crossing>}</div>
              <form action={run} className="where-row"><span><b>Stored data</b><small>{status?.lastCheck ? `Last checked ${when(status.lastCheck)}` : "Never checked"}</small></span><button className="txt" name="action" value="check" type="submit" disabled={!ready}>Check now</button></form>
            </> : <>
              <p className="lead">Kimono keeps nightly, encrypted copies in a Backblaze B2 bucket you own.</p>
              <Crossing kind="kakejiku" className="k-seal" href="/admin/backups?sheet=storage">Set up storage</Crossing>
            </>}
          </div></div>
      </div>

      {query.sheet === "storage" ? <StorageSheet config={config} save={save} /> : null}
      {query.sheet === "restore" ? <RestoreSheet status={status} run={run} apps={cards.filter((card) => card.label !== "Unprotected").map((card) => ({ id: card.id, name: card.name }))} /> : null}
    </div>
  </AppShell>;
}
