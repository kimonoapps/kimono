"use client";

import { useCallback, useEffect, useRef, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";

/*
 * A scroll area with Kimono's own bars: slim ink strokes laid over the content,
 * shown while you scroll or hover and gone when you stop. The native bars are
 * hidden, so nothing takes room from the content or paints a white track on a
 * dark surface. Wheel, touch, keys and focus scrolling stay the browser's own.
 */

type Axis = "y" | "x";
const MIN_THUMB = 28;
const INSET = 4;

export function Scroller({ children, className, viewClassName, tone = "ink", fit = false, as: View = "div", viewRef, ...view }: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  /** The scrolling element's tag, so a log stays a <pre> and a file tree a <nav>. */
  as?: "div" | "pre" | "nav" | "aside" | "section";
  /** The scrolling element itself, for code that reads or sets its scroll. */
  viewRef?: RefObject<HTMLElement | null>;
  /** Classes on the outer box: size and place it here. */
  className?: string;
  /** Classes on the scrolling view: padding and layout of the content go here. */
  viewClassName?: string;
  /** "ink" on paper, "lift" on a dark surface. */
  tone?: "ink" | "lift";
  /** Take the content's height instead of filling the box (a code block in a page, scrolling sideways). */
  fit?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLElement>(null);
  const frame = useRef(0);
  const bars = useRef<Record<Axis, HTMLDivElement | null>>({ y: null, x: null });
  const idle = useRef<number | undefined>(undefined);

  const measure = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    for (const axis of ["y", "x"] as const) {
      const bar = bars.current[axis];
      const thumb = bar?.firstElementChild as HTMLElement | null;
      if (!bar || !thumb) continue;
      const client = axis === "y" ? el.clientHeight : el.clientWidth;
      const total = axis === "y" ? el.scrollHeight : el.scrollWidth;
      const at = axis === "y" ? el.scrollTop : el.scrollLeft;
      const over = total - client > 1;
      bar.hidden = !over;
      if (!over) continue;
      const track = (axis === "y" ? bar.clientHeight : bar.clientWidth) || client - INSET * 2;
      const size = Math.max(MIN_THUMB, Math.round(track * client / total));
      const offset = (track - size) * (at / (total - client));
      thumb.style[axis === "y" ? "height" : "width"] = `${size}px`;
      thumb.style.transform = axis === "y" ? `translateY(${offset}px)` : `translateX(${offset}px)`;
    }
  }, []);

  const wake = useCallback(() => {
    root.current?.setAttribute("data-scrolling", "");
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => root.current?.removeAttribute("data-scrolling"), 900);
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    /* Content can change many times a frame (a reply streaming in): measure once per frame. */
    const soon = () => { if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; measure(); }); };
    const onScroll = () => { measure(); wake(); };
    el.addEventListener("scroll", onScroll, { passive: true });
    const sizes = new ResizeObserver(soon);
    sizes.observe(el);
    for (const child of Array.from(el.children)) sizes.observe(child);
    const changes = new MutationObserver(() => {
      for (const child of Array.from(el.children)) sizes.observe(child);
      soon();
    });
    changes.observe(el, { childList: true, subtree: true, characterData: true });
    measure();
    return () => {
      el.removeEventListener("scroll", onScroll);
      sizes.disconnect();
      changes.disconnect();
      window.clearTimeout(idle.current);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [measure, wake]);

  /* Dragging a thumb moves the view by the same share; pressing the track pages toward the press. */
  const press = (event: ReactPointerEvent<HTMLDivElement>) => {
    const axis = event.currentTarget.dataset.axis as Axis;
    const el = viewport.current;
    const bar = bars.current[axis];
    const thumb = bar?.firstElementChild as HTMLElement | null;
    if (!el || !bar || !thumb || event.button !== 0) return;
    event.preventDefault();
    const vertical = axis === "y";
    const client = vertical ? el.clientHeight : el.clientWidth;
    const total = vertical ? el.scrollHeight : el.scrollWidth;
    const track = vertical ? bar.clientHeight : bar.clientWidth;
    const size = vertical ? thumb.offsetHeight : thumb.offsetWidth;
    const ratio = (total - client) / Math.max(1, track - size);
    if (event.target !== thumb) {
      const box = thumb.getBoundingClientRect();
      const before = vertical ? event.clientY < box.top : event.clientX < box.left;
      el.scrollBy({ [vertical ? "top" : "left"]: (before ? -1 : 1) * client * 0.9, behavior: "smooth" });
      return;
    }
    const start = vertical ? event.clientY : event.clientX;
    const from = vertical ? el.scrollTop : el.scrollLeft;
    bar.setPointerCapture(event.pointerId);
    root.current?.setAttribute("data-dragging", "");
    const move = (moved: PointerEvent) => {
      const to = from + ((vertical ? moved.clientY : moved.clientX) - start) * ratio;
      if (vertical) el.scrollTop = to; else el.scrollLeft = to;
    };
    const end = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", end);
      bar.removeEventListener("pointercancel", end);
      root.current?.removeAttribute("data-dragging");
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
  };

  return <div ref={root} className={`k-scroller${tone === "lift" ? " lift" : ""}${fit ? " fit" : ""}${className ? ` ${className}` : ""}`}>
    <View ref={(node: HTMLElement | null) => { viewport.current = node; if (viewRef) viewRef.current = node; }} className={`k-scroller-view${viewClassName ? ` ${viewClassName}` : ""}`} {...view}>{children}</View>
    <div ref={(node) => { bars.current.y = node; }} className="k-scroller-bar y" data-axis="y" aria-hidden="true" hidden onPointerDown={press}><i /></div>
    <div ref={(node) => { bars.current.x = node; }} className="k-scroller-bar x" data-axis="x" aria-hidden="true" hidden onPointerDown={press}><i /></div>
  </div>;
}
