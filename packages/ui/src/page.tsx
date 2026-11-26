"use client";

import { type ReactNode } from "react";
import { cx } from "./cx";

/**
 * 頁 A page's heading: its title in Mincho, one sentence under it, and the
 * page's actions on the right. Every portal page that is not an app's own
 * masthead opens with one, so no page draws its own.
 */
export function PageHeader({ title, description, eyebrow, mark, back, children, className }: {
  title: ReactNode;
  description?: ReactNode;
  /** A short line above the title: where this page sits ("Across your spaces", a trail). */
  eyebrow?: ReactNode;
  /** The thing the page is about, drawn before the title: a space's mark, an app's bloom, a portrait. */
  mark?: ReactNode;
  /** The way back, before everything: a `BackButton`, or a link styled `k-back`. */
  back?: ReactNode;
  /** Seals, doors, or a stated chip belonging to the whole page. */
  children?: ReactNode;
  className?: string;
}) {
  return <header className={cx("k-page-header", back || mark ? "k-has-lead" : null, className)}>
    {back ? <div className="k-page-header-back">{back}</div> : null}
    {mark ? <div className="k-page-header-mark">{mark}</div> : null}
    <div className="k-page-header-copy">
      {eyebrow ? <div className="k-page-header-eyebrow">{eyebrow}</div> : null}
      <h1>{title}</h1>
      {description ? <div className="k-page-header-description">{description}</div> : null}
    </div>
    {children ? <div className="k-page-header-actions">{children}</div> : null}
  </header>;
}
