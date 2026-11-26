"use client";

import { type ReactNode } from "react";
import { cx } from "./cx";

/**
 * 頁 A page's heading: its title in Mincho, one sentence under it, and the
 * page's actions on the right. Every portal page that is not an app's own
 * masthead opens with one, so no page draws its own.
 */
export function PageHeader({ title, description, back, children, className }: {
  title: ReactNode;
  /** The way back, before the title: a `BackButton`, or a link styled `k-back`. */
  back?: ReactNode;
  description?: ReactNode;
  /** Seals, doors, or a stated chip belonging to the whole page. */
  children?: ReactNode;
  className?: string;
}) {
  return <header className={cx("k-page-header", back ? "k-has-back" : null, className)}>
    {back ? <div className="k-page-header-back">{back}</div> : null}
    <div className="k-page-header-copy">
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </div>
    {children ? <div className="k-page-header-actions">{children}</div> : null}
  </header>;
}
