"use client";

import { type FocusEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "./cx";

/* ═══════════════════════════════════════════════════════════════
   型 Kata — the three interaction primitives.

   Every interactive thing in Kimono is a door, a joint, or a seal.
   If a need does not fit one of the three, it is text and a seal —
   not a new object. See docs/design-system.md.
   ═══════════════════════════════════════════════════════════════ */

const shoji = <><i /><i /></>;

/**
 * 障子 Door — goes somewhere. Navigation only, and only in chrome.
 * Renders a button by default, or an anchor when given an href.
 */
type DoorProps = {
  /** Given an href the door is a link; without one it is a button. */
  href?: string;
  label: string;
  /** The room you are already in: the screens stand open and the plate inks. */
  here?: boolean;
  className?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  /** Reaching for a door is already an intention: chrome warms what it opens. */
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
};

export function Door({ href, label, here = false, children, className, ...rest }: DoorProps & { children?: ReactNode }) {
  const inner = <>{shoji}{children ? <span className="k-plate">{children}</span> : null}</>;
  const shared = {
    className: cx("k-door", here && "k-here", className),
    "aria-label": children ? undefined : label,
    "aria-current": here ? ("page" as const) : undefined,
    ...rest,
  };
  return href
    ? <a href={href} {...shared}>{inner}</a>
    : <button type="button" {...shared}>{inner}</button>;
}
