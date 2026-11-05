import type { ReactNode } from "react";

/* Where the browser has no view transitions, a page still settles in as it arrives; elsewhere PageTransition moves it (ADR 0006). */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-swipe">{children}</div>;
}
