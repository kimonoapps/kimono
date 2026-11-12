"use client";

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Card, Prefs, Rating, TitleView } from "./api";
import { AppIcon } from "@/components/icons";
import { Icon } from "./icons";
import { LoadingIndicator } from "@/components/loading-indicator";

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

/* ───── What every part of Watch can ask of the app ───── */

export type Marks = { inList: boolean; rating: Rating | null; reminding: boolean };
export type Watch = {
  openTitle: (id: string) => void;
  play: (id: string, at?: { season: number; episode: number }) => void;
  /** Watch together: asks who to invite, then starts a party for this title (and episode). */
  together: (id: string, at?: { season: number; episode: number; position?: number }) => void;
  toast: (message: string) => void;
  marksOf: (id: string) => Marks;
  /** A title page answered: what it says about this person's marks wins. */
  noteView: (view: TitleView) => void;
  setListed: (id: string, on: boolean) => void;
  rate: (id: string, rating: Rating | null) => void;
  remind: (id: string, on: boolean, name: string) => void;
  /** Every card seen so far, for More like this and what to watch after. */
  known: () => Card[];
  firstName: string;
  /** Watch's own colour, for its loaders. */
  accent: string;
  /** This person's settings, once known; a change saves at once. */
  prefs: Prefs | null;
  updatePrefs: (change: Partial<Prefs>) => Promise<boolean>;
  openSettings: () => void;
};
export const WatchContext = createContext<Watch | null>(null);
export function useWatch() {
  const watch = useContext(WatchContext);
  if (!watch) throw new Error("Outside Kimono Watch");
  return watch;
}

/** Titles like this one from what Home showed: the same shelf first. */
export function alike(all: Card[], id: string, shelf: Card["shelf"], count: number) {
  const seen = new Set<string>([id]);
  const pick: Card[] = [];
  for (const card of [...all.filter((c) => c.shelf === shelf), ...all]) {
    if (seen.has(card.id) || !(card.backdrop || card.poster)) continue;
    seen.add(card.id); pick.push(card);
    if (pick.length >= count) break;
  }
  return pick;
}

/* ───── Pictures fade in as they arrive ───── */

export function Img({ src, alt = "", className, style, eager }: { src: string | null | undefined; alt?: string; className?: string; style?: CSSProperties; eager?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- Watch's own image relay, cached for a year
  return <img key={src} src={src} alt={alt} style={style} loading={eager ? undefined : "lazy"} decoding="async" className={cx("kw-fade", loaded && "kw-ld", className)} onLoad={() => setLoaded(true)} />;
}

/** A card's picture: wide art on a wide screen, the poster on a phone. */
export function CardArt({ card, poster }: { card: Card; poster?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const wide = card.backdrop ?? card.poster;
  const tall = card.poster ?? card.backdrop;
  if (!wide) return null;
  if (poster) return <Img src={tall} />;
  return <picture>
    {tall ? <source media="(max-width: 899px)" srcSet={tall} /> : null}
    <img src={wide} alt="" loading="lazy" decoding="async" className={cx("kw-fade", loaded && "kw-ld")} onLoad={() => setLoaded(true)} />
  </picture>;
}

/** The title's logo where there is one, else its name set in Mincho. */
export function TitleMark({ name, logo, className = "kw-logo" }: { name: string; logo?: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (logo && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- Watch's own image relay
    return <div className={className}><img className="kw-logo-img" src={logo} alt={name} onError={() => setBroken(true)} /></div>;
  }
  return <div className={className}>{name}</div>;
}

export function Top10({ className }: { className?: string }) {
  return <span className={cx("kw-top10", className)}>TOP<b>10</b></span>;
}

export const tagClass = (badge: string) => cx("kw-tag", badge === "New" && "kw-moss");

/* ───── Rating: down, up or love, from a small pop-over ───── */

const rates: [Rating, string][] = [["down", "Not for me"], ["up", "I like this"], ["love", "Love this!"]];
export function RateButton({ id, variant }: { id: string; variant: "act" | "ring" }) {
  const watch = useWatch();
  const rating = watch.marksOf(id).rating;
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setShown(true));
    const away = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) { setOpen(false); setShown(false); } };
    document.addEventListener("pointerdown", away, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", away, true); };
  }, [open]);
  const button = variant === "act"
    ? <button className={cx("kw-act", rating && "kw-on")} onClick={() => { setOpen(!open); setShown(false); }} aria-expanded={open}><Icon name={rating ?? "up"} /><span>Rate</span></button>
    : <button className={cx("kw-ringbtn", rating && "kw-on")} onClick={() => { setOpen(!open); setShown(false); }} aria-label="Rate" aria-expanded={open}><Icon name={rating ?? "up"} /></button>;
  return <span ref={wrap} style={{ position: "relative", display: "inline-grid" }}>
    {button}
    {open ? <div className={cx("kw-rate-pop", shown && "kw-on")} style={{ left: "calc(50% - 76px)", top: -60 }}>
      {rates.map(([key, label]) => <button key={key} aria-label={label} className={cx(rating === key && "kw-sel")} onClick={() => { watch.rate(id, rating === key ? null : key); setOpen(false); }}><Icon name={key} /></button>)}
    </div> : null}
  </span>;
}

