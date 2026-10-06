"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "./cx";

export type CrossingKind = "hanafubuki" | "shoji" | "kakejiku";

const CROSSING = {
  hanafubuki: { total: 1900, covered: 620 },
  shoji: { total: 900, covered: 340 },
  kakejiku: { total: 820, covered: 380 },
} as const satisfies Record<CrossingKind, { total: number; covered: number }>;

const PETAL = "M49 96 C30 89 13 70 14 48 C15 29 25 12 35 7 C41 4 45 15 51 28 C58 14 64 5 70 9 C80 16 88 34 87 53 C86 74 67 90 49 96 Z";
const FOLD = "M49 96 C34 88 22 73 19 57 C28 70 38 82 49 96 Z";

/**
 * The swap runs at the moment the screen is fully covered. If it hands back a
 * promise, the crossing stays covered until that promise settles: the screen
 * waits for the page rather than the page arriving behind an open screen.
 */
export type CrossingSwap = () => void | Promise<unknown>;

export type CrossingColors = { from: string; fromPale: string; to: string; toPale: string };

const CrossingContext = createContext<(kind: CrossingKind, swap: CrossingSwap, colors?: CrossingColors) => void>(() => {});

/** Call a crossing. The swap runs at the moment the screen is fully covered. */
export function useCrossing() {
  return useContext(CrossingContext);
}

/**
 * A page that will not arrive must not hold the screen shut forever. After
 * this the crossing opens anyway and lets the browser show whatever it has.
 */
const HELD_AT_MOST = 8000;

/** Someone who asked for less motion gets the swap, not the ceremony. */
function stillness() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Petal = { key: number; cls: string; style: Record<string, string> };

function makePetals(): Petal[] {
  // Keep the blossom on touch screens without creating 64 animated layers.
  const count = window.matchMedia("(max-width: 940px), (pointer: coarse)").matches ? 24 : 64;
  return Array.from({ length: count }, (_, i) => {
    const spin = (Math.random() < .5 ? -1 : 1) * (420 + Math.random() * 520);
    const tone = Math.random();
    return {
      key: i,
      cls: tone < .3 ? "k-deep" : tone < .56 ? "k-faint" : "",
      style: {
        top: `${(Math.random() * 96).toFixed(1)}%`,
        left: `${(Math.random() * 96).toFixed(1)}%`,
        "--sz": `${(18 + Math.random() * 26).toFixed(0)}px`,
        "--y0": `${(Math.random() * 40 - 20).toFixed(0)}vh`,
        "--dx": `${(Math.random() * 64 - 22).toFixed(0)}px`,
        "--dy": `${(Math.random() * 52 - 26).toFixed(0)}px`,
        "--y3": `${(Math.random() * 50 - 25).toFixed(0)}vh`,
        "--r1": `${(spin * .3).toFixed(0)}deg`,
        "--r2": `${(spin * .42).toFixed(0)}deg`,
        "--r3": `${(spin * .53).toFixed(0)}deg`,
        "--r4": `${spin.toFixed(0)}deg`,
        "--f1": (.55 + Math.random() * .45).toFixed(2),
        "--f2": ((Math.random() < .55 ? -1 : 1) * (.45 + Math.random() * .5)).toFixed(2),
        "--f3": (.6 + Math.random() * .4).toFixed(2),
        animationDelay: `${(Math.random() * 150).toFixed(0)}ms`,
      },
    };
  });
}

