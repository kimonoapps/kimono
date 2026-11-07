"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Seal } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { detectMobileOS } from "@/lib/mobile-app";
import type { AppOffer } from "@/lib/app-offer";

type Phone = "ios" | "android";
type Standing = "tester" | "stuck" | "invited" | "waiting" | "problem" | "none" | "idle";
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

function IosSteps({ address, apps }: { address: string | null; apps: string[] }) {
  const [standing, setStanding] = useState<{ status: Standing; email: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  /* Coming back after accepting Apple's email shows where things are. */
  useEffect(() => {
    let current = true;
    fetch("/api/v1/app/testflight", { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() as Promise<{ status: Standing; email: string | null }> : null)
      .then((body) => { if (current && body && body.status !== "idle") setStanding(body); })
      .catch(() => {});
    return () => { current = false; };
  }, []);
  async function request() {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/api/v1/app/testflight", { method: "POST", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { status?: Standing; email?: string | null; error?: string };
      if (body.status) setStanding({ status: body.status, email: body.email ?? null });
      else setProblem(body.error || "That didn't work. Try again.");
    } catch {
      setProblem("Kimono isn't answering. Try again in a moment.");
    }
    setBusy(false);
  }
  /* A fresh invite, when Apple's email expired or never came. */
  async function resend() {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/api/v1/app/testflight/resend", { method: "POST", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { status?: Standing; email?: string | null; resent?: boolean; error?: string };
      if (body.status) setStanding({ status: body.status, email: body.email ?? null });
      if (body.resent) setResent(true);
      else setProblem(body.error || "That didn't work. Try again.");
    } catch {
      setProblem("Kimono isn't answering. Try again in a moment.");
    }
    setBusy(false);
  }
  const status = standing?.status;
  const sent = status === "invited" || status === "tester" || status === "stuck";
  const email = standing?.email;
  return <ol className="get-app-steps">
    <Step n={1} title="Request access" done={sent}>
      {status === "tester"
        ? <p>You&apos;re in.</p>
        : status === "invited" || status === "stuck"
        ? <p>Sent an invite to <b>{email ?? "your email"}</b>.{resent ? " Sent a new one too: use the newest email." : status === "stuck" ? " It expired or hasn't been accepted." : null}</p>
        : status === "none"
        ? <p>Your Kimono account needs an email first. Add one under Account.</p>
        : status === "problem"
        ? <p>Apple didn&apos;t take your email. Ask whoever runs your Kimono.</p>
        : status === "waiting"
        ? <p>Your invite is on its way. Try again in a minute.</p>
        : <p>Kimono asks Apple to invite you to try the app.</p>}
      {status !== "tester" ? <div className="get-app-actions">
        <Seal onClick={request} busy={busy} tone={status === "stuck" && !resent ? "quiet" : undefined}>{sent ? "Check again" : "Request access"}</Seal>
        {(status === "invited" || status === "stuck") && !resent ? <Seal onClick={resend} busy={busy} tone={status === "stuck" ? undefined : "quiet"}>Send it again</Seal> : null}
      </div> : null}
      {problem ? <p className="get-app-problem" role="alert">{problem}</p> : null}
    </Step>
    <Step n={2} title="Download TestFlight">
      <p>TestFlight is Apple&apos;s app for trying apps before they&apos;re in the App Store.</p>
      <Crossing kind="hanafubuki" external href="https://apps.apple.com/app/testflight/id899247664" target="_blank" rel="noopener noreferrer" className="k-seal k-tone-quiet">Get TestFlight</Crossing>
    </Step>
    <Step n={3} title="Accept Apple's email" done={status === "tester"}>
      <p>In a few minutes you&apos;ll get an email from Apple{email ? <> at <b>{email}</b></> : null}. Open it and follow the instructions to accept, then come back here and tap <b>Check again</b>.</p>
    </Step>
    <Step n={4} title="Install Kimono">
      {apps.length > 1
        ? <p>Open TestFlight. {apps.map((app, i) => <span key={app}>{i ? (i === apps.length - 1 ? " and " : ", ") : null}<b>{app}</b></span>)} are waiting there: tap <b>Install</b> on each.</p>
        : <p>Open TestFlight. Kimono is waiting there: tap <b>Install</b>.</p>}
    </Step>
    <SignInStep n={5} address={address} />
  </ol>;
}
