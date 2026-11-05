"use client";

import { Crossing } from "@/components/crossing";
import { useState, type DragEvent, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AppBloom, cx, type GlyphName } from "@kimono/ui";
import { GridIcon } from "@/components/icons";
import { usePins } from "@/components/pins";
import { AppTiles } from "@/components/app-card";
import { LineIcon, type LineIconName } from "@/components/line-icon";

export type RailApp = {
  id: string;
  name: string;
  description: string;
  href: string;
  external: boolean;
  accent: string;
  glyph?: GlyphName;
  iconUrl?: string;
};
/**
 * A rail stop's name. Joined words (RateMyProfessors) may break where they join, so a long name
 * takes two lines ("RateMy / Professors") instead of being cut; the CSS ends anything longer in an
 * ellipsis, and the whole name shows on hover.
 */
function RailLabel({ text }: { text: string }) {
  const parts = text.split(/(?<=[a-z])(?=[A-Z])/);
  return <span className="rail-label" title={text}>{parts.map((part, index) => <span key={index}>{index ? <wbr /> : null}{part}</span>)}</span>;
}

export type RailRoom = { href: string; label: string; here?: boolean; icon?: LineIconName };

/**
 * Which room you're in, read from the live address: apps like Drive move by
 * their own history entries, so what the server said on arrival goes stale.
 * The room whose path and query both match wins; a room with no query is the
 * fallback for its path.
 */
function useHereRoom(rooms: RailRoom[] | undefined) {
  const pathname = usePathname();
  const search = useSearchParams();
  if (!rooms?.length) return null;
  let best: { href: string; score: number } | null = null;
  for (const room of rooms) {
    const url = new URL(room.href, "http://x");
    if (url.pathname !== pathname) continue;
    const wanted = [...url.searchParams];
    if (!wanted.every(([key, value]) => search.get(key) === value)) continue;
    if (!best || wanted.length > best.score) best = { href: room.href, score: wanted.length };
  }
  return best?.href ?? rooms.find((room) => room.here)?.href ?? null;
}

/*
 * The rail (ADR 0006): Home, Apps, then the apps you pinned in your order;
 * the app you're in opens its own rooms beneath it, in place. You and Admin
 * sit at the foot. On a phone it becomes the bottom bar.
 */
