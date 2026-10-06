"use client";

import { useState, type FormEvent } from "react";
import { Field, FormActions, Seal } from "@kimono/ui";
import { passwordMinLength, passwordRules } from "@/lib/account-input";

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const response = await fetch("/api/v1/me/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, next, confirm, signOutOthers }) });
      const reply = await response.json().catch(() => ({})) as { error?: string; ended?: number };
      if (!response.ok) throw new Error(reply.error || "Your password could not be changed.");
      setCurrent(""); setNext(""); setConfirm("");
      setDone(reply.ended ? `Password changed. ${reply.ended === 1 ? "1 other sign-in was" : `${reply.ended} other sign-ins were`} ended.` : "Password changed.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your password could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  const rule = (ok: boolean, text: string) => <li className={ok ? "is-met" : undefined}><span aria-hidden="true" />{text}<span className="sr-only">{ok ? " (met)" : " (not met yet)"}</span></li>;
  return <form className="k-form password-form" onSubmit={submit}>
    {done ? <p className="admin-notice success" role="status">{done}</p> : null}
    {error ? <p className="admin-notice error" role="alert">{error}</p> : null}
    <Field label="Current password"><input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required /></Field>
    <Field label="New password"><input type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" required /></Field>
    <ul className="password-rules">
      {rule(rules.long, `At least ${passwordMinLength} characters`)}
      {rule(next.length > 0 && rules.notName, "Not your name or username")}
      {rule(matches, "Typed the same twice")}
    </ul>
    <Field label="Type it again"><input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required /></Field>
    <label className="password-signout"><input type="checkbox" checked={signOutOthers} onChange={(event) => setSignOutOthers(event.target.checked)} />Sign out my other devices</label>
    <FormActions><Seal type="submit" disabled={!ready}>{busy ? "Changing password" : "Change password"}</Seal></FormActions>
  </form>;
}
