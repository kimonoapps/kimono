"use client";

import { Crossing, useCrossTo } from "@/components/crossing";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { AppBloom, Seal, cx } from "@kimono/ui";
import { detectMobileOS, type MobileOS } from "@/lib/mobile-app";
import type { KimonoApp } from "@/lib/apps";
import { noteUse, usePins } from "./pins";
import type { RailApp } from "./rail";
import { betaApps, newApps } from "@/lib/app-categories";

type TileApp = RailApp & { mobileApp?: KimonoApp["mobileApp"]; /** One live line ("9 spaces · 2 new files today") in place of the description. */ line?: string; };

/*
 * The app grid: every app is a tile with its inked bloom and its name. Hover
 * shows a pin; a pinned app is one of My apps, on the rail and the phone's flower. A tile can also be
 * dragged onto the rail. Home shows it full size, the Apps sheet compact.
 */
export function AppTiles({ apps, mine = [], compact = false, onOpen, onReorder }: {
  apps: TileApp[];
  /** My apps as the page was sent. */
  mine?: string[];
  compact?: boolean;
  onOpen?: () => void;
  /** Given, the tiles can be dragged among themselves into a new order. */
  onReorder?: (ids: string[]) => void;
}) {
  const [pins, setPins] = usePins(mine);
  const crossTo = useCrossTo();
  const [asking, setAsking] = useState<{ app: TileApp; os: MobileOS } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const order = apps.map((app) => app.id);
  function drop() {
    if (!dragging || !onReorder) return;
    const next = order.filter((id) => id !== dragging);
    const at = dropBefore && dropBefore !== "end" ? next.indexOf(dropBefore) : next.length;
    next.splice(at < 0 ? next.length : at, 0, dragging);
    onReorder(next);
  }

  function open(app: TileApp, event: MouseEvent) {
    noteUse(app.id);
    onOpen?.();
    /* On a phone, an app with its own phone app asks: that, or carry on in the browser. */
    if (!app.mobileApp || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const os = detectMobileOS(navigator);
    if (!os && !window.matchMedia("(max-width: 940px), (pointer: coarse)").matches) return;
    event.preventDefault();
    setAsking({ app, os });
  }

  return <>
    <div className={cx("app-tiles", compact && "is-compact")}>
      {apps.map((app) => {
        const pinned = pins.includes(app.id);
        return <div className={cx("app-tile", dragging === app.id && "is-dragging", dropBefore === app.id && "drop-before")} key={app.id}
          onDragOver={onReorder && dragging ? (event) => {
            event.preventDefault();
            const box = event.currentTarget.getBoundingClientRect();
            setDropBefore(event.clientX < box.left + box.width / 2 ? app.id : order[order.indexOf(app.id) + 1] ?? "end");
          } : undefined}
          onDrop={onReorder && dragging ? (event) => { event.preventDefault(); drop(); } : undefined}>
          <Crossing kind="kakejiku"
            className="app-tile-link"
            href={app.href}
            external={app.external}
            draggable
            onDragStart={(event) => { event.dataTransfer.setData("text/kimono-app", app.id); event.dataTransfer.effectAllowed = "copyMove"; if (onReorder) setDragging(app.id); }}
            onDragEnd={() => { setDragging(null); setDropBefore(null); }}
            onClick={(event) => open(app, event)}
            aria-label={`Open Kimono ${app.name}${app.external ? " in a new tab" : ""}: ${app.description}`}
          >
            <AppBloom identity={{ id: app.id, name: app.name, accent: app.accent, glyph: app.glyph }} glyphHref={app.iconUrl || undefined} className="app-tile-bloom" />
            <span className="app-tile-name"><b>{app.name}</b>{newApps.includes(app.id) ? <span className="k-chip k-wants">New</span> : null}{betaApps.includes(app.id) ? <span className="k-chip">Beta</span> : null}</span>
            <small>{app.line ?? app.description}</small>
          </Crossing>
          {app.external ? <svg className="app-tile-out" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg> : null}
          <button className="app-tile-pin" type="button" aria-pressed={pinned} aria-label={pinned ? `Remove ${app.name} from My apps` : `Add ${app.name} to My apps`} title={pinned ? "In My apps" : "Add to My apps"}
            onClick={() => setPins(pinned ? pins.filter((id) => id !== app.id) : [...pins, app.id])}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5h6M10 3.5v6l-3 3.5h10l-3-3.5v-6M12 13v7.5"/></svg>
          </button>
        </div>;
      })}
    </div>
    {asking ? <AppOrBrowser name={asking.app.name} onClose={() => setAsking(null)}
      onApp={() => { flushSync(() => setAsking(null)); crossTo("hanafubuki", asking.os ? `/get-app?for=${asking.os}` : "/get-app", false); }}
      onBrowser={() => { flushSync(() => setAsking(null)); crossTo("kakejiku", asking.app.href, asking.app.external); }} /> : null}
  </>;
}

/** Get the phone app, or open this one in the browser. */
function AppOrBrowser({ name, onApp, onBrowser, onClose }: { name: string; onApp: () => void; onBrowser: () => void; onClose: () => void }) {
  const box = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!box.current?.open) box.current?.showModal(); }, []);
  return <dialog ref={box} className="k-tutorial app-or-browser" aria-labelledby="app-or-browser-title" onClose={onClose} onClick={(event) => { if (event.target === box.current) box.current?.close(); }}>
    <header className="k-tutorial-header">
      <Seal compact tone="quiet" className="k-tutorial-close" aria-label="Close" onClick={() => box.current?.close()}>×</Seal>
      <h2 id="app-or-browser-title">{name}</h2>
    </header>
    <footer className="k-tutorial-footer">
      <Seal onClick={onApp}>Get the app</Seal>
      <Seal tone="quiet" onClick={onBrowser}>Open in browser</Seal>
    </footer>
  </dialog>;
}
