"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { inkFilters, mixHex, washGradient } from "./ink";

/*
 * How Kimono waits (docs/design-system.md, "Waiting"):
 *
 * - InkLoader: waiting with no measure of how far along ("Working",
 *   "Opening"). Material 3 Expressive's loading indicator, painted: one shape
 *   morphs through Material's shapes while it turns. On paper it is washed in
 *   suō (or `ink`) with a broken brush edge; `tone="plain"` takes the text
 *   colour (for a Seal's face).
 * - BusyFace: a button that's waiting keeps its size and its word; the shape
 *   takes the word's place instead of the word changing to "Saving…".
 * - InkWave: the update's wavy bar, brushed, as on the phone (InkProgress.kt).
 *   Only for a real progress (an upload, a render with a percent): the wave
 *   fills as the value grows. Never for a wait without a measure.
 */

const SHAPES: ((t: number) => number)[] = [
  (t) => .86 + .14 * Math.pow(Math.abs(Math.cos(5 * t)), .6),
  (t) => .9 + .1 * Math.cos(9 * t),
  (t) => { const k = Math.PI / 5, a = ((t % (2 * k)) + 2 * k) % (2 * k) - k; return .7 * (Math.cos(k) / Math.cos(a)) + .27; },
  (t) => .62 / Math.hypot(.62 * Math.cos(t), Math.sin(t)),
  (t) => .9 + .1 * Math.sign(Math.cos(8 * t)) * Math.pow(Math.abs(Math.cos(8 * t)), .45),
  (t) => .76 + .24 * Math.pow(Math.abs(Math.cos(2 * t)), 1.6),
  (t) => .8 / Math.hypot(.8 * Math.cos(t), Math.sin(t)),
];
function shapePath(i: number, j: number, mix: number) {
  let d = "";
  for (let k = 0; k <= 120; k++) {
    const t = k / 120 * Math.PI * 2, r = (SHAPES[i](t) * (1 - mix) + SHAPES[j](t) * mix) * 17.5;
    d += (k ? "L" : "M") + (19 + r * Math.cos(t)).toFixed(2) + " " + (19 + r * Math.sin(t)).toFixed(2);
  }
  return d + "Z";
}