export function ListButton({ id, variant }: { id: string; variant: "act" | "ring" }) {
  const watch = useWatch();
  const on = watch.marksOf(id).inList;
  return variant === "act"
    ? <button className={cx("kw-act", on && "kw-on")} aria-pressed={on} onClick={() => watch.setListed(id, !on)}><Icon name={on ? "check" : "add"} /><span>My list</span></button>
    : <button className={cx("kw-ringbtn", on && "kw-on")} aria-pressed={on} aria-label="My list" onClick={(event) => { event.stopPropagation(); watch.setListed(id, !on); }}><Icon name={on ? "check" : "add"} /></button>;
}

/* ───── Loading ───── */

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return <>{Array.from({ length: count }, (_, i) => <section key={i}>
    <div className="kw-sk kw-sk-h" style={{ marginLeft: "var(--gutter-l)" }} />
    <div className="kw-sk-row">{Array.from({ length: 8 }, (_, j) => <div key={j} className="kw-sk kw-sk-card" />)}</div>
  </section>)}</>;
}

export function Toast({ message }: { message: { text: string; at: number } | null }) {
  const [gone, setGone] = useState<number | null>(null);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setGone(message.at), 1800);
    return () => clearTimeout(t);
  }, [message]);
  const on = Boolean(message && gone !== message.at);
  return <div className={cx("kw-toast", on && "kw-on")} role="status" aria-live="polite">{message?.text}</div>;
}

export function Rail({ children, label }: { children: ReactNode; label: string }) {
  const rail = useRef<HTMLDivElement>(null);
  const by = (sign: number) => rail.current?.scrollBy({ left: sign * rail.current.clientWidth * 0.85, behavior: "smooth" });
  return <div className="kw-rail-wrap">
    <button className="kw-arrow kw-l" aria-label="Scroll left" onClick={() => by(-1)}><Icon name="left" /></button>
    <div className="kw-rail" ref={rail} aria-label={label}>{children}</div>
    <button className="kw-arrow kw-r" aria-label="Scroll right" onClick={() => by(1)}><Icon name="right" /></button>
  </div>;
}

/* ───── Brand: Watch's bloom ───── */

export const watchId = "kimono-watch";
/** Watch's app bloom: Kimono's flower with the play glyph, in Watch's colours, as the rail draws it. */
export function WatchBloom({ accent, className }: { accent: string; className?: string }) {
  return <span className={cx("kw-bloom", className)} aria-hidden="true"><AppIcon app={{ id: watchId, icon: "play", accent }} /></span>;
}

/* ───── The tab's title: "Kimono Watch", or what's open in front ───── */

const titles: { key: number; name: string }[] = [];
let titleKey = 0;
const showTitle = () => { const top = titles[titles.length - 1]; document.title = top ? `${top.name} · Kimono Watch` : "Kimono Watch"; };
/** While mounted with a name, the tab reads "{name} · Kimono Watch"; the latest one shown wins, and leaving puts back the one before. */
export function useTabTitle(name: string | null | undefined) {
  useEffect(() => {
    if (!name) return;
    const key = ++titleKey;
    titles.push({ key, name });
    showTitle();
    return () => { const at = titles.findIndex((t) => t.key === key); if (at >= 0) titles.splice(at, 1); showTitle(); };
  }, [name]);
}

/* ───── Waiting: Material 3 Expressive's loading indicator (components/loading-indicator.tsx) ───── */

export function Spinner({ color, label = "Loading", className }: { color?: string; label?: string; className?: string }) {
  return <LoadingIndicator color={color} label={label} className={cx("kw-spinner", className)} />;
}
