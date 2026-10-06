"use client";

import { useEffect, useRef, useState } from "react";
import { Crossing, useCrossTo } from "@/components/crossing";
import type { KimonoApp } from "@/lib/apps";
import { AppBloom } from "@kimono/ui";

/**
 * Every app crosses on 花吹雪, whether Kimono wrote it or only hosts it. The
 * blossom marks opening an app, not leaving the house.
 */
export function AppLauncher({ apps }: { apps: KimonoApp[] }) {
  const [selected, setSelected] = useState<KimonoApp | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const crossTo = useCrossTo();

  useEffect(() => {
    const modal = dialog.current;
    if (!selected || !modal) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (typeof modal.showModal === "function") {
      modal.showModal();
    } else {
      modal.setAttribute("open", "");
      modal.dataset.fallback = "true";
    }
    modal.querySelector<HTMLButtonElement>("button")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelected(null);
      }
      if (event.key !== "Tab") return;
      const targets = Array.from(modal.querySelectorAll<HTMLElement>('button, a[href], input'));
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    modal.addEventListener("keydown", handleKey);
    return () => {
      modal.removeEventListener("keydown", handleKey);
      if (typeof modal.close === "function") modal.close();
      else modal.removeAttribute("open");
      delete modal.dataset.fallback;
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [selected]);

  function continueInBrowser() {
    setSelected(null);
    if (selected) crossTo("hanafubuki", selected.href, selected.external);
  }

  return (
    <section className="launcher-section" aria-labelledby="apps-heading">
      <h2 id="apps-heading">Applications</h2>
      <div className="launcher-grid">
        {apps.map((app, index) => (
          <Crossing className="launcher-app" kind="hanafubuki" external={app.external} href={app.href} key={app.id} onClick={(event) => {
            if (!app.mobileApp || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            if (!window.matchMedia("(max-width: 940px), (pointer: coarse)").matches) {
              return;
            }
            event.preventDefault();
            setSelected(app);
            setCopyStatus("");
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
      <dialog ref={dialog} className="mobile-app-tutorial" role="dialog" aria-modal="true" aria-labelledby="mobile-app-title" onClose={() => { if (!dialog.current?.open) setSelected(null); }}>
        {selected?.mobileApp && <>
          <button className="mobile-app-close" type="button" aria-label="Close tutorial" onClick={() => setSelected(null)}>×</button>
          <h2 id="mobile-app-title">Use the mobile app?</h2>
          <p>Set up {selected.name} on your phone with {selected.mobileApp.name}.</p>
          <ol>{selected.mobileApp.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
          <label htmlFor="mobile-server-address">Your server address</label>
          <input id="mobile-server-address" readOnly value={selected.href} onFocus={(event) => event.target.select()} />
          <button type="button" className="k-seal" onClick={async () => {
            try { await navigator.clipboard.writeText(selected.href); setCopyStatus("Address copied"); }
            catch { setCopyStatus("Select the address above to copy it."); }
          }}>Copy address</button>
          <p role="status">{copyStatus}</p>
          <div className="mobile-app-actions">
            <Crossing kind="hanafubuki" external className="k-seal" href={selected.mobileApp.guideUrl} target="_blank" rel="noopener noreferrer">Download guide ↗</Crossing>
            <button className="k-seal" type="button" onClick={continueInBrowser}>Skip — open in browser</button>
          </div>
        </>}
      </dialog>
      {selected && <div className="mobile-app-backdrop" aria-hidden="true" />}
    </section>
  );
}
