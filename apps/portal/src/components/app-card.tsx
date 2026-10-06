"use client";

import { useState } from "react";
import { Crossing, useCrossTo } from "@/components/crossing";
import type { KimonoApp } from "@/lib/apps";
import { detectMobileOS, type MobileOS } from "@/lib/mobile-app";
import { MobileAppTutorial } from "./mobile-app-tutorial";
import { AppBloom } from "@kimono/ui";

/**
 * Every app crosses on 花吹雪, whether Kimono wrote it or only hosts it. The
 * blossom marks opening an app, not leaving the house.
 */
export function AppLauncher({ apps }: { apps: KimonoApp[] }) {
  const [selected, setSelected] = useState<KimonoApp | null>(null);
  const [mobileOS, setMobileOS] = useState<MobileOS>(null);
  const crossTo = useCrossTo();

  function continueInBrowser() {
    setSelected(null);
    if (selected) crossTo("hanafubuki", selected.href, selected.external, selected.accent);
  }

  return (
    <section className="launcher-section" aria-labelledby="apps-heading">
      <h2 id="apps-heading">Applications</h2>
      <div className="launcher-grid">
        {apps.map((app, index) => (
          <Crossing className="launcher-app" kind="hanafubuki" external={app.external} destinationAccent={app.accent} href={app.href} key={app.id} onClick={(event) => {
            if (!app.mobileApp || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            const os = detectMobileOS(navigator);
            if (!os && !window.matchMedia("(max-width: 940px), (pointer: coarse)").matches) {
              return;
            }
            event.preventDefault();
            setMobileOS(os);
            setSelected(app);
          }} style={{ "--app-order": index } as React.CSSProperties} aria-label={`Open Kimono ${app.name}: ${app.description}`}>
            <span className="app-cord" aria-hidden="true"><i /><i /><b /></span>
            <span className="app-ema">
              <span className="ema-grain" aria-hidden="true" />
              {/* A hosted app ships an icon file; Kimono's own draw their
                  bloom from the same identity the header uses. */}
              <span className="launcher-icon">
                <AppBloom identity={{ id: app.id, name: app.shortName, accent: app.accent, glyph: app.glyph }} glyphHref={app.iconUrl || undefined} />
              </span>
              <span className="ema-copy">
                <span className="launcher-name">{app.name}</span>
                <span className="launcher-status">Open{app.external ? " app" : ""} <span aria-hidden="true">{app.external ? "↗" : "→"}</span></span>
              </span>
            </span>
            <span className="ema-tassel" aria-hidden="true"><i /><i /><i /></span>
          </Crossing>
        ))}
      </div>
      {selected?.mobileApp && <MobileAppTutorial key={selected.id} app={selected.mobileApp} serverUrl={selected.href} os={mobileOS} onClose={() => setSelected(null)} onContinue={continueInBrowser} />}
    </section>
  );
}