/** Wrap the app once. Renders the crossing layer above all chrome. */
export function CrossingProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<CrossingKind | null>(null);
  const [colors, setColors] = useState<CrossingColors | undefined>();
  const [held, setHeld] = useState(false);
  const [petals, setPetals] = useState<Petal[]>([]);
  const layerRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const mounted = useRef(false);
  const generation = useRef(0);

  const later = useCallback((run: () => void, delay: number) => {
    if (!mounted.current) return;
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      if (mounted.current) run();
    }, delay);
    timers.current.add(timer);
    return timer;
  }, []);

  const cancel = useCallback(() => {
    generation.current++;
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    busy.current = false;
    setKind(null);
    setHeld(false);
    setPetals([]);
    setColors(undefined);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const pendingTimers = timers.current;
    // History navigation supersedes both a pending swap and a held arrival.
    // Clear before leaving too: the back/forward cache can freeze this layer
    // and its timers, then restore it exactly as it was.
    const restore = (event: PageTransitionEvent) => { if (event.persisted) cancel(); };
    window.addEventListener("popstate", cancel);
    window.addEventListener("pagehide", cancel);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("popstate", cancel);
      window.removeEventListener("pagehide", cancel);
      window.removeEventListener("pageshow", restore);
      mounted.current = false;
      generation.current++;
      pendingTimers.forEach(clearTimeout);
      pendingTimers.clear();
      busy.current = false;
    };
  }, [cancel]);

  useLayoutEffect(() => {
    if (kind !== "hanafubuki") return;
    // The opaque haze waits for arrival, while petals keep their current
    // position and drift at eight percent speed. No animation is restarted.
    layerRef.current?.querySelectorAll(".k-petal").forEach(petal => {
      petal.getAnimations().forEach(animation => {
        animation.updatePlaybackRate(held ? .08 : 1);
      });
    });
  }, [kind, held]);

  const cross = useCallback((next: CrossingKind, swap: CrossingSwap, palette?: CrossingColors) => {
    if (busy.current || !mounted.current) return;
    busy.current = true;
    const crossing = ++generation.current;

    const done = () => {
      if (!mounted.current || generation.current !== crossing) return;
      cancel();
    };
    if (stillness()) { void swap(); done(); return; }

    if (next === "hanafubuki") setPetals(makePetals());
    setColors(palette);
    setKind(next);
    const { total, covered } = CROSSING[next];

    later(() => {
      // Fully covered. The page changes hands here, unseen, and the screen
      // stays shut until the new one is standing.
      let opened = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const open = () => {
        if (opened || !mounted.current || generation.current !== crossing) return;
        opened = true;
        if (watchdog !== undefined) {
          clearTimeout(watchdog);
          timers.current.delete(watchdog);
        }
        setHeld(false);
        later(done, total - covered);
      };
      let arrived: void | Promise<unknown>;
      try {
        arrived = swap();
      } catch {
        open();
        return;
      }
      if (!arrived) { open(); return; }
      setHeld(true);
      watchdog = later(open, HELD_AT_MOST);
      void Promise.resolve(arrived).then(open, open);
    }, covered);
  }, [later, cancel]);

  const layer = useMemo(() => {
    if (!kind) return null;
    return <div ref={layerRef} className="k-crossing" style={colors ? {
      "--k-cross-from": colors.from, "--k-cross-from-pale": colors.fromPale,
      "--k-cross-to": colors.to, "--k-cross-to-pale": colors.toPale,
    } as CSSProperties : undefined} data-kind={kind} data-held={held ? "" : undefined} aria-hidden="true">
      {kind === "hanafubuki" ? <>
        <span className="k-haze" />
        {petals.map((p) => <svg key={p.key} className={cx("k-petal", p.cls)} viewBox="0 0 100 100" style={p.style as never}>
          <path d={PETAL} fill="currentColor" strokeWidth="3.2" strokeLinejoin="round" />
          <path d={FOLD} style={{ fill: "var(--k-fold)" }} opacity=".55" />
        </svg>)}
      </> : null}
      {kind === "shoji" ? <><span className="k-screen k-l" /><span className="k-screen k-r" /></> : null}
      {kind === "kakejiku" ? <><span className="k-blind" /><span className="k-rod" /></> : null}
    </div>;
  }, [kind, held, petals, colors]);

  return <CrossingContext.Provider value={cross}>{children}{layer}</CrossingContext.Provider>;
}
