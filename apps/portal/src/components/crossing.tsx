"use client";

import { CrossingProvider as CrossingLayer, useCrossing, type CrossingKind } from "@kimono/ui";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useTransition, type MouseEvent, type ReactNode } from "react";

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

  const arrived = useCallback(() => {
    const resolve = waiting.current;
    waiting.current = null;
    resolve?.();
  }, []);

  // React ending the transition is the page standing. The pathname is the
  // second witness, for a navigation that never had to suspend.
  useEffect(() => { if (!pending) arrived(); }, [pending, arrived]);
  useEffect(() => { arrived(); }, [pathname, arrived]);

  const navigate = useCallback((href: string) => new Promise<void>((resolve) => {
    waiting.current = resolve;
    startTransition(() => { router.push(href); });
  }), [router]);

  return <Arrival.Provider value={navigate}>{children}</Arrival.Provider>;
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

  return (kind: CrossingKind, href: string, external = false) => {
    if (!external) router.prefetch(href);
    cross(kind, () => {
      if (external) {
        // This document is being replaced, so nothing here will open the
        // screen again; the crossing's own ceiling covers a load that never
        // lands.
        window.location.assign(href);
        return new Promise<void>(() => {});
      }
      return navigate(href);
    });
  };
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

export function Crossing({ href, kind, external = false, children, className, ...rest }: {
  href: string;
  kind: CrossingKind;
  external?: boolean;
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
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      crossTo(kind, href, external);
    }}
    {...rest}
  >{children}</a>;
}