/** The morphing shape. `tone="wash"` is suō on paper; `tone="plain"` takes the text colour (for a Seal's face). */
export function MorphLoader({ tone = "wash", ink, label = "Loading", className }: {
  tone?: "wash" | "plain";
  /** The colour the wash is made from (#rrggbb), to sit with the words beside it. Suō when left out. */
  ink?: string;
  label?: string;
  className?: string;
}) {
  const unique = useId().replaceAll(":", "");
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const root = svg.current; if (!root) return;
    const paths = root.querySelectorAll<SVGPathElement>("path.shape");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { paths.forEach((p) => p.setAttribute("d", shapePath(0, 0, 0))); return; }
    const HOLD = 120, MORPH = 520, start = performance.now();
    let angle = 0, last = start, raf = 0;
    const frame = (now: number) => {
      /* A frame's timestamp can come from just before the effect ran; never go below zero. */
      const elapsed = Math.max(0, now - start), phase = elapsed % (HOLD + MORPH), mix = phase < HOLD ? 0 : ease((phase - HOLD) / MORPH);
      const current = Math.floor(elapsed / (HOLD + MORPH)) % SHAPES.length;
      angle += Math.max(0, now - last) * (.18 + .5 * (phase < HOLD ? 0 : Math.sin(mix * Math.PI))); last = now;
      const d = shapePath(current, (current + 1) % SHAPES.length, mix);
      paths.forEach((p) => p.setAttribute("d", d));
      root.style.transform = `rotate(${angle.toFixed(1)}deg)`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  const first = shapePath(0, 0, 0);
  return <svg ref={svg} className={cx("k-morph", className)} viewBox="0 0 38 38" role="progressbar" aria-label={label}>
    {tone === "wash"
      ? <>
          <defs dangerouslySetInnerHTML={{ __html: inkFilters(unique, 21) + (ink
            ? washGradient(`lw-${unique}`, mixHex(ink, "#ffffff", .62), mixHex(ink, "#ffffff", .22), mixHex(ink, "#000000", .22), "60%")
            : washGradient(`lw-${unique}`, "#eab0be", "#cf7088", "#8f3c52", "60%")) }}/>
          <path className="shape" d={first} fill={`url(#lw-${unique})`} filter={`url(#ink-wash-${unique})`} opacity=".95"/>
          <path className="shape" d={first} fill="none" stroke={ink ? mixHex(ink, "#000000", .45) : "#4e2b37"} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="70 4" opacity=".8" filter={`url(#ink-fine-${unique})`}/>
        </>
      : <path className="shape" d={first} fill="currentColor"/>}
  </svg>;
}

const CYCLE = 1750;
const RUNS: [number, number][] = [[0, 1000], [250, 1250], [650, 1500], [900, 1750]];
const ease = (x: number) => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const along = (t: number, [a, b]: [number, number]) => ease(Math.min(1, Math.max(0, (t - a) / (b - a))));

function waveD(from: number, to: number, mid: number, amp: number, length: number, phase: number) {
  const y = (x: number) => (mid + amp * Math.sin((x + phase) / length * 2 * Math.PI)).toFixed(2);
  let d = `M${from.toFixed(1)} ${y(from)}`;
  for (let x = from; x < to;) { x = Math.min(to, x + 1.5); d += `L${x.toFixed(1)} ${y(x)}`; }
  return d;
}
const flatD = (from: number, to: number, mid: number) => to - from > 1 ? `M${from.toFixed(1)} ${mid}L${to.toFixed(1)} ${mid}` : "";

/** One frame of the bar in a w×h box: the waves, the track, the dot. */
function frame(w: number, h: number, t: number, value: number | undefined) {
  const bar = Math.min(h, Math.max(8, w / 3));
  const weight = Math.max(1.5, bar * .3), pad = weight / 2 + 1, mid = h / 2;
  const amp = Math.max(0, (bar - weight) / 2 * .85);
  /* Material: long crests on a known bar, tighter while unknown; tighter still when it's short. */
  const length = Math.min(value === undefined ? bar * 2.4 : bar * 4, Math.max(w / 2.5, bar * 1.6));
  const gap = weight * 1.3, start = pad, end = w - pad, span = end - start;
  const phase = -(t / 1000 * length) % length;
  const waves: string[] = [], track: string[] = [];
  let dot: number | null = null;
  if (value !== undefined) {
    const reach = start + span * value;
    const swing = amp * Math.min(1, value / .1) * Math.max(0, Math.min(1, (1 - value) / .05));
    if (value > 0) waves.push(waveD(start, reach, mid, swing, length, phase));
    track.push(flatD(value > 0 ? reach + gap : start, end - weight * 1.2, mid));
    dot = end - weight * .3;
  } else {
    const c = t % CYCLE;
    let at = start;
    for (const [tail, head] of [[along(c, RUNS[1]), along(c, RUNS[0])], [along(c, RUNS[3]), along(c, RUNS[2])]]) {
      const a = start + span * tail, b = start + span * head;
      if (b - a <= weight * .6) continue;
      track.push(flatD(at, a - gap, mid));
      waves.push(waveD(a, b, mid, amp, length, phase));
      at = b + gap;
    }
    track.push(flatD(at, end, mid));
  }
  return { weight, mid, wave: waves.join(""), track: track.join(""), dot };
}

/** The bar, drawn every frame into whatever box CSS gives it. */
function Wave({ value, colour, label, className }: { value?: number; colour?: string; label: string; className: string }) {
  const unique = useId().replaceAll(":", "");
  const box = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const [now, setNow] = useState(0);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const measure = () => setSize([Math.round(el.clientWidth), Math.round(el.clientHeight)]);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    /* Held still for reduced motion: a known bar still fills, an unknown one shows one wave. */
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setNow(500); return; }
    const begun = performance.now();
    let raf = 0;
    const tick = (at: number) => { setNow(Math.max(0, at - begun)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const known = typeof value === "number" ? Math.min(1, Math.max(0, value)) : undefined;
  const [w, h] = size;
  const f = w && h ? frame(w, h, now, known) : null;
  return <span ref={box} className={className} style={colour ? { color: colour } : undefined} role="progressbar" aria-label={label || undefined}
    aria-valuemin={known !== undefined ? 0 : undefined} aria-valuemax={known !== undefined ? 100 : undefined} aria-valuenow={known !== undefined ? Math.round(known * 100) : undefined}>
    {f ? <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      {/* Sized to the bar, not to each line: a flat line has no height to filter. */}
      <defs dangerouslySetInnerHTML={{ __html: `<filter id="ink-fine-${unique}" filterUnits="userSpaceOnUse" x="-6" y="-6" width="${w + 12}" height="${h + 12}"><feTurbulence type="fractalNoise" baseFrequency=".08" numOctaves="2" seed="16" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4"></feDisplacementMap></filter>`
        + `<filter id="ink-wash-${unique}" filterUnits="userSpaceOnUse" x="-6" y="-6" width="${w + 12}" height="${h + 12}"><feTurbulence type="fractalNoise" baseFrequency=".02 .06" numOctaves="3" seed="14" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="5" result="d"></feDisplacementMap><feGaussianBlur in="d" stdDeviation=".6"></feGaussianBlur></filter>` }}/>
      {f.track ? <path d={f.track} fill="none" stroke="currentColor" strokeWidth={(f.weight * .8).toFixed(2)} strokeLinecap="round" strokeDasharray="90 5" opacity=".24" filter={`url(#ink-fine-${unique})`}/> : null}
      {f.wave ? <>
        <path d={f.wave} fill="none" stroke="currentColor" strokeWidth={(f.weight * 1.9).toFixed(2)} strokeLinecap="round" strokeLinejoin="round" opacity=".18" filter={`url(#ink-wash-${unique})`}/>
        <path d={f.wave} fill="none" stroke="currentColor" strokeWidth={f.weight.toFixed(2)} strokeLinecap="round" strokeLinejoin="round" opacity=".9" filter={`url(#ink-fine-${unique})`}/>
      </> : null}
      {f.dot !== null ? <circle cx={f.dot.toFixed(1)} cy={f.mid} r={(f.weight * .45).toFixed(2)} fill="currentColor" opacity=".7"/> : null}
    </svg> : null}
  </span>;
}

/** The loader, for a wait with no measure. `tone="wash"` is suō on paper (or `ink`, #rrggbb); `tone="plain"` takes the text colour. */
export const InkLoader = MorphLoader;

/**
 * What goes inside a button that may be waiting: its word, and while `busy`,
 * the morphing shape in the word's place. The button keeps its width.
 */
export function BusyFace({ busy, label = "Working", children }: { busy: boolean; label?: string; children: ReactNode }) {
  return <span className={cx("k-busy-face", busy && "is-busy")}>
    <span className="k-busy-word">{children}</span>
    {busy ? <InkLoader tone="plain" label={label} className="k-busy-shape"/> : null}
  </span>;
}

/** The wavy bar for a real progress. `value` 0–1 fills it; leave it out while how long is unknown. */
export function InkWave({ value, label = "Loading", className }: { value?: number; label?: string; className?: string }) {
  return <Wave value={value} label={label} className={cx("k-wave", className)}/>;
}
