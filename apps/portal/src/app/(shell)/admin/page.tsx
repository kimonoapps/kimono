import { redirect } from "next/navigation";
import { InkBlot, InkCard } from "@kimono/ui";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Crossing } from "@/components/crossing";
import { LineIcon, type LineIconName } from "@/components/line-icon";
import { appRegistry } from "@/lib/apps";
import { getPlatformSettings, tunnelIsReady } from "@/lib/settings";
import { scanAppDefinitions } from "@/lib/definitions";
import { readBackupConfig, readBackupStatus } from "@/lib/backups";
import { renderDeploymentPlan } from "@/lib/deployment";
import { planDigest, readReconcilerStatus } from "@/lib/desired-state";
import { updateNotice } from "@/lib/kimono-release";
import { describeService, readServicesStatus } from "@/lib/kimono-services";
import { backupHealth } from "./backups/machinery";

export const metadata = { title: "Admin" };

/*
 * The admin overview answers "is anything wrong?" first: what needs you,
 * whether backups are running, whether the server is live. Then the update,
 * then every section with its state. (Before, /admin went straight to Applications.)
 */
export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["owner", "admin"].includes(session.user.role)) redirect("/");
  const [settings, scan, config, status, deployment, notice] = await Promise.all([getPlatformSettings(), scanAppDefinitions(), readBackupConfig(), readBackupStatus(), readReconcilerStatus(), updateNotice(session.user.username)]);
  const services = await readServicesStatus();
  const servicesDown = services.watched ? (services.status?.services ?? []).filter((state) => !describeService(state).ok).length : 0;

  const apps = appRegistry(settings, scan.definitions);
  const installed = apps.filter((app) => app.state !== "available");
  const running = apps.filter((app) => ["private", "public", "system"].includes(app.state));
  const needYou = apps.filter((app) => app.state === "problem");
  const health = backupHealth(config, status);
  const digest = planDigest(renderDeploymentPlan(settings, scan.definitions));
  const deploymentState = !deployment || deployment.planDigest !== digest ? "pending" : deployment.state;
  const live = { pending: "Deploying", applying: "Deploying", ready: "Live", failed: "Needs you" }[deploymentState] || "Deploying";
  const tunnels = Object.values(settings.tunnels);
  const connected = tunnels.filter(tunnelIsReady).length;

  const section = (href: string, icon: LineIconName, tint: string, title: string, detail: string, state: React.ReactNode) =>
    <Crossing kind="kakejiku" className="row" href={href}>
      <InkBlot tint={tint} seed={title}><LineIcon name={icon} /></InkBlot>
      <span className="text"><b>{title}</b><small>{detail}</small></span>{state}<span className="go" />
    </Crossing>;

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page admin-overview">
      <div className="topbar"><span><span className="eyebrow">Your server</span><h1>Admin</h1></span></div>
      <div className="status-grid">
        {needYou.length
          ? <InkCard colour="#a84d63" seed="admin-needs-you" className="status-ink"><Crossing kind="kakejiku" className="status-card" href="/admin/apps" style={{ background: "var(--primary-container)", color: "var(--on-primary-container)" }}>
            <span className="big">{needYou.length}</span><b>{needYou.length === 1 ? "app needs you" : "apps need you"}</b><small>{needYou.map((app) => `${app.name}: ${app.stateDetail}`).join(" · ")}</small>
          </Crossing></InkCard>
          : <Crossing kind="kakejiku" className="status-card" href="/admin/apps" style={{ background: "var(--sc)" }}>
            <span className="big" style={{ color: "var(--plum)" }}>{running.length}</span><b>apps running</b><small>Nothing needs you</small>
          </Crossing>}
        {health.state === "running"
          ? <InkCard colour="#5c7150" seed="admin-backups" className="status-ink"><Crossing kind="kakejiku" className="status-card" href="/admin/backups" style={{ background: "var(--tertiary-container)", color: "var(--on-tertiary-container)" }}>
            <span className="big">{health.label}</span><b>Backups are running</b><small>{health.line}</small>
          </Crossing></InkCard>
          : <Crossing kind="kakejiku" className="status-card" href="/admin/backups" style={health.state === "wants" ? { background: "var(--primary-container)", color: "var(--on-primary-container)" } : { background: "var(--sc)" }}>
            <span className="big" style={{ color: "var(--plum)" }}>{health.label}</span><b>Backups</b><small>{health.line}</small>
          </Crossing>}
        <Crossing kind="kakejiku" className="status-card" href="/admin/infrastructure" style={{ background: "var(--sc)" }}>
          <span className="big" style={{ color: "var(--plum)" }}>{live}</span><b>Connectivity</b><small>{tunnels.length ? `${connected} of ${tunnels.length} connection${tunnels.length === 1 ? "" : "s"} connected` : "No public connections"}</small>
        </Crossing>
      </div>

      {notice ? <InkCard colour="#4e2b37" seed="admin-update" className="update-ink"><div className="card" style={{ background: "var(--secondary-container)", marginTop: 14, gridTemplateColumns: "auto minmax(0,1fr) auto", alignItems: "center" }}>
        <InkBlot tint="#a84d63" seed="update"><LineIcon name="bell" /></InkBlot>
        <span><b style={{ fontSize: 17 }}>Kimono {notice.latest} is out</b><br /><small style={{ color: "var(--on-surface-variant)", fontSize: 14 }}>You have {notice.current}. Run on the server: <code>sudo kimono update</code></small></span>
        {/* eslint-disable-next-line no-restricted-syntax -- release notes open in a new tab; there is no page change to make. */}
        <a className="txt" href={notice.url} target="_blank" rel="noreferrer">What&rsquo;s new</a>
      </div></InkCard> : null}

      <div className="label">Sections</div>
      <div className="seg">
        {section("/admin/apps", "folder", "#a84d63", "Applications", `${installed.length} apps · ${running.length} running`, needYou.length ? <span className="k-ink-dot k-wants">{needYou.length} need{needYou.length === 1 ? "s" : ""} you</span> : <span className="k-ink-dot k-running">All fine</span>)}
        {section("/admin/backups", "archive", "#5c7150", "Backups", config ? `${config.bucket} · ${config.enabled ? `nightly at ${String(config.hourUTC).padStart(2, "0")}:00 UTC` : "schedule paused"}` : "No storage yet", <span className={health.state === "running" ? "k-ink-dot k-running" : health.state === "wants" ? "k-ink-dot k-wants" : "k-ink-dot"}>{health.label}</span>)}
        {section("/admin/infrastructure", "cloud", "#74565c", "Connectivity", "Publish apps outside your home", <span className={live === "Live" ? "k-ink-dot k-running" : live === "Needs you" ? "k-ink-dot k-wants" : "k-ink-dot"}>{live}</span>)}
        {section("/admin/services", "gear", "#4e2b37", "Services", "Sign-in, VPN and the rest; restart from here", !services.watched ? <span className="k-ink-dot">Not reporting</span> : servicesDown ? <span className="k-ink-dot k-wants">{servicesDown} not running</span> : <span className="k-ink-dot k-running">All running</span>)}
        {section("/admin/vpn", "shield", "#5c7150", "Kimono VPN", "Who may build a private mesh", null)}
        {section("/admin/feedback", "people", "#74565c", "Kimono AI feedback", "Thumbs and reports on its answers", null)}
        {section("/admin/phone-app", "phone", "#a84d63", "Phone app", "Releases and TestFlight testers", null)}
        {section("/admin/links", "link", "#8a7c77", "People and invites", "Invite someone, reset a password", null)}
      </div>
    </div>
  </AppShell>;
}
