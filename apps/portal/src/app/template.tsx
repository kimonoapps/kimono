import type { ReactNode } from "react";

/* Where the browser has no view transitions, a page still settles in as it arrives;
   elsewhere the navigation itself moves it (components/crossing.tsx, ADR 0006). */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-swipe">{children}</div>;
}
