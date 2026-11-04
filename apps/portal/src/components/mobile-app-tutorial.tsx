"use client";

import { useId, useState } from "react";
import { Seal, Tutorial } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { isPortalPath, mobileAppSteps, openLink, type MobileApp, type MobileOS } from "@/lib/mobile-app";

/** A store link's button wording, from where it leads. */
function downloadLabel(url: string, phone: "ios" | "android") {
  if (phone === "ios") return isPortalPath(url) ? "Get it with TestFlight" : /^https:\/\/apps\.apple\.com\//.test(url) ? "Download on the App Store ↗" : "Download for iPhone ↗";
  return /^https:\/\/play\.google\.com\//.test(url) ? "Get it on Google Play ↗" : "Download for Android";
}

function DownloadLink({ url, phone }: { url: string; phone: "ios" | "android" }) {
  const label = downloadLabel(url, phone);
  if (isPortalPath(url)) return <Crossing kind="hanafubuki" className="k-seal" href={url}>{label}</Crossing>;
  if (/\.apk$/i.test(new URL(url).pathname)) {
    /* eslint-disable-next-line no-restricted-syntax -- a package download stays on this page; there is no crossing to make. */
    return <a className="k-seal" href={url} download><span>{label}</span></a>;
  }
  return <Crossing kind="hanafubuki" external className="k-seal" href={url} target="_blank" rel="noopener noreferrer">{label}</Crossing>;
}

export function MobileAppTutorial({ app, serverUrl, os, onClose, onContinue }: {
  app: MobileApp; serverUrl: string; os: MobileOS; onClose: () => void; onContinue: () => void;
}) {
  const addressId = useId();
  const [copyStatus, setCopyStatus] = useState("");
  return <Tutorial title={`Set up ${app.name}`} description="Use the mobile app or continue in your browser."
    onClose={onClose} onSkip={onContinue} onComplete={onContinue}
    skipLabel="Skip — open in browser" completeLabel="Open in browser"
    footer={app.guideUrl && <Crossing kind="hanafubuki" external href={app.guideUrl} target="_blank" rel="noopener noreferrer">Setup guide ↗</Crossing>}
    steps={mobileAppSteps(app).map(step => ({ ...step, content:
      step.kind === "download" ? <div className="mobile-app-downloads">
        {os !== "android" && app.iosUrl && <DownloadLink url={app.iosUrl} phone="ios" />}
        {os !== "ios" && app.androidUrl && <DownloadLink url={app.androidUrl} phone="android" />}
        {((os === "ios" && !app.iosUrl) || (os === "android" && !app.androidUrl)) && <p>No download is available for this device. You can continue in your browser.</p>}
      </div> : step.kind === "server" ? <div className="mobile-app-server">
        <label htmlFor={addressId}>Your server address</label>
        <input id={addressId} readOnly value={serverUrl} onFocus={event => event.target.select()} />
        <Seal tone="quiet" onClick={async () => {
          try { await navigator.clipboard.writeText(serverUrl); setCopyStatus("Address copied"); }
          catch { setCopyStatus("Select the address above to copy it."); }
        }}>Copy address</Seal>
        <p role="status">{copyStatus}</p>
      </div> : step.kind === "open" ? <div className="mobile-app-downloads">
        {os
          /* eslint-disable-next-line no-restricted-syntax -- opens the phone app, not a page; there is no crossing to make. */
          ? <a className="k-seal" href={openLink(step, serverUrl)}><span>{step.label}</span></a>
          : <p>Open this page on your phone to continue.</p>}
      </div> : undefined,
    }))} />;
}
