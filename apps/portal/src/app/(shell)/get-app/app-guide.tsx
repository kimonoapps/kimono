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
export function AppGuide({ offer, asked, email = null }: { offer: AppOffer; asked: Phone | null; email?: string | null }) {
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
      ? offer.ios ? <IosSteps address={offer.address} kimonoEmail={email} /> : <p className="get-app-none">The iPhone app isn&apos;t set up on this Kimono yet.</p>
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

type Stage = "ask" | "team" | "testflight" | "in";
type IosApp = { bundleId: string; name: string; status: Standing; stage?: Stage };
type Answer = { status?: Standing; email?: string | null; apps?: IosApp[]; resent?: boolean; error?: string };

const kimono = "app.kimono.compose";
const order: Stage[] = ["ask", "team", "testflight", "in"];
const past = (stage: Stage, step: Stage) => order.indexOf(stage) > order.indexOf(step);
const hadTestflight = "kimono.get-app.testflight";

/** Asked, and waiting on someone: worth checking on by itself. */
const waitingOn = (app: IosApp | undefined) => Boolean(app && (app.stage === "team" || app.stage === "testflight" || app.status === "requested" || app.status === "waiting"));

function IosSteps({ address, kimonoEmail }: { address: string | null; kimonoEmail: string | null }) {
  const [standing, setStanding] = useState<{ email: string | null; apps: IosApp[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [tapped, setTapped] = useState(false);
  const remembered = useSyncExternalStore(never, () => { try { return Boolean(localStorage.getItem(hadTestflight)); } catch { return false; } }, () => false);
  const gotTestflight = tapped || remembered;
  const keep = (body: Answer) => { if (body.apps) setStanding({ email: body.email ?? null, apps: body.apps }); };
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
  const app = standing?.apps.find((a) => a.bundleId === kimono);
  const stage: Stage = app?.stage ?? (app?.status === "tester" ? "in" : "ask");
  const email = standing?.email ?? kimonoEmail;
  /* Asking for Kimono, or checking where it's got to: the same call. */
  const check = () => send("check", "/api/v1/app/testflight", { app: kimono });
  /* Coming back from the email, and every half minute while here, says by itself when a step is done. */
  const watching = waitingOn(app);
  useEffect(() => {
    if (!watching) return;
    const look = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/v1/app/testflight", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app: kimono }) })
        .then((response) => response.ok ? response.json() as Promise<Answer> : null)
        .then((body) => { if (body?.apps) setStanding({ email: body.email ?? null, apps: body.apps }); })
        .catch(() => {});
    };
    const timer = setInterval(look, 30_000);
    document.addEventListener("visibilitychange", look);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", look); };
  }, [watching]);
  async function resend() {
    setNote(null);
    if ((await send("resend", "/api/v1/app/testflight/resend"))?.resent) setNote(`Sent again to ${email}. Use the newest email.`);
  }
  /* Apple only lets people accept at their Apple Account's email, so that's where the invite goes. */
  async function useEmail(event: React.FormEvent) {
    event.preventDefault();
    const answer = await send("email", "/api/v1/app/testflight/email", { email: newEmail });
    if (!answer?.apps || answer.error) return;
    setChanging(false);
    setNote(null);
    if (stage === "ask" && (app?.status === "idle" || app?.status === "declined" || app?.status === "none")) await send("email", "/api/v1/app/testflight", { app: kimono });
  }
  function tookTestflight() {
    setTapped(true);
    try { localStorage.setItem(hadTestflight, "1"); } catch {}
  }
  const emailForm = (label: string, cancel: boolean) => <form className="get-app-email" onSubmit={useEmail}>
    <label className="field"><small>Your Apple Account email</small><input type="email" required autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} /></label>
    <div className="get-app-actions">
      <Seal type="submit" busy={busy === "email"}>{label}</Seal>
      {cancel ? <button type="button" className="txt" onClick={() => setChanging(false)}>Cancel</button> : null}
    </div>
  </form>;
  const otherEmail = (text: string) => <button type="button" className="txt get-app-other" onClick={() => { setNewEmail(""); setChanging(true); }}>{text}</button>;
  const problemLine = problem ? <p className="get-app-problem" role="alert">{problem}</p> : null;

  const done = [gotTestflight || stage !== "ask", past(stage, "ask"), past(stage, "team"), stage === "in"];
  const now = done.indexOf(false) === -1 ? 4 : done.indexOf(false);

  return <ol className="get-app-steps">
    <Step n={1} title="Download TestFlight" done={done[0]}>
      {now === 0 ? <>
        <p>Apple&apos;s app for trying apps before they&apos;re in the App Store.</p>
        <div className="get-app-actions">
          <Crossing kind="hanafubuki" external href="https://apps.apple.com/app/testflight/id899247664" target="_blank" rel="noopener noreferrer" className="k-seal" onClick={tookTestflight}>Get TestFlight</Crossing>
          <button type="button" className="txt" onClick={tookTestflight}>I have it</button>
        </div>
      </> : null}
    </Step>
    <Step n={2} title="Request access" done={done[1]}>
      {now === 1 ? !standing ? <p>Checking…</p> : <>
        {app?.status === "requested" ? <>
          <p>Waiting for an admin to approve.</p>
          <Seal tone="quiet" onClick={() => check()} busy={busy === "check"}>Check again</Seal>
        </> : app?.status === "waiting" ? <>
          <p>Approved. Apple&apos;s invite is on its way to <b>{email}</b>.</p>
          <Seal tone="quiet" onClick={() => check()} busy={busy === "check"}>Check again</Seal>
        </> : app?.status === "problem" ? <>
          <p>Apple didn&apos;t take <b>{email}</b>.</p>
          {changing ? emailForm("Use this email", true) : otherEmail("Use a different email")}
        </> : changing || !email ? emailForm("Request access", Boolean(email)) : <>
          {app?.status === "declined" ? <p>Your last request wasn&apos;t approved.</p> : null}
          <p>Is <b>{email}</b> your Apple Account email?</p>
          <div className="get-app-actions">
            <Seal onClick={() => check()} busy={busy === "check"}>Yes, request access</Seal>
            <button type="button" className="txt" onClick={() => { setNewEmail(""); setChanging(true); }}>No, use another</button>
          </div>
        </>}
        {problemLine}
      </> : null}
    </Step>
    <Step n={3} title="Accept the App Store Connect invite" done={done[2]}>
      {now === 2 ? <>
        <p>{app?.status === "stuck" ? <>Your invite to <b>{email}</b> expired. Send a new one.</> : <>Apple emailed <b>{email}</b> an invite to App Store Connect. Open it and accept.</>}</p>
        {changing ? emailForm("Invite this email", true) : <>
          <div className="get-app-actions">
            {app?.status === "stuck"
              ? <Seal onClick={resend} busy={busy === "resend"}>Send it again</Seal>
              : <Seal onClick={() => check()} busy={busy === "check"}>I&apos;ve accepted</Seal>}
            {app?.status === "stuck" ? null : <Seal tone="quiet" onClick={resend} busy={busy === "resend"}>Send it again</Seal>}
          </div>
          {otherEmail("Wrong email?")}
        </>}
        {note ? <p>{note}</p> : null}
        {problemLine}
      </> : null}
    </Step>
    <Step n={4} title="Check your email again" done={done[3]}>
      {now === 3 ? <>
        <p>TestFlight emailed <b>{email}</b> an invite to Kimono. Open it on this iPhone, tap <b>View in TestFlight</b>, then <b>Install</b>.</p>
        <div className="get-app-actions">
          <Seal onClick={() => check()} busy={busy === "check"}>I&apos;ve installed it</Seal>
          <Seal tone="quiet" onClick={resend} busy={busy === "resend"}>Send it again</Seal>
        </div>
        {note ? <p>{note}</p> : null}
        {problemLine}
      </> : null}
    </Step>
    <Step n={5} title="Sign in to Kimono">
      {now === 4 ? <>
        {address
          ? <p>Open Kimono, tap <b>Use a different address</b>, enter <b>{address}</b>, then sign in as you do here.</p>
          : <p>Open Kimono and sign in as you do here.</p>}
        <p>Kimono&apos;s other iPhone apps are asked for inside the Kimono app.</p>
      </> : null}
    </Step>
  </ol>;
}
