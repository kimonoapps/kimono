"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";

/*
 * 部 The parts every app was drawing for itself: a section's heading, the way
 * back, a row that scrolls sideways, a word along the bottom, a search field
 * and an empty page. One of each, so a heading in Watch and a heading in Books
 * are the same heading. Styles are in styles/parts.css.
 */

const Chevron = ({ to }: { to: "left" | "right" }) => <svg viewBox="0 0 24 24" aria-hidden="true" className="k-chev">
  <path d={to === "left" ? "M14.5 5.5 8 12l6.5 6.5" : "M9.5 5.5 16 12l-6.5 6.5"} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
</svg>;

/** The way back: a 44px round mark with a chevron. Give it `onClick`, or put its look on a link with `className="k-back"` and `<BackGlyph />`. */
export function BackButton({ label = "Back", onClick, className }: { label?: string; onClick: () => void; className?: string }) {
  return <button type="button" className={cx("k-back", className)} aria-label={label} title={label} onClick={onClick}><Chevron to="left" /></button>;
}
export const BackGlyph = () => <Chevron to="left" />;

/**
 * 節 A section's heading: its name in Mincho, an optional count beside it, and
 * one way to see the whole of it on the right. Every row and list in every app
 * opens with one.
 */
export function SectionHeader({ title, count, more, children, className, id }: {
  title: ReactNode;
  /** A number or a short fact after the name, quieter. */
  count?: ReactNode;
  /** "See all": a link (`href`) or a press (`onClick`). Says "See all" unless given another label. */
  more?: { label?: string; onClick?: () => void; href?: string };
  /** Anything else belonging to the section (a quiet seal), before "See all". */
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  return <header className={cx("k-section-header", className)}>
    <h2 id={id}>{title}{count !== undefined && count !== null ? <span className="k-section-count">{count}</span> : null}</h2>
    {children || more ? <div className="k-section-actions">
      {children}
      {more ? (more.href
        ? <a className="k-see-all" href={more.href} onClick={more.onClick ? (event) => { event.preventDefault(); more.onClick!(); } : undefined}>{more.label ?? "See all"}</a>
        : <button type="button" className="k-see-all" onClick={more.onClick}>{more.label ?? "See all"}</button>) : null}
    </div> : null}
  </header>;
}

/**
 * 巻 A row that scrolls sideways: it snaps to each item, and on a screen with
 * a pointer, round arrows show at whichever end has more beyond it. Touch
 * swipes. Set `--k-carousel-pad` for a gutter and `--k-carousel-arrow-top` to
 * centre the arrows on the pictures rather than the whole item.
 */
export function Carousel({ label, children, className, gap }: { label: string; children: ReactNode; className?: string; gap?: number }) {
  const rail = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ l: false, r: false });
  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    const l = el.scrollLeft > 4, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEnds((now) => (now.l === l && now.r === r ? now : { l, r }));
  }, []);
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(el);
    const items = new MutationObserver(measure);
    items.observe(el, { childList: true });
    return () => { sizes.disconnect(); items.disconnect(); };
  }, [measure]);
  const by = (sign: number) => rail.current?.scrollBy({ left: sign * rail.current.clientWidth * 0.8, behavior: "smooth" });
  return <div className={cx("k-carousel", className)}>
    {ends.l ? <button type="button" className="k-carousel-arrow k-l" aria-label="Scroll left" onClick={() => by(-1)}><Chevron to="left" /></button> : null}
    <div className="k-carousel-rail" ref={rail} onScroll={measure} role="group" aria-label={label} style={gap !== undefined ? { gap } : undefined}>{children}</div>
    {ends.r ? <button type="button" className="k-carousel-arrow k-r" aria-label="Scroll right" onClick={() => by(1)}><Chevron to="right" /></button> : null}
  </div>;
}

/* ─── 便り A word along the bottom ─── */

export type ToastMessage = { text: string; at: number; action?: { label: string; onClick: () => void } };

/** A toast and the way to raise one: `say("Saved")`, or `say("Removed", { label: "Undo", onClick })`. */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const say = useCallback((text: string, action?: ToastMessage["action"]) => setToast({ text, at: Date.now(), action }), []);
  return [toast, say] as const;
}

/** Shows a toast for 3.2s (6s when it offers something to press); held while the pointer is on it. */
export function Toast({ toast, className }: { toast: ToastMessage | null; className?: string }) {
  const [gone, setGone] = useState<number | null>(null);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!toast || held) return;
    const timer = setTimeout(() => setGone(toast.at), toast.action ? 6000 : 3200);
    return () => clearTimeout(timer);
  }, [toast, held]);
  const on = Boolean(toast && gone !== toast.at);
  return <div className={cx("k-toast", on && "k-on", className)} role="status" aria-live="polite" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
    {toast ? <>
      <span>{toast.text}</span>
      {toast.action ? <button type="button" onClick={() => { toast.action!.onClick(); setGone(toast.at); }}>{toast.action.label}</button> : null}
    </> : null}
  </div>;
}

/** 探 A search field: a glass, the words, and × to clear them once there are some. */
export function SearchField({ value, onChange, placeholder = "Search", label, autoFocus, className, onKeyDown }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  autoFocus?: boolean;
  className?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <label className={cx("k-search", className)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m15 15 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
    <input ref={input} type="search" value={value} placeholder={placeholder} aria-label={label ?? placeholder} autoComplete="off" spellCheck={false} autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} />
    {value ? <button type="button" className="k-search-clear" aria-label="Clear" onClick={() => { onChange(""); input.current?.focus(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
    </button> : null}
  </label>;
}

/** 空 What a page or list shows before anything is in it: a line in Mincho, a sentence, and at most one thing to do. */
export function EmptyState({ title, children, action, className }: { title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return <div className={cx("k-empty", className)}>
    <p className="k-empty-title">{title}</p>
    {children ? <p className="k-empty-body">{children}</p> : null}
    {action ? <div className="k-empty-action">{action}</div> : null}
  </div>;
}
