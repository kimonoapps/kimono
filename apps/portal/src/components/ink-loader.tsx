"use client";

import { useEffect, useId, useRef } from "react";
import { inkFilters, washGradient } from "@kimono/ui";

/*
 * Material 3 Expressive's loading indicator, painted: one shape morphs through
 * Material's shapes (soft burst, cookie, pentagon, pill, sunny, clover, oval)
 * while it turns, washed in suō with a broken plum brush edge. Each shape is a
 * radius r(θ); the morph blends two of them.
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

export function InkLoader() {
  const unique = useId().replaceAll(":", "");
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const root = svg.current; if (!root) return;
    const paths = root.querySelectorAll<SVGPathElement>("path.shape");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { paths.forEach((p) => p.setAttribute("d", shapePath(0, 0, 0))); return; }
    const HOLD = 120, MORPH = 520, start = performance.now();
    let angle = 0, last = start, raf = 0;
    const frame = (now: number) => {
      const elapsed = now - start, phase = elapsed % (HOLD + MORPH), mix = phase < HOLD ? 0 : ease((phase - HOLD) / MORPH);
      const current = Math.floor(elapsed / (HOLD + MORPH)) % SHAPES.length;
      angle += (now - last) * (.18 + .5 * (phase < HOLD ? 0 : Math.sin(mix * Math.PI))); last = now;
      const d = shapePath(current, (current + 1) % SHAPES.length, mix);
      paths.forEach((p) => p.setAttribute("d", d));
      root.style.transform = `rotate(${angle.toFixed(1)}deg)`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <svg ref={svg} className="ink-loader" viewBox="0 0 38 38" role="progressbar" aria-label="Loading">
    <defs dangerouslySetInnerHTML={{ __html: inkFilters(unique, 21) + washGradient(`lw-${unique}`, "#eab0be", "#cf7088", "#8f3c52", "60%") }}/>
    <path className="shape" fill={`url(#lw-${unique})`} filter={`url(#ink-wash-${unique})`} opacity=".95"/>
    <path className="shape" fill="none" stroke="#4e2b37" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="70 4" opacity=".8" filter={`url(#ink-fine-${unique})`}/>
  </svg>;
}
