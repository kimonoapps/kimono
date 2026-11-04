"use client";

import { useState, useSyncExternalStore } from "react";
import { Crossing } from "@/components/crossing";
import { detectMobileOS, type MobileOS } from "@/lib/mobile-app";

const hidden = "kimono-app-offer-hidden";

/* Which phone this is, unless it has said not now. Read on the device only: the server renders nothing. */
function phone(): MobileOS {
  try { if (window.localStorage.getItem(hidden) === "1") return null; } catch { /* private window: ask anyway */ }
  return detectMobileOS(navigator);
}
const never = () => () => {};

/** On a phone, a line saying the Kimono app is ready, leading to the steps for that phone. */
export function KimonoAppOffer({ android, ios }: { android: boolean; ios: boolean }) {
  const detected = useSyncExternalStore(never, phone, () => null);
  const [later, setLater] = useState(false);
  const os = later ? null : detected;
  if (!os || (os === "android" && !android) || (os === "ios" && !ios)) return null;

  function notNow() {
    try { window.localStorage.setItem(hidden, "1"); } catch { /* nothing to remember it in */ }
    setLater(true);
  }

  return <section className="app-offer" aria-label="The Kimono app">
    <p className="app-offer-line"><strong>The Kimono {os === "ios" ? "iOS" : "Android"} app is ready!</strong></p>
    <Crossing kind="kakejiku" href={`/get-app?for=${os}`} className="k-seal app-offer-go">Try it here</Crossing>
    <button type="button" className="app-offer-later" onClick={notNow}>Not now</button>
  </section>;
}
