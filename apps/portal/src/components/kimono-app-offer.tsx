"use client";

import { useState, useSyncExternalStore } from "react";
import { InkBlot, InkCard } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { detectMobileOS, type MobileOS } from "@/lib/mobile-app";

const hidden = "kimono-app-offer-hidden";

/* Which phone this is ("desktop" on a computer), unless it has said not now. Read on the device only: the server renders nothing. */
function phone(): MobileOS | "desktop" {
  try { if (window.localStorage.getItem(hidden) === "1") return null; } catch { /* private window: ask anyway */ }
  return detectMobileOS(navigator) ?? "desktop";
}
const never = () => () => {};

/** On a phone, a line saying the Kimono app is ready, leading to the steps for that phone: at the top of Home. On a computer, a card under the grid. */
export function KimonoAppOffer({ android, ios, place }: { android: boolean; ios: boolean; place: "top" | "bottom" }) {
  const detected = useSyncExternalStore(never, phone, () => null);
  const [later, setLater] = useState(false);
  const os = later ? null : detected;
  if (!os || (os === "android" && !android) || (os === "ios" && !ios) || (os === "desktop" && !android && !ios)) return null;
  if ((os === "desktop") !== (place === "bottom")) return null;

  function notNow() {
    try { window.localStorage.setItem(hidden, "1"); } catch { /* nothing to remember it in */ }
    setLater(true);
  }

  /* On a computer: a card under the grid, as in the mockup, leading to the steps. */
  if (os === "desktop") return <InkCard colour="#a84d63" seed="app-offer" className="app-offer-ink"><Crossing kind="kakejiku" href="/get-app" className="card app-offer-card">
    <InkBlot tint="#a84d63" seed="phone"><LineIcon name="phone" /></InkBlot>
    <span><b>Kimono is on your phone too</b><small>Drive in your Files app, uploads in the background.</small></span>
    <span className="k-seal k-tone-quiet">Get the app</span>
  </Crossing></InkCard>;

  return <section className="app-offer" aria-label="The Kimono app">
    <p className="app-offer-line"><strong>The Kimono {os === "ios" ? "iOS" : "Android"} app is ready!</strong></p>
    <Crossing kind="kakejiku" href={`/get-app?for=${os}`} className="k-seal app-offer-go">Try it here</Crossing>
    <button type="button" className="app-offer-later" onClick={notNow}>Not now</button>
  </section>;
}
