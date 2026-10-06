"use client";

import { type AnchorHTMLAttributes, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { cx } from "./cx";

export type SealState = "running" | "private" | "wants" | "quiet";

export type SealTone = "primary" | "quiet" | "danger";

/**
 * 判 Seal — the hanko. Commits an action. One colour in every app.
 * `compact` is 36px tall and still a 44px target.
 */
export function Seal({ tone = "primary", compact = false, className, ...props }: {
  tone?: SealTone;
  compact?: boolean;
  ref?: Ref<HTMLButtonElement>;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cx("k-seal", tone !== "primary" && `k-tone-${tone}`, compact && "k-compact", className)} {...props} />;
}

/** @deprecated Plain navigation bypasses transitions. Use the portal's CrossingSeal. */
export function SealLink({ tone = "primary", className, ...props }: { tone?: SealTone } & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a className={cx("k-seal", tone !== "primary" && `k-tone-${tone}`, className)} {...props} />;
}

/**
 * 札 Chip — a stated fact: fold paper and a word. Colour is permitted only
 * where it carries a consequence, and a word always sits beside it.
 */
export type ChipTone = "quiet" | "private" | "running" | "wants" | "ok" | "warn" | "danger" | "faint";

export function Chip({ tone = "quiet", children, className, ...props }: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">) {
  return <span className={cx("k-chip", tone !== "quiet" && `k-${tone}`, className)} {...props}>{children}</span>;
}

/** An HTTP method, the one uppercase chip. Writes read in suō; deletes fill it. */
export function MethodChip({ method, className }: { method: string; className?: string }) {
  const verb = method.toUpperCase();
  return <span className={cx("k-chip", "k-method", (verb === "POST" || verb === "PUT" || verb === "PATCH") && "k-write", verb === "DELETE" && "k-destroy", className)}>{verb}</span>;
}

/** The same chip, named by the state it states. Kept for existing callers. */
export function StatedSeal({ state = "quiet", children, className }: { state?: SealState; children: ReactNode; className?: string }) {
  return <Chip tone={state} className={className}>{children}</Chip>;
}