export function Rail({ apps, current, rooms, active, admin, you, defaultPins }: {
  apps: RailApp[];
  /** The app this page belongs to, if any. */
  current?: string;
  rooms?: RailRoom[];
  active?: "home" | "admin" | "account";
  admin: boolean;
  you: ReactNode;
  defaultPins: string[];
}) {
  const [pins, setPins] = usePins(defaultPins);
  const [sheet, setSheet] = useState(false);
  const hereRoom = useHereRoom(rooms);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null | "end">(null);
  const byId = new Map(apps.map((app) => [app.id, app]));
  const pinned = pins.filter((id) => byId.has(id));
  // Home already lays out every app, so the rail keeps its pins for inside apps.
  const shown = active === "home" ? [] : current && !pinned.includes(current) ? [...pinned, current] : pinned;

  function drop(event: DragEvent) {
    event.preventDefault();
    const id = dragging ?? event.dataTransfer.getData("text/kimono-app");
    if (!id || !byId.has(id)) return;
    const next = pinned.filter((pin) => pin !== id);
    const at = dropBefore && dropBefore !== "end" ? next.indexOf(dropBefore) : next.length;
    next.splice(at < 0 ? next.length : at, 0, id);
    setPins(next);
    setDragging(null); setDropBefore(null);
  }

  return <nav className="rail" aria-label="Kimono">
    <Crossing kind="kakejiku" className="rail-mark" href="/" aria-label="Kimono home"><Branch /></Crossing>
    <Crossing kind="kakejiku" className="rail-dest" href="/" aria-current={active === "home" ? "page" : undefined}>
      <span className="rail-pill"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5"/></svg></span>Home
    </Crossing>
    <button className="rail-dest" type="button" aria-haspopup="dialog" onClick={() => setSheet(true)}>
      <span className="rail-pill"><GridIcon /></span>Apps
    </button>
    {shown.length ? <span className="rail-divider" aria-hidden="true" /> : null}
    <div className="rail-pins" onDragOver={(event) => { if (dragging || event.dataTransfer.types.includes("text/kimono-app")) { event.preventDefault(); } }} onDrop={drop}>
      {shown.map((id) => {
        const app = byId.get(id)!;
        const open = id === current, isPinned = pinned.includes(id);
        return <div key={id} className="rail-pin">
          <Crossing kind="kakejiku"
            className={cx("rail-dest", open && "is-open", !isPinned && "is-visiting", dropBefore === id && "drop-before", dragging === id && "is-dragging")}
            href={app.href}
            external={app.external}
            aria-current={open ? "page" : undefined}
            draggable={isPinned}
            onDragStart={(event) => { setDragging(id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/kimono-app", id); }}
            onDragOver={(event) => { const r = event.currentTarget.getBoundingClientRect(); setDropBefore(event.clientY < r.top + r.height / 2 ? id : shown[shown.indexOf(id) + 1] ?? "end"); }}
            onDragEnd={() => { setDragging(null); setDropBefore(null); }}
          >
            <span className="rail-pill"><AppBloom identity={{ id: app.id, name: app.name, accent: app.accent, glyph: app.glyph }} glyphHref={app.iconUrl || undefined} size="mark" /></span><RailLabel text={app.name} />
          </Crossing>
          {open && rooms?.length ? <div className="rail-rooms">
            {rooms.map((room) => <Crossing kind="kakejiku" key={room.href} className="rail-dest rail-room" href={room.href} aria-current={room.href === hereRoom ? "page" : undefined}><span className="rail-pill"><LineIcon name={room.icon ?? "book"} /></span><RailLabel text={room.label} /></Crossing>)}
          </div> : null}
        </div>;
      })}
    </div>
    <span className="rail-spacer" />
    <span className="rail-divider" aria-hidden="true" />
    <Crossing kind="kakejiku" className="rail-dest rail-you" href="/account" aria-current={active === "account" ? "page" : undefined}><span className="rail-pill">{you}</span>You</Crossing>
    {admin ? <Crossing kind="kakejiku" className="rail-dest rail-admin" href="/admin" aria-current={active === "admin" ? "page" : undefined}>
      <span className="rail-pill"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 19 6.5v5.5c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V6.5z"/></svg></span>Admin
    </Crossing> : null}
    {sheet ? <div className="rail-scrim" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSheet(false); }} onKeyDown={(event) => { if (event.key === "Escape") setSheet(false); }}>
      <div className="rail-sheet" role="dialog" aria-modal="true" aria-label="Your apps">
        <div className="rail-sheet-head"><h2>Your apps</h2><button className="rail-sheet-close" type="button" onClick={() => setSheet(false)} aria-label="Close">×</button></div>
        <AppTiles apps={apps} compact onOpen={() => setSheet(false)} />
      </div>
    </div> : null}
  </nav>;
}

/** Kimono's ink branch, small, for the top of the rail. */
function Branch() {
  return <svg viewBox="1 12 111 106" aria-hidden="true"><g fill="currentColor">
    <path d="M2 108 C26 98 43 84 55 66 C62 55 71 47 79 43 L81 47 C73 51 66 60 59 72 C47 90 30 106 6 116Z"/>
    <path d="M56 69 C55 61 52 54 47 47 L50 44 C56 51 59 59 59.5 66Z"/>
    <path d="M27 97 C40 96 51 100 58 108 L55 111 C49 104 39 100 27 100Z"/>
    <g transform="translate(83 41) scale(.55) translate(-50 -50)">
      {[0, 72, 144, 216, 288].map((a) => <path key={a} transform={`rotate(${a} 50 50)`} d="M50 48 C36 39 31 21 41 9 C45 4 50 2 50 2 C55 4 59 7 62 11 C69 22 63 39 50 48Z"/>)}
      <circle cx="50" cy="50" r="13"/>
    </g>
  </g></svg>;
}
