import { redirect } from "next/navigation";
import { InkBlot, Seal } from "@kimono/ui";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { getPlatformSettings } from "@/lib/settings";
import { describeService, kimonoServices, readServicesStatus, requestServiceRestart } from "@/lib/kimono-services";
import { when } from "../backups/machinery";
import { BackupRefresh } from "../backups/refresh";

export const metadata = { title: "Services · Admin" };

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["owner", "admin"].includes(session.user.role)) redirect("/");
  return session;
}

/**
 * What Kimono itself runs on: each part, whether it's doing its job, and a way
 * to restart it from anywhere. The server starts a stopped part again by
 * itself; this is for the times that isn't enough.
 */
export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ error?: string; asked?: string }> }) {
  const session = await requireAdmin();
  const [settings, { status, watched, pending }, query] = await Promise.all([getPlatformSettings(), readServicesStatus(), searchParams]);
  const byId = new Map((status?.services ?? []).map((state) => [state.id, state]));

  async function restart(form: FormData) {
    "use server";
    await requireAdmin();
    const service = String(form.get("service") || "");
    try { await requestServiceRestart(service); }
    catch (error) { redirect(`/admin/services?error=${encodeURIComponent(error instanceof Error ? error.message : "That couldn't be restarted")}`); }
    redirect(`/admin/services?asked=${encodeURIComponent(service)}`);
  }

  const last = status?.last;
  const lastLabel = last ? kimonoServices.find((service) => service.id === last.service)?.label ?? "That" : null;
  const following = pending || Boolean(query.asked);

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page services-page">
      <BackupRefresh active={following} />
      <div className="topbar">
        <Crossing kind="kakejiku" className="back" href="/admin" aria-label="Back to Admin"><LineIcon name="back" /></Crossing>
        <h1>Services</h1>
      </div>
      {query.error ? <p role="alert" className="app-notice is-error">{query.error}</p> : null}
      {pending ? <p role="status" className="app-notice">Restarting. This page follows along.</p> : null}
      {!pending && last && last.asked && query.asked ? <p role={last.ok ? "status" : "alert"} className={last.ok ? "app-notice" : "app-notice is-error"}>{last.ok ? `${lastLabel} restarted.` : `${lastLabel} couldn't be restarted: ${last.message || "the server said no"}.`}</p> : null}
      {!watched ? <p role="alert" className="app-notice is-error">The server isn&rsquo;t reporting on its services. Update Kimono on the server once, with <code>sudo kimono update</code>, and this page comes alive.</p> : null}

      <div className="seg">
        {kimonoServices.map((service) => {
          const seen = describeService(byId.get(service.id));
          return <form action={restart} className="row" key={service.id}>
            <InkBlot tint={!watched ? "#8a7c77" : seen.ok ? "#5c7150" : "#a84d63"} seed={service.id}><LineIcon name={service.id === "headscale" ? "shield" : service.id === "caddy" ? "cloud" : service.id === "postgresql" ? "archive" : service.id === "portal" ? "home" : "key"} /></InkBlot>
            <span className="text"><b>{service.label}</b><small>{service.detail}{watched && byId.get(service.id)?.startedAt && seen.ok ? ` · up since ${when(byId.get(service.id)?.startedAt)}` : ""}</small></span>
            {watched ? <span className={seen.ok ? "k-ink-dot k-running" : "k-ink-dot k-wants"}>{seen.label}</span> : null}
            <Seal tone="quiet" type="submit" name="service" value={service.id} disabled={pending}>Restart</Seal>
          </form>;
        })}
      </div>
      {last && !last.asked ? <p className="lead" style={{ marginTop: 14 }}>{lastLabel} {last.ok ? "had stopped, and was started again" : "had stopped, and couldn't be started again"} {when(last.at)}.</p> : null}
    </div>
  </AppShell>;
}
