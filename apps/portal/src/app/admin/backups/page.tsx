import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { AdminNavigation } from "@/components/admin-navigation";
import { Crossing } from "@/components/crossing";
import { AppBloom, PageHeader, StatedSeal } from "@kimono/ui";
import { accentOf } from "@/lib/apps";
import { getPlatformSettings } from "@/lib/settings";
import { scanAppDefinitions } from "@/lib/definitions";
import { backupCatalog } from "@/lib/backup-catalog";
import { appBackupSelection, readBackupConfig, readBackupStatus, requestBackup, saveBackups } from "@/lib/backups";
import { redirect } from "next/navigation";
import { BackupMachinery, backupHealth } from "./machinery";

export const metadata = { title: "Backups · Admin" };

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["owner", "admin"].includes(session.user.role)) redirect("/");
  return session;
}

/**
 * What each app keeps is chosen on that app's page, so this is first a shelf
 * of doors, each stamped with where the app stands. Where copies go and when
 * is Kimono's business: it sits in a drawer beneath, closed once it is set.
 */
export default async function BackupsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; queued?: string }> }) {
  const session = await requireAdmin();
  const [settings, scan, config, status, query] = await Promise.all([getPlatformSettings(), scanAppDefinitions(), readBackupConfig(), readBackupStatus(), searchParams]);
  const catalog = backupCatalog(settings, scan.definitions);
  const health = backupHealth(config, status);
  const order = ["problem", "disabled", "private"];

  const cards = Object.values(settings.apps).filter((app) => app.definitionId !== "kimono-portal").map((app) => {
    const definition = scan.definitions.find((item) => item.metadata.id === app.definitionId);
    const base = { id: app.id, name: app.name, description: definition?.metadata.description || "", iconUrl: definition?.iconUrl, accent: accentOf(app.colors || definition?.metadata.colors || []) };
    const selection = appBackupSelection(config, catalog, app.id);
    const count = `${selection.items.length} item${selection.items.length === 1 ? "" : "s"}`;
    const card = !selection.items.length
      ? { state: "problem", seal: "wants" as const, label: "Unprotected", detail: "Declares nothing to back up" }
      : !selection.enabled
        ? { state: "disabled", seal: "private" as const, label: "Off", detail: `${count} available` }
        : !selection.kept.length
          ? { state: "problem", seal: "wants" as const, label: "Nothing kept", detail: "Every item is switched off" }
          : { state: "private", seal: "running" as const, label: "Protected", detail: `${selection.kept.length} of ${count}` };
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

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page admin-page backup-workspace">
      <AdminNavigation active="backups" />
      <PageHeader title="Backups" description="Each app decides what it keeps.">
        <p className="backup-standing"><StatedSeal state={health.state}>{health.label}</StatedSeal><span>{health.line}</span></p>
      </PageHeader>
      {query.error ? <p role="alert" className="admin-notice error">{query.error}</p> : null}
      {query.saved ? <p role="status" className="admin-notice success">Backup settings saved.</p> : null}
      {query.queued ? <p role="status" className="admin-notice">Queued. This page follows along.</p> : null}
      {scan.errors.map((error) => <p className="admin-notice error" key={error}>{error}</p>)}
      <div className="catalog-results-heading"><h2>Apps</h2><span>{protectedCount} of {cards.length} protected</span></div>
      <div className="app-catalog-grid">
        {cards.map((card) => <Crossing className={`catalog-app state-${card.state}`} kind="kakejiku" href={`/admin/apps/${card.id}?view=backups`} key={card.id}>
          <span className="catalog-card-top">
            <span className="catalog-icon"><AppBloom identity={{ id: card.id, name: card.name, accent: card.accent }} glyphHref={card.iconUrl} /></span>
            <StatedSeal state={card.seal}>{card.label}</StatedSeal>
          </span>
          <span className="catalog-copy">
            <span className="catalog-title"><strong>{card.name}</strong></span>
            <span className="catalog-description">{card.description}</span>
            <span className="catalog-card-footer">
              <span className={card.state === "problem" ? "is-wanted" : undefined}>{card.detail}</span>
              <span className="catalog-arrow" aria-hidden="true">Open <b>→</b></span>
            </span>
          </span>
        </Crossing>)}
      </div>
      <details className="backup-drawer" open={!config || Boolean(query.error || query.saved || query.queued)}>
        <summary><span><strong>Where and when</strong><small>{config ? `${config.bucket} · ${config.enabled ? `nightly at ${String(config.hourUTC).padStart(2, "0")}:00 UTC` : "schedule paused"}` : "No storage yet"}</small></span></summary>
        <BackupMachinery config={config} status={status} save={save} run={run} queued={Boolean(query.queued)} apps={cards.filter((card) => card.label !== "Unprotected").map((card) => ({ id: card.id, name: card.name }))} />
      </details>
    </div>
  </AppShell>;
}
