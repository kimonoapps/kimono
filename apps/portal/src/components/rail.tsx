"use client";

import { Crossing } from "@/components/crossing";
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AppBloom, cx, type GlyphName } from "@kimono/ui";
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
 * The rail (ADR 0006): Home, then My apps in your order (every
 * app comes up with ⌘K / Ctrl+K);
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
  const [pins, savePins] = usePins(defaultPins);
  const [sheet, setSheet] = useState(false);
  const hereRoom = useHereRoom(rooms);
  /* ⌘K / Ctrl+K brings up every app, from anywhere; again, or Escape, puts it away. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") { event.preventDefault(); setSheet((open) => !open); }
      else if (event.key === "Escape") setSheet(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null | "end">(null);
  const byId = new Map(apps.map((app) => [app.id, app]));
  const pinned = pins.filter((id) => byId.has(id));
  /* Apps in My apps that this person can't open right now keep their place at the end. */
  const setPins = (next: string[]) => savePins([...next, ...pins.filter((id) => !byId.has(id))]);
  const shown = current && !pinned.includes(current) ? [...pinned, current] : pinned;
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

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
    {shown.length ? <span className="rail-divider k-ink-rule" aria-hidden="true" /> : null}
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
            onContextMenu={(event) => { event.preventDefault(); setMenu({ id, x: event.clientX, y: event.clientY }); }}
          >
            <span className="rail-pill"><AppBloom identity={{ id: app.id, name: app.name, accent: app.accent, glyph: app.glyph }} glyphHref={app.iconUrl || undefined} size="mark" />{app.external ? <span className="rail-away" title="Opens another website"><LineIcon name="out" /></span> : null}</span><RailLabel text={app.name} />
          </Crossing>
          {open && rooms?.length ? <div className="rail-rooms">
            {rooms.map((room) => <Crossing kind="kakejiku" key={room.href} className="rail-dest rail-room" href={room.href} aria-current={room.href === hereRoom ? "page" : undefined}><span className="rail-pill"><LineIcon name={room.icon ?? "book"} /></span><RailLabel text={room.label} /></Crossing>)}
          </div> : null}
        </div>;
      })}
    </div>
    <span className="rail-spacer" />
    <span className="rail-divider k-ink-rule" aria-hidden="true" />
    <Crossing kind="kakejiku" className="rail-dest rail-you" href="/account" aria-current={active === "account" ? "page" : undefined}><span className="rail-pill">{you}</span>You</Crossing>
    {admin ? <Crossing kind="kakejiku" className="rail-dest rail-admin" href="/admin" aria-current={active === "admin" ? "page" : undefined}>
      <span className="rail-pill"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 19 6.5v5.5c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V6.5z"/></svg></span>Admin
    </Crossing> : null}
    {menu && byId.has(menu.id) ? (() => {
      const app = byId.get(menu.id)!, at = pinned.indexOf(menu.id);
      const move = (by: number) => { const next = [...pinned]; next.splice(at, 1); next.splice(at + by, 0, menu.id); setPins(next); };
      return <PinMenu x={menu.x} y={menu.y} label={app.name} onClose={() => setMenu(null)}>
        {!app.external ? <button type="button" role="menuitem" tabIndex={-1} onClick={() => window.open(app.href, "_blank", "noopener")}><LineIcon name="out" />Open in new tab</button> : null}
        {at > 0 ? <button type="button" role="menuitem" tabIndex={-1} onClick={() => move(-1)}><LineIcon name="up" />Move up</button> : null}
        {at >= 0 && at < pinned.length - 1 ? <button type="button" role="menuitem" tabIndex={-1} onClick={() => move(1)}><LineIcon name="down" />Move down</button> : null}
        {at >= 0
          ? <button type="button" role="menuitem" tabIndex={-1} onClick={() => setPins(pinned.filter((pin) => pin !== menu.id))}><LineIcon name="unpin" />Remove from My apps</button>
          : <button type="button" role="menuitem" tabIndex={-1} onClick={() => setPins([...pinned, menu.id])}><LineIcon name="pin" />Add to My apps</button>}
      </PinMenu>;
    })() : null}
    {sheet ? <div className="rail-scrim" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSheet(false); }} onKeyDown={(event) => { if (event.key === "Escape") setSheet(false); }}>
      <div className="rail-sheet" role="dialog" aria-modal="true" aria-label="Your apps">
        <div className="rail-sheet-head"><h2>Your apps</h2><button className="rail-sheet-close" type="button" onClick={() => setSheet(false)} aria-label="Close">×</button></div>
        <AppTiles apps={apps} mine={pins} compact onOpen={() => setSheet(false)} />
      </div>
    </div> : null}
  </nav>;
}

/** A pin's right-click menu, placed at the pointer and kept on screen. */
function PinMenu({ x, y, label, onClose, children }: { x: number; y: number; label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const edge = 8, { width, height } = element.getBoundingClientRect();
    element.style.left = `${Math.min(x, window.innerWidth - width - edge)}px`;
    element.style.top = `${Math.max(edge, Math.min(y, window.innerHeight - height - edge))}px`;
    element.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, [x, y]);
  useEffect(() => {
    const away = (event: Event) => { if (!box.current?.contains(event.target as Node)) onClose(); };
    const keys = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", keys);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", keys);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  return <div ref={box} className="rail-menu" role="menu" aria-label={label}
    onKeyDown={(event) => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"));
      const index = items.indexOf(document.activeElement as HTMLElement);
      const go = (to: number) => { event.preventDefault(); items[(to + items.length) % items.length]?.focus(); };
      if (event.key === "ArrowDown") go(index + 1);
      else if (event.key === "ArrowUp") go(index - 1);
      else if (event.key === "Tab") onClose();
    }}
    onClick={(event) => { if ((event.target as HTMLElement).closest("[role=menuitem]")) onClose(); }}>
    {children}
  </div>;
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
