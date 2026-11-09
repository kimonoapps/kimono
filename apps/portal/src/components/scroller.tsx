"use client";

import type { HTMLAttributes, ReactNode, RefObject } from "react";

/*
 * A scroll area with the browser's own scroll bar, inked to fit Kimono
 * (globals.css, .k-scroller). Wheel, touch, dragging, track clicks, arrow keys,
 * Page Up/Down and Space are all the browser's, and the view takes focus so
 * the keys work before anything inside it is clicked.
 */

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
  return <div className={`k-scroller${tone === "lift" ? " lift" : ""}${fit ? " fit" : ""}${className ? ` ${className}` : ""}`}>
    <View ref={viewRef ? (node: HTMLElement | null) => { viewRef.current = node; } : undefined} tabIndex={0} className={`k-scroller-view${viewClassName ? ` ${viewClassName}` : ""}`} {...view}>{children}</View>
  </div>;
}
