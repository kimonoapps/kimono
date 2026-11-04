"use client";

import { useState, useSyncExternalStore } from "react";
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
      <li>{offer.ios.link.startsWith("https://")
        ? <>Open <Crossing kind="hanafubuki" external href={offer.ios.link} target="_blank" rel="noopener noreferrer">your invite</Crossing> and install Kimono.</>
        : <>Open the TestFlight invite from whoever runs your Kimono, and install Kimono.</>}</li>
      {address}
    </ol> : null}
    <button type="button" className="app-offer-later" onClick={notNow}>Not now</button>
  </section>;
}
