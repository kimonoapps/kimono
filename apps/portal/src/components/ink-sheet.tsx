"use client";

import { useEffect, useId, type ReactNode } from "react";
import { blotPath, inkFilters, inkRandom, InkBlot } from "@kimono/ui";
import { LineIcon, type LineIconName } from "./line-icon";

function seedOf(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

/**
 * 墨 Kimono's dialog on the web, as on the phone (InkDialog.kt): a sheet of
 * paper with a wash of colour bled in from its top corner, the subject's mark
 * in its own puddle, a Mincho title, and its seals along the foot.
 */
export function InkSheet({ title, icon, tint = "#a84d63", onClose, actions, children }: {
  title: string;
  icon?: LineIconName;
  tint?: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const unique = useId().replaceAll(":", "");
  const random = inkRandom(seedOf(`bleed:${title}`));
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  /* The wash is the tint bled into the sheet's own paper, so it reads by day and by night. */
  const bleed = `<defs>${inkFilters(unique, 13)}</defs>`
    + `<path d="${blotPath(random, 22, 20, 30)}" style="fill: color-mix(in srgb, ${tint} 10%, var(--sc-low))" filter="url(#ink-wash-${unique})"></path>`
    + `<path d="${blotPath(random, 14, 12, 19)}" style="fill: color-mix(in srgb, ${tint} 16%, var(--sc-low))" filter="url(#ink-wash-${unique})" opacity=".8"></path>`;
  return <div className="scrim open ink-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sheet ink-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <svg className="ink-sheet-bleed" viewBox="0 0 100 100" aria-hidden="true" dangerouslySetInnerHTML={{ __html: bleed }} />
      <span className="handle" />
      <div className="ink-sheet-head">
        {icon ? <InkBlot tint={tint} seed={`head:${title}`}><LineIcon name={icon} /></InkBlot> : null}
        <h3>{title}</h3>
      </div>
      <div className="ink-sheet-body">{children}</div>
      {actions ? <div className="ink-sheet-actions">{actions}</div> : null}
    </div>
  </div>;
}
