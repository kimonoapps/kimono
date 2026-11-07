"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Seal } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { detectMobileOS } from "@/lib/mobile-app";
import type { AppOffer } from "@/lib/app-offer";

type Phone = "ios" | "android";
type Standing = "tester" | "stuck" | "invited" | "waiting" | "requested" | "declined" | "problem" | "none" | "idle";
const never = () => () => {};

/** The steps for an iPhone or an Android phone; this phone's first, the other a tap away. */
export function AppGuide({ offer, asked }: { offer: AppOffer; asked: Phone | null }) {
  const detected = useSyncExternalStore(never, () => detectMobileOS(navigator), () => null);
  const [chosen, setChosen] = useState<Phone | null>(null);
  const phone: Phone = chosen ?? asked ?? detected ?? (offer.ios ? "ios" : "android");
  const both = offer.ios && Boolean(offer.android);
  return <>
    <header className="get-app-head">
      <p className="get-app-kicker">The Kimono app</p>
      <h1>{phone === "ios" ? "Kimono for iPhone" : "Kimono for Android"}</h1>
      {both ? <div className="get-app-switch" role="tablist" aria-label="Phone">
        {(["ios", "android"] as const).map((option) => <button key={option} type="button" role="tab" aria-selected={phone === option} className={phone === option ? "is-here" : ""} onClick={() => setChosen(option)}>
          {option === "ios" ? "iPhone" : "Android"}
        </button>)}
      </div> : null}
    </header>
    {phone === "ios"
      ? offer.ios ? <IosSteps address={offer.address} apps={offer.iosApps} /> : <p className="get-app-none">The iPhone app isn&apos;t set up on this Kimono yet.</p>
      : offer.android ? <AndroidSteps android={offer.android} address={offer.address} /> : <p className="get-app-none">The Android app isn&apos;t out for this Kimono yet.</p>}
  </>;
}

function SignInStep({ n, address }: { n: number; address: string | null }) {
  return <Step n={n} title="Open Kimono and sign in">
    {address
      ? <p>Tap <b>Use a different address</b>, enter <b>{address}</b>, then sign in as you do here.</p>
      : <p>Sign in with the same username and password as here.</p>}
  </Step>;
}

