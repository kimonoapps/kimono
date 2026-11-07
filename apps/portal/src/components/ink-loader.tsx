"use client";

import { InkLoader as Wave } from "@kimono/ui";

/* The page-change loader: Kimono's brushed wavy bar, running (packages/ui/src/loading.tsx). */
export function InkLoader() {
  return <Wave className="ink-loader" />;
}
