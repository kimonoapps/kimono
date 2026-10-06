"use client";

import { type ReactNode } from "react";
import { cx } from "./cx";

/**
 * 頁 A page's heading: its title in Mincho, one sentence under it, and the
 * page's actions on the right. Every portal page that is not an app's own
 * masthead opens with one, so no page draws its own.
 */
export function PageHeader({ title, description, children, className }: {
  title: ReactNode;
  description?: ReactNode;
  /** Seals, doors, or a stated chip belonging to the whole page. */
  children?: ReactNode;
  className?: string;
}) {
  return <header className={cx("k-page-header", className)}>
    <div className="k-page-header-copy">
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </div>
    {children ? <div className="k-page-header-actions">{children}</div> : null}
  </header>;
}