function Step({ n, title, done = false, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return <li className={`get-app-step${done ? " is-done" : ""}`}>
    <span className="get-app-n" aria-hidden="true">{done ? "✓" : n}</span>
    <div><h2>{title}</h2>{children}</div>
  </li>;
}

function AndroidSteps({ android, address }: { android: NonNullable<AppOffer["android"]>; address: string | null }) {
  return <ol className="get-app-steps">
    <Step n={1} title="Download the app">
      <p>Kimono {android.version}{android.size ? ` · ${(android.size / 1_000_000).toFixed(0)} MB` : ""}</p>
      {/* eslint-disable-next-line no-restricted-syntax -- a download stays on this page; there is no crossing to make. */}
      <a className="k-seal" href={`/api/v1/app/packages/${android.build}`} download><span>Download for Android</span></a>
    </Step>
    <Step n={2} title="Install it">
      <p>Open the download. If Android asks, let your browser install apps, then tap <b>Install</b>.</p>
    </Step>
    <SignInStep n={3} address={address} />
  </ol>;
}

type IosApp = { bundleId: string; name: string; status: Standing };
type Answer = { status?: Standing; email?: string | null; apps?: IosApp[]; resent?: boolean; error?: string };

/** One app's standing, in a few words. */
function askLine(app: IosApp, email: string | null | undefined): string {
  switch (app.status) {
    case "requested": return "Waiting for an admin to approve";
    case "declined": return "Not approved";
    case "waiting": return "Approved. Your invite is on its way";
    case "invited": return email ? `Invite sent to ${email}` : "Invite sent";
    case "stuck": return "Your invite expired or hasn't been accepted";
    case "tester": return "You're in";
    case "problem": return "Apple didn't take your email. Ask whoever runs your Kimono";
    case "none": return "Your Kimono account needs an email. Add one under Account";
    default: return "";
  }
}

function IosSteps({ address }: { address: string | null; apps: string[] }) {
  const [standing, setStanding] = useState<{ email: string | null; apps: IosApp[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const keep = (body: Answer) => { if (body.apps) setStanding({ email: body.email ?? null, apps: body.apps }); };
  /* Coming back after accepting Apple's email shows where things are. */
  useEffect(() => {
    let current = true;
    fetch("/api/v1/app/testflight", { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() as Promise<Answer> : null)
      .then((body) => { if (current && body) keep(body); })
      .catch(() => {});
    return () => { current = false; };
  }, []);
  async function send(what: string, path: string, body?: unknown): Promise<Answer | null> {
    setBusy(what);
    setProblem(null);
    try {
      const response = await fetch(path, { method: "POST", credentials: "same-origin", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
      const answer = await response.json().catch(() => ({})) as Answer;
      keep(answer);
      if (answer.error || !answer.apps) setProblem(answer.error || "That didn't work. Try again.");
      return answer;
    } catch {
      setProblem("Kimono isn't answering. Try again in a moment.");
      return null;
    } finally {
      setBusy(null);
    }
  }
  /* Asking for an app, or checking on one already approved. */
  const ask = (bundleId: string) => send(bundleId, "/api/v1/app/testflight", { app: bundleId });
  /* A fresh invite, when Apple's email expired or never came. */
  async function resend() { if ((await send("resend", "/api/v1/app/testflight/resend"))?.resent) setResent(true); }
  /* Apple only lets people accept at their Apple Account's email, so they can be invited there instead. */
  async function useEmail(event: React.FormEvent) {
    event.preventDefault();
    const answer = await send("email", "/api/v1/app/testflight/email", { email: newEmail });
    if (answer?.apps && !answer.error) { setChanging(false); setResent(false); }
  }
  /* Only Kimono is asked for here; its other apps are asked for from inside Kimono. */
  const list = (standing?.apps ?? []).filter((app) => app.bundleId === "app.kimono.compose");
  const email = standing?.email;
  const has = (...statuses: Standing[]) => list.some((app) => statuses.includes(app.status));
  const inviteOut = has("invited", "stuck");
  return <ol className="get-app-steps">
    <Step n={1} title="Ask for Kimono" done={has("invited", "stuck", "tester", "waiting")}>
      <p>Once an admin approves, Apple invites you to try it.</p>
      {list.length ? <ul className="get-app-asks">
        {list.map((app) => <li key={app.bundleId}>
          <span><b>{app.name}</b>{askLine(app, email) ? <small>{askLine(app, email)}</small> : null}</span>
          {app.status === "idle" || app.status === "declined"
            ? <Seal compact onClick={() => ask(app.bundleId)} busy={busy === app.bundleId}>{app.status === "declined" ? "Ask again" : "Ask"}</Seal>
            : app.status === "waiting" || app.status === "invited" || app.status === "stuck"
            ? <Seal compact tone="quiet" onClick={() => ask(app.bundleId)} busy={busy === app.bundleId}>Check again</Seal>
            : null}
        </li>)}
      </ul> : null}
      {inviteOut && !changing ? <div className="get-app-actions">
        {resent ? <p>Sent a new one: use the newest email.</p> : <Seal onClick={resend} busy={busy === "resend"} tone={has("stuck") ? undefined : "quiet"}>Send it again</Seal>}
      </div> : null}
      {has("invited", "stuck", "waiting", "none", "problem") ? changing
        ? <form className="get-app-email" onSubmit={useEmail}>
            <label className="field"><small>Your Apple Account&apos;s email</small><input type="email" required autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} /></label>
            <div className="get-app-actions">
              <Seal type="submit" busy={busy === "email"}>Invite this email</Seal>
              <button type="button" className="txt" onClick={() => setChanging(false)}>Cancel</button>
            </div>
          </form>
        : <button type="button" className="txt get-app-other" onClick={() => { setNewEmail(""); setChanging(true); }}>Use a different email</button>
        : null}
      {problem ? <p className="get-app-problem" role="alert">{problem}</p> : null}
    </Step>
    <Step n={2} title="Download TestFlight">
      <p>TestFlight is Apple&apos;s app for trying apps before they&apos;re in the App Store.</p>
      <Crossing kind="hanafubuki" external href="https://apps.apple.com/app/testflight/id899247664" target="_blank" rel="noopener noreferrer" className="k-seal k-tone-quiet">Get TestFlight</Crossing>
    </Step>
    <Step n={3} title="Accept Apple's email" done={has("tester")}>
      <p>Once you&apos;re approved, you&apos;ll get an email from Apple{email ? <> at <b>{email}</b></> : null}. Open it and follow the instructions to accept, then come back here and tap <b>Check again</b>.</p>
    </Step>
    <Step n={4} title="Install Kimono">
      <p>Open TestFlight. Kimono is waiting there: tap <b>Install</b>.</p>
    </Step>
    <SignInStep n={5} address={address} />
  </ol>;
}
