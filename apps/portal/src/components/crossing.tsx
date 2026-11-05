"use client";

import { CrossingProvider as CrossingLayer, useCrossing, accentRamp, cx, type SealTone, type CrossingKind } from "@kimono/ui";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { InkLoader } from "@/components/ink-loader";
import { riseWhenReady } from "@/components/motion";

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
  const arrived = useCallback(() => {
    const resolve = waiting.current;
    waiting.current = null;
    if (!resolve) return;
    setMoving(false);
    const page = document.querySelector<HTMLElement>(".main-content");
    if (page) {
      page.getAnimations().forEach((animation) => animation.cancel());
      if (!still()) page.animate([{ opacity: 0, transform: "translateX(40px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(.05, .7, .1, 1)" });
    }
    resolve();
  }, []);

  // React ending the transition is the page standing. The pathname is the
  // second witness, for a navigation that never had to suspend.
  useEffect(() => { if (!pending) arrived(); }, [pending, arrived]);
  useEffect(() => { arrived(); }, [pathname, arrived]);

  // Every new page, back and forward included, settles in piece by piece. The
  // first page of a visit is already painted from the server, so it stays put.
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    return riseWhenReady(document.querySelector(".main-content"));
  }, [pathname]);

  useEffect(() => {
    // Release the superseded navigation promise as well as its visual cover.
    window.addEventListener("popstate", arrived);
    window.addEventListener("pagehide", arrived);
    return () => {
      window.removeEventListener("popstate", arrived);
      window.removeEventListener("pagehide", arrived);
      arrived();
    };
  }, [arrived]);

  const navigate = useCallback((href: string) => new Promise<void>((resolve) => {
    const leaving = document.querySelector<HTMLElement>(".main-content");
    if (leaving && !still()) leaving.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-32px)" }], { duration: 120, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" });
    setMoving(true);
    waiting.current = resolve;
    startTransition(() => { router.push(href); });
  }), [router]);

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
    if (!external) router.prefetch(href);
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
/**
 * Warm a destination before the press. Kimono navigates with plain anchors and
 * doors rather than next/link, so nothing is fetched ahead unless we say so.
 */
export function useWarm() {
  const router = useRouter();
  return (href: string, external = false) => () => { if (!external) router.prefetch(href); };
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
