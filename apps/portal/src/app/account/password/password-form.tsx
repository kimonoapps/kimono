"use client";

import { useState, type FormEvent } from "react";
import { Seal } from "@kimono/ui";
import { passwordMinLength, passwordRules } from "@kimono/account";
import { celebrate } from "@/components/celebrate";

/** Changes the password through /api/v1/me/password, the same call the phone app makes. */
export function PasswordForm({ username, name }: { username: string; name: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const rules = passwordRules(next, { username, name });
  const matches = next.length > 0 && next === confirm;
  const ready = current.length > 0 && rules.long && rules.notName && matches && !busy;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    const button = event.currentTarget.querySelector<HTMLElement>("button[type=submit]");
    setBusy(true); setError(null); setDone(null);
    try {
      const response = await fetch("/api/v1/me/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, next, confirm, signOutOthers }) });
      const reply = await response.json().catch(() => ({})) as { error?: string; ended?: number };
      if (!response.ok) throw new Error(reply.error || "Your password could not be changed.");
      setCurrent(""); setNext(""); setConfirm("");
      setDone(reply.ended ? `Password changed. ${reply.ended === 1 ? "1 other sign-in was" : `${reply.ended} other sign-ins were`} ended.` : "Password changed.");
      if (button) celebrate(button);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your password could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  const rule = (ok: boolean, text: string) => <div className="pw-rule"><i className={ok ? "k-ink-ring k-met" : "k-ink-ring"} aria-hidden="true" /><span className={ok ? "is-met" : undefined}>{text}</span><span className="sr-only">{ok ? " (met)" : " (not met yet)"}</span></div>;
  return <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
    {done ? <p className="admin-notice success" role="status">{done}</p> : null}
    {error ? <p className="admin-notice error" role="alert">{error}</p> : null}
    <label className="field"><small>Current password</small><input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required /></label>
    <label className="field"><small>New password</small><input type="password" value={next} onChange={(event) => setNext(event.target.value)} placeholder={`At least ${passwordMinLength} characters`} autoComplete="new-password" required /></label>
    <label className="field"><small>Type it again</small><input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required /></label>
    <div className="card low" style={{ gap: 10 }}>
      {rule(rules.long, `At least ${passwordMinLength} characters`)}
      {rule(next.length > 0 && rules.notName, "Not your name or username")}
      {rule(matches, "Typed the same twice")}
    </div>
    <div className="pw-switch">
      <span><b>Sign out my other devices</b><small>Everywhere but this browser</small></span>
      <button className="joint" role="switch" type="button" aria-checked={signOutOthers} aria-label="Sign out my other devices" onClick={() => setSignOutOthers(!signOutOthers)} />
    </div>
    <Seal type="submit" className="full" disabled={!ready}>{busy ? "Changing password" : "Change password"}</Seal>
  </form>;
}
