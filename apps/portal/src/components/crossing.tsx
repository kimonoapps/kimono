"use client";

import { CrossingProvider as CrossingLayer, useCrossing, accentRamp, cx, type SealTone, type CrossingKind } from "@kimono/ui";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { InkLoader } from "@/components/ink-loader";
import { closeIris, foldRail, immersiveAt, immersiveLayer, openIris, stillCopy } from "@/components/immersive";
import { afterPaint, riseWhenReady, whenPageStands } from "@/components/motion";

/**
 * Going somewhere, as a promise that keeps until the page is standing.
 *
 * This lives in the root layout on purpose. The component you pressed is part
 * of the page being replaced, so it is gone by the time the new one commits,
 * and an arrival it was waiting for would never reach it.
 */
const Arrival = createContext<(href: string) => Promise<void>>(() => Promise.resolve());

function Arrivals({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const waiting = useRef<(() => void) | null>(null);

  /* Moving between pages, Material's shared x-axis: the page you leave slides a
     little left and fades at once; if the next is slow, the painted shape-morph
     loader holds the space; when it stands, it slides in from the right. Only
     the page moves: the rail stays where it is. */
  const [moving, setMoving] = useState(false);
  const still = () => typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* A page settling in. The frame persists between pages (app/(shell)/layout),
     so the page element is the same one that just dissolved: the arrival
     waits for the real page to stand (past the route's loading skeleton),
     clears the dissolve, slides it in when you pressed something, and rises
     its pieces once any in-page skeleton gives way. */
  const landing = useRef<() => void>(() => {});
  /* Set when the move crosses into or out of a full-screen place (Watch),
     which arrives its own way (components/immersive). */
  const crossing = useRef<"in" | "out" | null>(null);
  /* Going in, a still copy of the page you left stands under the opening circle. */
  const under = useRef<HTMLElement | null>(null);
  const settle = useCallback((slideIn: boolean) => {
    landing.current();
    let settling = () => {};
    const across = crossing.current;
    const copy = under.current;
    crossing.current = null;
    under.current = null;
    const stop = whenPageStands((page) => {
      page.getAnimations().forEach((animation) => animation.cancel());
      page.style.opacity = "";
      const layer = immersiveLayer(page);
      foldRail(!!layer);
      if (copy) { if (layer) void openIris(layer).then(() => copy.remove()); else copy.remove(); }
      if (still() || layer || across === "out") return;
      if (slideIn) afterPaint([page.animate([{ opacity: 0, transform: "translateX(40px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "cubic-bezier(.05, .7, .1, 1)", fill: "backwards" })]);
      settling = riseWhenReady(page);
    });
    landing.current = () => { stop(); settling(); };
  }, []);
  useEffect(() => () => landing.current(), []);

  // A press marks the move as ours; whichever witness sees it land settles it.
  const pushed = useRef(false);
  const arrived = useCallback(() => {
    const resolve = waiting.current;
    waiting.current = null;
    if (!resolve) return;
    setMoving(false);
    resolve();
    // Same path (a room like ?view=recent, or the page you're on): no path
    // change will settle it, so settle it here.
    if (pushed.current) { pushed.current = false; settle(true); }
  }, [settle]);

  // A new path settles in, back and forward included. The first page of a
  // visit is already painted from the server, so it stays put.
  const shown = useRef(pathname);
  useLayoutEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    const slideIn = pushed.current;
    pushed.current = false;
    settle(slideIn);
  }, [pathname, settle]);

  // React ending the transition is the page standing. The pathname is the
  // second witness, for a navigation that never had to suspend.
  useEffect(() => { if (!pending) arrived(); }, [pending, arrived]);
  useEffect(() => { arrived(); }, [pathname, arrived]);

  useEffect(() => {
    // Release the superseded navigation promise as well as its visual cover.
    const traversed = () => { pushed.current = false; arrived(); };
    window.addEventListener("popstate", traversed);
    window.addEventListener("pagehide", arrived);
    return () => {
      window.removeEventListener("popstate", traversed);
      window.removeEventListener("pagehide", arrived);
      arrived();
    };
  }, [arrived]);

  /* The page you leave dissolves like ink lifting off paper: it fades, softens
     and drifts back. A fetched page would otherwise replace it within a frame
     and cut the dissolve short, so the hand-over waits for the dissolve to
     finish. The next page is already being fetched meanwhile (useCrossTo
     prefetches on press), so the wait costs nothing on a slow page. */
  const navigate = useCallback((href: string) => new Promise<void>((resolve) => {
    const leaving = document.querySelector<HTMLElement>(".main-content");
    setMoving(true);
    pushed.current = true;
    waiting.current = resolve;
    const handOver = () => {
      startTransition(() => { router.push(href); });
      /* A move served from cache can finish inside one render, so React never
         reports it pending and a move that keeps the path changes no path
         either. The third witness is the address itself: Next writes it once
         the new page is committed. */
      const target = new URL(href, location.href);
      const started = performance.now();
      const watch = () => {
        if (waiting.current !== resolve) return;
        if (location.pathname === target.pathname && location.search === target.search) { arrived(); return; }
        if (performance.now() - started < 15000) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    };
    /* Into or out of a full-screen place: the rail folds or unfolds at the
       press, and the cinema closes as an iris rather than the page drifting. */
    const target = new URL(href, location.href).pathname;
    const from = immersiveAt(location.pathname), to = immersiveAt(target);
    crossing.current = from === to ? null : to ? "in" : "out";
    if (crossing.current) foldRail(to);
    if (from && to) { handOver(); return; }
    /* Going in, the page you leave holds still as a copy while Watch is
       fetched and opens over it. */
    if (to) {
      if (leaving && !still()) { under.current = stillCopy(leaving); leaving.style.opacity = "0"; }
      handOver();
      return;
    }
    /* Coming out, a copy of Watch closes over Kimono arriving beneath it. */
    const layer = from ? immersiveLayer(leaving) : null;
    if (layer && !still()) {
      const copy = stillCopy(layer);
      layer.style.visibility = "hidden";
      void closeIris(copy).then(() => copy.remove());
    }
    if (from) { handOver(); return; }
    if (!leaving || still()) { handOver(); return; }
    const dissolve = leaving.animate([
      { opacity: 1, transform: "none", filter: "blur(0)" },
      { opacity: 0, transform: "translateX(-24px) scale(.985)", filter: "blur(6px)" },
    ], { duration: 240, easing: "cubic-bezier(.4, 0, .9, .7)", fill: "forwards" });
    dissolve.finished.then(handOver, handOver);
  }), [router, arrived]);

  return <Arrival.Provider value={navigate}>
    {children}
    {/* The loader itself waits a quarter second before it shows, so a quick page never flashes it. */}
    {moving ? <div className="nav-loading" aria-hidden="true"><InkLoader /></div> : null}
  </Arrival.Provider>;
}

/** Wrap the app once, in the root layout. */
export function CrossingProvider({ children }: { children: ReactNode }) {
  return <CrossingLayer><Arrivals>{children}</Arrivals></CrossingLayer>;
}

/**
 * One place that knows how to leave.
 *
 * The press is what starts the load, so the next page is being fetched while
 * the screen is still closing and the crossing is spent waiting on nothing.
 * The page changes hands only once the screen covers everything, and if it is
 * not there by then the screen stays shut until it is.
 */
export function useCrossTo() {
  const cross = useCrossing();
  const navigate = useContext(Arrival);
  const router = useRouter();

  return useCallback((kind: CrossingKind, href: string, external = false, destinationAccent?: string) => {
    if (!external) router.prefetch(href, whole);
    const source = getComputedStyle(document.querySelector(".app-frame") || document.documentElement);
    const portal = getComputedStyle(document.documentElement);
    const destination = destinationAccent ? accentRamp(destinationAccent) : null;
    const colors = {
      from: source.getPropertyValue("--k-accent").trim(),
      fromPale: source.getPropertyValue("--k-accent-pale").trim(),
      to: destination?.deep || portal.getPropertyValue("--k-accent").trim(),
      toPale: destination?.tint || portal.getPropertyValue("--k-accent-pale").trim(),
    };
    cross(kind, () => {
      if (external) {
        // This document is being replaced, so nothing here will open the
        // screen again; the crossing's own ceiling covers a load that never
        // lands.
        window.location.assign(href);
        return new Promise<void>(() => {});
      }
      return navigate(href);
    }, colors);
  }, [cross, navigate, router]);
}

/**
 * A link that crosses rather than navigates. Which crossing you get is decided
 * by how far you are going, never by taste — see docs/design-system.md.
 *
 *   hanafubuki  leaving Kimono for an app, or moving between apps
 *   shoji       passing through a door you operated
 *   kakejiku    page to page inside one surface
 */
/*
 * Warm the whole page, not just its loading shell. Every page here is dynamic,
 * and the default prefetch stops at the nearest loading boundary, which for
 * these pages is the root's skeleton: nothing worth having. A full prefetch
 * on hover means the press usually finds the page already fetched.
 */
const whole = { kind: "full" } as unknown as Parameters<ReturnType<typeof useRouter>["prefetch"]>[1];

/**
 * Warm a destination before the press. Kimono navigates with plain anchors and
 * doors rather than next/link, so nothing is fetched ahead unless we say so.
 */
export function useWarm() {
  const router = useRouter();
  return (href: string, external = false) => () => { if (!external) router.prefetch(href, whole); };
}

export function Crossing({ href, kind, external = false, destinationAccent, children, className, onClick, ...rest }: {
  href: string;
  kind: CrossingKind;
  external?: boolean;
  destinationAccent?: string;
  children: ReactNode;
  className?: string;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const crossTo = useCrossTo();
  const warm = useWarm()(href, external);

  return <a
    href={href}
    className={className}
    onPointerEnter={warm}
    onFocus={warm}
    onClick={(event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0 || rest.target === "_blank" || rest.download !== undefined) return;
      event.preventDefault();
      crossTo(kind, href, external, destinationAccent);
    }}
    {...rest}
  >{children}</a>;
}

/** Destination seals always cross. Downloads and new tabs retain browser behavior. */
export function CrossingSeal({ tone = "primary", kind = "kakejiku", compact = false, className, href, ...props }: {
  tone?: SealTone;
  kind?: CrossingKind;
  /** 36px tall, still a 44px target — the same as Seal's compact. */
  compact?: boolean;
  href: string;
  children: ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return <Crossing kind={kind} href={href} external={/^https?:\/\//.test(href)}
    className={cx("k-seal", tone !== "primary" && `k-tone-${tone}`, compact && "k-compact", className)} {...props} />;
}
