"use client";

import { useEffect, type ReactNode } from "react";
import { closeIris, immersiveAt, immersiveLayer, openIris, surface } from "@/components/immersive";

/*
 * 移 Moving between pages, as Material's shared x-axis and as the phone app
 * does: the page you leave slides a little way and fades, the next slides in
 * from the other side and settles. Forward goes left, back (the browser's
 * back, or a back link) goes right. Only the page moves: the rail and the
 * header stay where they are. Styles are in shell.css.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    /* Next restores history outside any React transition, and swaps the page
       before a view transition could capture the old one. So going back or
       forward through history moves the pages itself: a copy of the page you
       are leaving slides away over it while the real one slides in. */
    const traverse = (back: boolean, to: string) => {
      root.dataset.nav = back ? "back" : "forward";
      const main = document.querySelector<HTMLElement>(".main-content");
      if (!main || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      /* Into or out of a full-screen place (Watch) is its own crossing
         (components/immersive); within one, the place moves itself. */
      const layer = immersiveLayer(main);
      const into = immersiveAt(to);
      if (layer && into) return;
      const box = main.getBoundingClientRect();
      const ghost = (layer ?? main).cloneNode(true) as HTMLElement;
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      if (layer) {
        Object.assign(ghost.style, { pointerEvents: "none", viewTransitionName: "none" });
        document.body.appendChild(ghost);
        void closeIris(ghost).finally(() => ghost.remove());
      } else {
        Object.assign(ghost.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: "0", pointerEvents: "none", zIndex: "5", viewTransitionName: "none" });
        document.body.appendChild(ghost);
        ghost.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${back ? 32 : -32}px)` }], { duration: 120, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" }).finished.finally(() => ghost.remove());
      }
      /* The page arrives once Next has put it in place, often as a new element. */
      const arrive = () => {
        const next = document.querySelector<HTMLElement>(".main-content:not([aria-hidden])");
        if (!next) return;
        const opening = immersiveLayer(next);
        if (opening) { openIris(opening); return; }
        if (layer) { surface(next); return; }
        next.animate([{ opacity: 0, transform: `translateX(${back ? -48 : 48}px)` }, { opacity: 1, transform: "none" }], { duration: 380, delay: 40, easing: "cubic-bezier(.05, .7, .1, 1)", fill: "backwards" });
      };
      main.style.opacity = "0";
      const watch = new MutationObserver((changes) => {
        if (changes.every((change) => ghost.contains(change.target))) return;
        watch.disconnect(); clearTimeout(late); main.style.opacity = ""; arrive();
      });
      watch.observe(document.body, { childList: true, subtree: true, characterData: true });
      const late = setTimeout(() => { watch.disconnect(); main.style.opacity = ""; arrive(); }, 1000);
    };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a");
      if (link) root.dataset.nav = link.matches("[data-nav-back], [rel~='prev']") ? "back" : "forward";
    };
    addEventListener("click", click, true);
    const navigation = (window as { navigation?: EventTarget & { currentEntry?: { index: number } | null } }).navigation;
    const onNavigate = (event: Event) => {
      const e = event as Event & { navigationType?: string; destination?: { index: number; url: string } };
      if (e.navigationType === "traverse" && e.destination) traverse(e.destination.index < (navigation?.currentEntry?.index ?? 0), new URL(e.destination.url).pathname);
    };
    const onPop = () => traverse(true, location.pathname);
    if (navigation) navigation.addEventListener("navigate", onNavigate);
    else addEventListener("popstate", onPop);
    return () => {
      removeEventListener("click", click, true);
      if (navigation) navigation.removeEventListener("navigate", onNavigate);
      else removeEventListener("popstate", onPop);
    };
  }, []);
  /* Forward moves are drawn by the template's <ViewTransition>; this keeps the direction and draws history moves. */
  return <>{children}</>;
}
