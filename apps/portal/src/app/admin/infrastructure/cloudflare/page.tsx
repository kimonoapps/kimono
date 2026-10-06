import { DoorBack } from "@/components/door-back";
import { Seal } from "@kimono/ui";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { connectCloudflareTunnel, disconnectTunnel, getPlatformSettings } from "@/lib/settings";
import { redirect } from "next/navigation";
import { CloudflareLoginWizard } from "./cloudflare-login-wizard";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "owner" && session.user.role !== "admin")) redirect("/");
  return session;
}

export const metadata = { title: "Cloudflare tunnels · Admin" };

export default async function CloudflareConnectionPage({ searchParams }: { searchParams: Promise<{ id?: string; app?: string; saved?: string; error?: string }> }) {
  const session = await requireAdmin();
  const query = await searchParams;
  const settings = await getPlatformSettings();
  const tunnels = Object.values(settings.tunnels).filter((tunnel) => tunnel.provider === "cloudflare");
  const app = query.app ? settings.apps[query.app] : undefined;
  const returnHref = app ? `/admin/apps/${encodeURIComponent(app.id)}?view=setup` : "/admin/infrastructure";

  async function manualConnect(form: FormData) {
    "use server";
    await requireAdmin();
    try { await connectCloudflareTunnel(form); }
    catch (error) { redirect(`/admin/infrastructure/cloudflare${app ? `?app=${encodeURIComponent(app.id)}&` : "?"}error=${encodeURIComponent(error instanceof Error ? error.message : "Cloudflare could not be connected")}`); }
    redirect(app ? `/admin/apps/${encodeURIComponent(app.id)}?view=setup&saved=connected` : "/admin/infrastructure?saved=1");
  }

  async function disconnect(form: FormData) {
    "use server";
    await requireAdmin();
    const id = String(form.get("id") || "");
    try { await disconnectTunnel(id); }
    catch (error) { redirect(`/admin/infrastructure/cloudflare?error=${encodeURIComponent(error instanceof Error ? error.message : "Cloudflare could not be disconnected")}`); }
    redirect("/admin/infrastructure");
  }

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page admin-page cloudflare-connect-page">
      {/* Same composition as an app's settings: a rail for context, a tray for work. */}
      <div className="app-workspace">
        <aside className="app-rail">
          <DoorBack href={returnHref} label="Back" />
          <div className="rail-identity">
            <h1>{app ? `Publish ${app.name}` : "Connect Cloudflare"}</h1>
            <p>{app ? "Kimono will create a secure connection, then bring you back to choose the app\u2019s address." : "Create a secure connection for apps you want to publish."}</p>
          </div>
        </aside>

        <div className="app-panel">
          {query.saved ? <p className="admin-notice success">Cloudflare created and connected the tunnel.</p> : null}
          {query.error ? <p className="admin-notice error">{query.error}</p> : null}

          <section className="connection-flow-card">
            <CloudflareLoginWizard appId={app?.id} />
            <details className="connection-explainer"><summary>What happens next?</summary><ol><li>Cloudflare opens in a new tab.</li><li>You approve the domain.</li><li>Kimono creates the connection and returns to the app.</li></ol></details>
            {!app && tunnels.length ? <details className="existing-connections"><summary>{tunnels.length} existing {tunnels.length === 1 ? "connection" : "connections"}</summary><div className="connected-tunnel-list">{tunnels.map((tunnel) => { const connected = Boolean(tunnel.configuration.TUNNEL_TOKEN || (tunnel.configuration.TUNNEL_ID && tunnel.configuration.CREDENTIALS_FILE)); return <div key={tunnel.id} className={query.id === tunnel.id ? "is-current" : ""}><strong>{tunnel.name}</strong><small>{tunnel.configuration.ACCOUNT_NAME?.value || "Cloudflare account"}</small>{connected ? <form action={disconnect}><input type="hidden" name="id" value={tunnel.id} /><Seal tone="danger" type="submit">Disconnect</Seal></form> : <span className="connection-state">Not connected</span>}</div>; })}</div></details> : null}
          </section>

          {/* A different way in, so it is its own region rather than a compartment. */}
          <details className="manual-cloudflare-connect">
            <summary><strong>Manual connector-token fallback</strong><small>Use an existing remotely managed tunnel instead of cloudflared login</small></summary>
            <form action={manualConnect} className="connection-form">
              <div className="connection-name-row"><label><span>Connection ID</span><input name="id" placeholder="existing-tunnel" required /></label><label><span>Name</span><input name="name" placeholder="Existing Cloudflare tunnel" required /></label></div>
              <label><span>Install command or tunnel token</span><textarea name="tokenInput" rows={4} autoComplete="off" spellCheck={false} placeholder="docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token ey..." required /></label>
              <div className="connection-form-footer"><small>Kimono extracts and stores only the connector credential.</small><Seal tone="quiet" type="submit">Connect existing tunnel</Seal></div>
            </form>
          </details>
        </div>
      </div>
    </div>
  </AppShell>;
}
