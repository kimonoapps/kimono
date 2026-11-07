"use client";

import { Crossing, useCrossTo } from "@/components/crossing";
import { useState, type MouseEvent } from "react";
import { AppBloom, cx } from "@kimono/ui";
import type { KimonoApp } from "@/lib/apps";
import { detectMobileOS, type MobileOS } from "@/lib/mobile-app";
import { MobileAppTutorial } from "./mobile-app-tutorial";
import { usePins } from "./pins";
import type { RailApp } from "./rail";

type TileApp = RailApp & { mobileApp?: KimonoApp["mobileApp"]; /** One live line ("9 spaces · 2 new files today") in place of the description. */ line?: string };

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
  const [selected, setSelected] = useState<TileApp | null>(null);
  const [mobileOS, setMobileOS] = useState<MobileOS>(null);
  const crossTo = useCrossTo();
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
    onOpen?.();
    /* On a phone, an app with its own phone app offers that first. */
    if (!app.mobileApp || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const os = detectMobileOS(navigator);
    if (!os && !window.matchMedia("(max-width: 940px), (pointer: coarse)").matches) return;
    event.preventDefault();
    setMobileOS(os);
    setSelected(app);
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
            <b>{app.name}</b>
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
    {selected?.mobileApp && <MobileAppTutorial key={selected.id} app={selected.mobileApp} serverUrl={selected.href} os={mobileOS} onClose={() => setSelected(null)} onContinue={() => { setSelected(null); crossTo("kakejiku", selected.href, selected.external); }} />}
  </>;
}
