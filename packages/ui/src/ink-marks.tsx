"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { blotPath, brushAttributes, inkFilters, inkRandom, mixHex, petalSvg, ringPath, washGradient, INK } from "./ink";
import { cx } from "./cx";

/* Seeds from a string, so the same thing is drawn the same way on the server and in the browser. */
function seedOf(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

/**
 * A watercolour blot behind a line icon: the icon tile of a list row. Each
 * blot is its own puddle, tinted by role (suō, plum, moss) or by a colour.
 */
export function InkBlot({ tint = "#a84d63", seed, strong = false, className, children }: {
  tint?: string;
  /** What the blot belongs to; it seeds the puddle's shape. */
  seed: string;
  /** Full colour, for a colour swatch rather than a tinted tile. */
  strong?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const unique = useId().replaceAll(":", "");
  const random = inkRandom(seedOf(seed));
  const gradient = strong
    ? washGradient(`blot-${unique}`, mixHex(tint, "#ffffff", .15), tint, mixHex(tint, "#000000", .15), "50%")
    : washGradient(`blot-${unique}`, mixHex(tint, "#ffffff", .7), mixHex(tint, "#ffffff", .42), mixHex(tint, "#ffffff", .08), "60%");
  return <span className={cx("k-ink-blot", className)}>
    <svg viewBox="0 0 54 54" aria-hidden="true" dangerouslySetInnerHTML={{ __html: `<defs>${inkFilters(unique, 9)}${gradient}</defs><path d="${blotPath(random, 27, 27, 21)}" fill="url(#blot-${unique})" filter="url(#ink-wash-${unique})" opacity=".92"></path>` }}/>
    {children}
  </span>;
}

/** A portrait's frame: a washed disc and an open brush ring, round a picture or an initial. */
export function InkPortraitFrame({ seed, tint = "#a84d63", weight = 3, children, className }: {
  seed: string;
  tint?: string;
  /** Ring weight in the 100-unit box; small portraits need a heavier line to read. */
  weight?: number;
  children: ReactNode;
  className?: string;
}) {
  const unique = useId().replaceAll(":", "");
  const random = inkRandom(seedOf(seed));
  const ring = ringPath(random, 47, .25 + random() * .35);
  return <span className={cx("k-ink-portrait", className)}>
    <svg viewBox="0 0 100 100" aria-hidden="true" dangerouslySetInnerHTML={{ __html: `<defs>${inkFilters(unique, 11)}${washGradient(`pw-${unique}`, mixHex(tint, "#ffffff", .82), mixHex(tint, "#ffffff", .58), mixHex(tint, "#ffffff", .3), "65%")}</defs>`
      + `<circle cx="50" cy="50" r="46" fill="url(#pw-${unique})" filter="url(#ink-wash-${unique})"></circle>`
      + `<path d="${ring}" fill="none" stroke="${INK}" stroke-width="${weight}" stroke-linecap="round" opacity=".85" filter="url(#ink-brush-${unique})"></path>` }}/>
    {children}
  </span>;
}

/** One hand-drawn petal, for hold-to-confirm and the moments that earn them. */
export function InkPetal({ seed, colour, className }: { seed: number; colour?: string; className?: string }) {
  return <span className={cx("k-ink-petal", className)} dangerouslySetInnerHTML={{ __html: petalSvg(seed, colour) }}/>;
}

/** An ink-and-wash outline round an important card: a soft wash at the rim and a broken brush line. */
export function inkOutlineMarkup(width: number, height: number, radius: number, colour: string, seed: string) {
  const random = inkRandom(seedOf(seed)), unique = `o${seedOf(seed).toString(36)}`;
  const r = Math.min(radius, height / 2) + 3, step = 34, j = () => (random() - .5);
  const points: number[][] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number) => { const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / step)); for (let k = 0; k < n; k++) points.push([x0 + (x1 - x0) * k / n + j(), y0 + (y1 - y0) * k / n + j()]); };
  const arc = (cx: number, cy: number, a0: number) => { for (let k = 0; k < 4; k++) { const t = a0 + k / 4 * Math.PI / 2; points.push([cx + r * Math.cos(t) + j(), cy + r * Math.sin(t) + j()]); } };
  const x0 = 2.5, y0 = 2.5, x1 = width - 2.5, y1 = height - 2.5;
  edge(x0 + r, y0, x1 - r, y0); arc(x1 - r, y0 + r, -Math.PI / 2); edge(x1, y0 + r, x1, y1 - r); arc(x1 - r, y1 - r, 0);
  edge(x1 - r, y1, x0 + r, y1); arc(x0 + r, y1 - r, Math.PI / 2); edge(x0, y1 - r, x0, y0 + r); arc(x0 + r, y0 + r, Math.PI);
  const start = Math.floor(random() * points.length), ordered = points.slice(start).concat(points.slice(0, start)), n = ordered.length;
  const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let d = "M" + mid(ordered[n - 1], ordered[0]).map((v) => v.toFixed(1)).join(" ");
  for (let k = 0; k < n; k++) { const p = ordered[k], m = mid(p, ordered[(k + 1) % n]); d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`; }
  d += "Z";
  return `<defs>${inkFilters(unique, 15)}<filter id="rim-${unique}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="3" seed="15" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="6" result="d"></feDisplacementMap><feGaussianBlur in="d" stdDeviation="3"></feGaussianBlur></filter></defs>`
    + `<path d="${d}" fill="none" stroke="${colour}" stroke-width="10" stroke-opacity=".16" filter="url(#rim-${unique})"></path>`
    + `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${(2 + random() * .6).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${(220 + random() * 120).toFixed(0)} ${(8 + random() * 8).toFixed(0)}" opacity=".75" filter="url(#ink-fine-${unique})"></path>`;
}

/** A card that matters (needs attention, or good news) gets an ink-and-wash outline. Everyday cards don't. */
export function InkCard({ colour = "#a84d63", seed, className, children }: { colour?: string; seed: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number; r: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => setBox({ w: el.offsetWidth + 8, h: el.offsetHeight + 8, r: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 24 });
    measure();
    const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={cx("k-ink-card", className)}>
    {box ? <svg className="k-ink-card-line" viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: inkOutlineMarkup(box.w, box.h, box.r, colour, seed) }}/> : null}
    {children}
  </div>;
}
