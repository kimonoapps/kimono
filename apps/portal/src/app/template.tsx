import type { ReactNode } from "react";

/* Every page swipes in from the left as it arrives (ADR 0006). Nothing covers the screen. */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-swipe">{children}</div>;
}
