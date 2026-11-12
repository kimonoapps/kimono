"use client";

import { useEffect, useRef } from "react";
import { LOADER_MORPHS, LOADER_SCALE } from "./loader-shapes";

/* ───── Material 3 Expressive's loading indicator, as Compose runs it ───── */

/* Its spring (dampingRatio .6, stiffness 200) from rest at 0 toward 1, t in ms. */
const SPRING_W = Math.sqrt(200), SPRING_Z = .6, SPRING_WD = SPRING_W * Math.sqrt(1 - SPRING_Z * SPRING_Z);
const springAt = (t: number) => 1 - Math.exp(-SPRING_Z * SPRING_W * t / 1000) * (Math.cos(SPRING_WD * t / 1000) + SPRING_Z * SPRING_W / SPRING_WD * Math.sin(SPRING_WD * t / 1000));

function loaderPath(index: number, progress: number) {
  const [a, b] = LOADER_MORPHS[index];
  const p = a.map((v, k) => v + (b[k] - v) * progress);
  /* Centred on its own bounds, as Compose's processPath does. */
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < p.length; k += 8) for (let s = 0; s <= 8; s++) {
    const t = s / 8, u = 1 - t;
    const x = u * u * u * p[k] + 3 * u * u * t * p[k + 2] + 3 * u * t * t * p[k + 4] + t * t * t * p[k + 6];
    const y = u * u * u * p[k + 1] + 3 * u * u * t * p[k + 3] + 3 * u * t * t * p[k + 5] + t * t * t * p[k + 7];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const dx = .5 - (x0 + x1) / 2 * LOADER_SCALE, dy = .5 - (y0 + y1) / 2 * LOADER_SCALE;
  const at = (k: number) => `${(p[k] * LOADER_SCALE + dx).toFixed(4)} ${(p[k + 1] * LOADER_SCALE + dy).toFixed(4)}`;
  let d = "M" + at(0);
  for (let k = 0; k < p.length; k += 8) d += `C${at(k + 2)} ${at(k + 4)} ${at(k + 6)}`;
  return d + "Z";
}

/** The shape that morphs and turns while something loads; with reduced motion it only turns, slowly. */
export function LoadingIndicator({ color, label = "Loading", className }: { color?: string; label?: string; className?: string }) {
  const shape = useRef<SVGPathElement>(null);
  useEffect(() => {
    const el = shape.current; if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, start = 0;
    const frame = (now: number) => {
      if (!start) start = now;
      const t = now - start;
      if (still) el.setAttribute("transform", `rotate(${((t % 6000) / 6000 * 360).toFixed(2)} .5 .5)`);
      else {
        const cycle = Math.floor(t / 650), progress = springAt(t - cycle * 650);
        const rotation = progress * 90 + (cycle * 90) % 360 + (t % 4666) / 4666 * 360;
        el.setAttribute("d", loaderPath(cycle % LOADER_MORPHS.length, progress));
        el.setAttribute("transform", `rotate(${rotation.toFixed(2)} .5 .5)`);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <svg className={["k-loading", className].filter(Boolean).join(" ")} viewBox="0 0 1 1" role="progressbar" aria-label={label} style={color ? { color } : undefined}>
    <path ref={shape} d={loaderPath(0, 0)} fill="currentColor" />
  </svg>;
}
