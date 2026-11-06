"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { inkFilters, washGradient } from "./ink";

/*
 * How Kimono waits (docs/design-system.md, "Waiting"):
 *
 * - MorphLoader: Material 3 Expressive's loading indicator, painted. One shape
 *   morphs through Material's shapes (soft burst, cookie, pentagon, pill,
 *   sunny, clover, oval) while it turns. On paper it is washed in suō with a
 *   broken plum brush edge; on a Seal it is the Seal's own label colour.
 * - BusyFace: a button that's waiting keeps its size and its word; the shape
 *   takes the face instead of the word changing to "Saving…".
 * - InkWave: Material's wavy progress bar, brushed, as on the phone
 *   (InkProgress.kt). Only for a real progress (an upload, a download): it
 *   fills as the value grows. Waiting with no measure of how far along
 *   ("Working", "Opening") is the MorphLoader, never the wave.
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
const ease = (x: number) => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
function shapePath(i: number, j: number, mix: number) {
  let d = "";
  for (let k = 0; k <= 120; k++) {
    const t = k / 120 * Math.PI * 2, r = (SHAPES[i](t) * (1 - mix) + SHAPES[j](t) * mix) * 17.5;
    d += (k ? "L" : "M") + (19 + r * Math.cos(t)).toFixed(2) + " " + (19 + r * Math.sin(t)).toFixed(2);
  }
  return d + "Z";
}

/** The morphing shape. `tone="wash"` is suō on paper; `tone="plain"` takes the text colour (for a Seal's face). */
export function MorphLoader({ tone = "wash", label = "Loading", className }: { tone?: "wash" | "plain"; label?: string; className?: string }) {
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
          <defs dangerouslySetInnerHTML={{ __html: inkFilters(unique, 21) + washGradient(`lw-${unique}`, "#eab0be", "#cf7088", "#8f3c52", "60%") }}/>
          <path className="shape" d={first} fill={`url(#lw-${unique})`} filter={`url(#ink-wash-${unique})`} opacity=".95"/>
          <path className="shape" d={first} fill="none" stroke="#4e2b37" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="70 4" opacity=".8" filter={`url(#ink-fine-${unique})`}/>
        </>
      : <path className="shape" d={first} fill="currentColor"/>}
  </svg>;
}

/**
 * What goes inside a button that may be waiting: its word, and while `busy`,
 * the morphing shape in the word's place. The button keeps its width.
 */
export function BusyFace({ busy, label = "Working", children }: { busy: boolean; label?: string; children: ReactNode }) {
  return <span className={cx("k-busy-face", busy && "is-busy")}>
    <span className="k-busy-word">{children}</span>
    {busy ? <MorphLoader tone="plain" label={label} className="k-busy-shape"/> : null}
  </span>;
}

/** The wavy bar. `value` 0–1 fills it; leave it out while how long is unknown. */
export function InkWave({ value, label = "Loading", className }: { value?: number; label?: string; className?: string }) {
  const unique = useId().replaceAll(":", "");
  const box = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const measure = () => setWidth(Math.round(el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const known = typeof value === "number";
  const shown = known ? Math.min(1, Math.max(0, value)) : 0;
  const h = 12, wl = 22, amp = 2.6, mid = h / 2;
  let d = "";
  if (width) {
    d = `M0 ${mid}`;
    for (let x = 1.5; x <= width + wl; x += 1.5) d += ` L${x.toFixed(1)} ${(mid + amp * Math.sin(x / wl * 2 * Math.PI)).toFixed(2)}`;
  }
  return <span ref={box} className={cx("k-wave", !known && "is-unknown", className)} role="progressbar" aria-label={label}
    aria-valuemin={known ? 0 : undefined} aria-valuemax={known ? 100 : undefined} aria-valuenow={known ? Math.round(shown * 100) : undefined}>
    {width ? <svg viewBox={`0 0 ${width} ${h}`} width={width} height={h} aria-hidden="true" style={{ ["--k-wave-length" as string]: `${wl}px` }}>
      <defs dangerouslySetInnerHTML={{ __html: inkFilters(unique, 9) + `<clipPath id="wc-${unique}"><rect width="${width}" height="${h}"></rect></clipPath><clipPath id="wf-${unique}"><rect width="${(width * shown).toFixed(1)}" height="${h}"></rect></clipPath>` }}/>
      <g clipPath={`url(#wc-${unique})`}>
        <g className="k-wave-flow">
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="90 6" opacity=".22" filter={`url(#ink-fine-${unique})`}/>
          {known
            ? <path d={d} clipPath={`url(#wf-${unique})`} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".9" filter={`url(#ink-fine-${unique})`}/>
            : <path className="k-wave-run" d={d} pathLength={100} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="34 100" opacity=".9" filter={`url(#ink-fine-${unique})`}/>}
        </g>
      </g>
    </svg> : null}
  </span>;
}
