"use client";

import { useId, useState } from "react";
import { Seal, Tutorial } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { mobileAppSteps, type MobileApp, type MobileOS } from "@/lib/mobile-app";

export function MobileAppTutorial({ app, serverUrl, os, onClose, onContinue }: {
  app: MobileApp; serverUrl: string; os: MobileOS; onClose: () => void; onContinue: () => void;
}) {
  const addressId = useId();
  const [copyStatus, setCopyStatus] = useState("");
  return <Tutorial title={`Set up ${app.name}`} description="Use the mobile app or continue in your browser."
    onClose={onClose} onSkip={onContinue} onComplete={onContinue}
    skipLabel="Skip — open in browser" completeLabel="Open in browser"
    footer={<Crossing kind="hanafubuki" external href={app.guideUrl} target="_blank" rel="noopener noreferrer">Setup guide ↗</Crossing>}
    steps={mobileAppSteps(app).map(step => ({ ...step, content:
      step.kind === "download" ? <div className="mobile-app-downloads">
        {os !== "android" && app.iosUrl && <Crossing kind="hanafubuki" external className="k-seal" href={app.iosUrl} target="_blank" rel="noopener noreferrer">Download on the App Store ↗</Crossing>}
        {os !== "ios" && app.androidUrl && <Crossing kind="hanafubuki" external className="k-seal" href={app.androidUrl} target="_blank" rel="noopener noreferrer">Get it on Google Play ↗</Crossing>}
        {((os === "ios" && !app.iosUrl) || (os === "android" && !app.androidUrl)) && <p>No download is available for this device. You can continue in your browser.</p>}
      </div> : step.kind === "server" ? <div className="mobile-app-server">
        <label htmlFor={addressId}>Your server address</label>
        <input id={addressId} readOnly value={serverUrl} onFocus={event => event.target.select()} />
        <Seal tone="quiet" onClick={async () => {
          try { await navigator.clipboard.writeText(serverUrl); setCopyStatus("Address copied"); }
          catch { setCopyStatus("Select the address above to copy it."); }
        }}>Copy address</Seal>
        <p role="status">{copyStatus}</p>
      </div> : undefined,
    }))} />;
}
