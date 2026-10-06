"use client";

import { Seal } from "@kimono/ui";
import { useCrossTo } from "@/components/crossing";
import { useEffect, useState, type FormEvent } from "react";

type LoginState = { sessionId?: string; status: "idle" | "starting" | "waiting" | "creating" | "error"; message?: string };

export function CloudflareLoginWizard({ appId }: { appId?: string }) {
  const crossTo = useCrossTo();
  const [state, setState] = useState<LoginState>({ status: "idle" });

  useEffect(() => {
    if (!state.sessionId || state.status === "error") return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/tunnels/cloudflare/login/${state.sessionId}`, { cache: "no-store" });
      const result = await response.json() as { status?: "waiting" | "creating" | "complete" | "error"; error?: string; localId?: string };
      if (!response.ok || result.status === "error") {
        window.clearInterval(timer);
        setState({ status: "error", message: result.error || "Cloudflare login failed" });
      } else if (result.status === "creating") setState((current) => ({ ...current, status: "creating" }));
      else if (result.status === "complete") {
        window.clearInterval(timer);
        crossTo("kakejiku", appId
          ? `/admin/apps/${encodeURIComponent(appId)}?view=setup&saved=connected`
          : `/admin/infrastructure?saved=1`);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [appId, state.sessionId, state.status, crossTo]);

  async function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const popup = window.open("about:blank", "kimono-cloudflare-login");
    setState({ status: "starting" });
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/tunnels/cloudflare/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: data.get("name"), domain: data.get("domain") }) });
      const result = await response.json() as { sessionId?: string; authUrl?: string; error?: string };
      if (!response.ok || !result.sessionId || !result.authUrl) throw new Error(result.error || "Cloudflare login could not start");
      if (popup) popup.location.href = result.authUrl;
      else window.open(result.authUrl, "_blank", "noopener,noreferrer");
      setState({ sessionId: result.sessionId, status: "waiting" });
    } catch (error) {
      popup?.close();
      setState({ status: "error", message: error instanceof Error ? error.message : "Cloudflare login could not start" });
    }
  }

  const busy = state.status === "starting" || state.status === "waiting" || state.status === "creating";
  return <form onSubmit={begin} className="connection-form">
    <div className="connection-name-row">
      <label><span>Tunnel name</span><input name="name" placeholder="Family apps" disabled={busy} required /></label>
      <label><span>Cloudflare domain</span><input name="domain" placeholder="yourdomain.com" disabled={busy} required /></label>
    </div>
    {state.status === "waiting" ? <p className="login-progress"><strong>Waiting for Cloudflare…</strong> Finish authorization in the opened tab. This page will continue automatically.</p> : null}
    {state.status === "creating" ? <p className="login-progress"><strong>Authorized.</strong> Creating the tunnel and its isolated credentials…</p> : null}
    {state.status === "error" ? <p className="admin-notice error">{state.message}</p> : null}
    <div className="connection-form-footer"><small>Cloudflare will ask you to sign in and select this domain. Each new tunnel starts a separate login.</small><Seal type="submit" disabled={busy}>{state.status === "starting" ? "Starting cloudflared…" : busy ? "Authorization in progress" : "Sign in with Cloudflare"}</Seal></div>
  </form>;
}
