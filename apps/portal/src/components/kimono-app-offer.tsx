"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { Crossing } from "@/components/crossing";
import { detectMobileOS, type MobileOS } from "@/lib/mobile-app";

export type AppOffer = {
  /** The newest Android package, when one is published. */
  android: { version: string; build: number; size: number | null } | null;
  /** Where iPhones get Kimono (TestFlight), when an iPhone version is published. */
  ios: { link: string } | null;
  /** This Kimono's address, when it isn't the one the app opens by default. */
  address: string | null;
};

const hidden = "kimono-app-offer-hidden";

type Standing = "tester" | "invited" | "waiting" | "problem" | "none";
const said: Record<Standing, string> = {
  tester: "You're in. Open TestFlight and install Kimono.",
  invited: "Apple has emailed that address an invite. Accept it, then come back and send again.",
  waiting: "Your invite is on its way. Try again in a minute.",
  problem: "Apple didn't take that. Check the address and try again.",
  none: "",
};

/** Asks for the person's Apple ID and has this Kimono invite it to TestFlight, then says what to do next. */
function JoinTestflight() {
  const [appleId, setAppleId] = useState("");
  const [state, setState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  /* Someone coming back after accepting Apple's email finds their address already in. */
  useEffect(() => {
    let current = true;
    fetch("/api/v1/app/testflight", { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() as Promise<{ appleId?: string | null; status?: Standing }> : null)
      .then((body) => {
        if (!current || !body?.appleId) return;
        setAppleId((typed) => typed || body.appleId || "");
        if (body.status && said[body.status]) setState({ busy: false, message: said[body.status] });
      })
      .catch(() => {});
    return () => { current = false; };
  }, []);
  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ busy: true, message: null });
    try {
      const response = await fetch("/api/v1/app/testflight", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appleId }),
      });
      const body = await response.json().catch(() => ({})) as { status?: Standing; error?: string };
      setState({ busy: false, message: body.status ? said[body.status] || said.waiting : body.error || "That didn't work. Try again." });
    } catch {
      setState({ busy: false, message: "Kimono isn't answering. Try again in a moment." });
    }
  }
  return <form className="app-offer-join" onSubmit={join}>
    <label htmlFor="app-offer-apple-id">Your Apple ID email (the one your iPhone uses)</label>
    <input id="app-offer-apple-id" type="email" required autoComplete="email" inputMode="email" placeholder="you@icloud.com" value={appleId} onChange={(event) => setAppleId(event.target.value)} />
    <button type="submit" className="k-seal" disabled={state.busy}><span>{state.busy ? "Asking Apple…" : "Send my invite"}</span></button>
    {state.message ? <p className="app-offer-detail" role="status">{state.message}</p> : null}
  </form>;
}

/* Which phone this is, unless it has said not now. Read on the device only: the server renders nothing. */
function phone(): MobileOS {
  try { if (window.localStorage.getItem(hidden) === "1") return null; } catch { /* private window: ask anyway */ }
  return detectMobileOS(navigator);
}
const never = () => () => {};

/**
 * On a phone, the Kimono app: Android downloads it from here; an iPhone is
 * walked through TestFlight. Shown only on the kind of phone it's for, and
 * only until someone says not now.
 */
export function KimonoAppOffer({ offer }: { offer: AppOffer }) {
  const detected = useSyncExternalStore(never, phone, () => null);
  const [later, setLater] = useState(false);
  const os = later ? null : detected;
  if (os === "android" && !offer.android) return null;
  if (os === "ios" && !offer.ios) return null;
  if (!os) return null;

  function notNow() {
    try { window.localStorage.setItem(hidden, "1"); } catch { /* nothing to remember it in */ }
    setLater(true);
  }

  const address = offer.address
    ? <li>Open Kimono, tap <b>Use a different address</b> and enter <b>{offer.address}</b>, then sign in as you do here.</li>
    : <li>Open Kimono and sign in as you do here.</li>;

  return <section className="app-offer" aria-labelledby="app-offer-title">
    <h2 id="app-offer-title">Get the Kimono app</h2>
    <p>Drive, uploads that carry on with the app closed, and your account, in one app.</p>
    {os === "android" && offer.android ? <>
      {/* eslint-disable-next-line no-restricted-syntax -- a download stays on this page; there is no crossing to make. */}
      <a className="k-seal" href={`/api/v1/app/packages/${offer.android.build}`} download>
        <span>Download for Android</span>
      </a>
      <p className="app-offer-detail">Kimono {offer.android.version}{offer.android.size ? ` · ${(offer.android.size / 1_000_000).toFixed(0)} MB` : ""}</p>
      <ol>
        <li>Open the download. If Android asks, let your browser install apps.</li>
        {address}
      </ol>
    </> : null}
    {os === "ios" && offer.ios ? <ol>
      <li>Install <Crossing kind="hanafubuki" external href="https://apps.apple.com/app/testflight/id899247664" target="_blank" rel="noopener noreferrer">TestFlight</Crossing> from the App Store. It&apos;s how Kimono for iPhone arrives.</li>
      <li><JoinTestflight /></li>
      {address}
    </ol> : null}
    <button type="button" className="app-offer-later" onClick={notNow}>Not now</button>
  </section>;
}
