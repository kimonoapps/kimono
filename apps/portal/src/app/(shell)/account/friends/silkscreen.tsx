"use client";

import { useEffect, useRef, useState } from "react";
import { Seal } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { InkSheet } from "@/components/ink-sheet";
import { LineIcon } from "@/components/line-icon";
import type { Turntable } from "./silkscreen-scene";

/*
 * 本 Silkscreen Kimono: someone reads on a Silkscreen e-reader in Kimono's
 * crimson case. Under their @name, the case itself turning (silkscreen-scene.ts,
 * loaded only here; drag it to spin it, tap it to turn it over) beside a
 * verified line, which opens a sheet saying what it is, with the case larger
 * and its credit (iandchasse's Silkscreen enclosure, CERN-OHL-S-2.0; NOTICE
 * beside the model).
 */
export function SilkscreenBadge({ since, you, name }: { since: string; you: boolean; name: string }) {
  const when = new Date(since).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const [open, setOpen] = useState(false);
  const who = you ? "You read" : `${name.split(" ")[0] || name} reads`;

  return <div className="fr-silkscreen">
    <Stage className="fr-ss-stage" />
    <button type="button" className="fr-ss-words" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <b>Silkscreen Kimono <span className="fr-ss-check" role="img" aria-label="verified"><LineIcon name="check" /></span></b>
      <small>Verified · since {when}</small>
    </button>
    {open ? <InkSheet title="Silkscreen Kimono" icon="reader" tint="#b0263c" onClose={() => setOpen(false)}
      actions={<Seal tone="quiet" compact onClick={() => setOpen(false)}>Close</Seal>}>
      <div className="fr-ss-sheet">
        <Stage className="fr-ss-big" />
        <p><b>{who} on a Silkscreen Kimono.</b> Verified: paired with Kimono since {when}, keeping {you ? "your" : "their"} place in Books.</p>
        <p>The Silkscreen is an open-hardware e-reader. This one wears Kimono&rsquo;s case: crimson, with the branch and the wordmark on its back. Drag it to turn it.</p>
        <Crossing kind="kakejiku" external target="_blank" rel="noreferrer" className="fr-ss-credit" href="/models/silkscreen-kimono/NOTICE.txt">Case: Silkscreen enclosure by iandchasse · CERN-OHL-S-2.0</Crossing>
      </div>
    </InkSheet> : null}
  </div>;
}

/** The case, turning: drag to spin, tap or Enter to turn over. */
function Stage({ className }: { className: string }) {
  const stage = useRef<HTMLSpanElement>(null);
  const table = useRef<Turntable | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = stage.current;
    if (!host) return;
    let gone = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void import("./silkscreen-scene")
      .then(({ mountTurntable }) => mountTurntable(host, { still }))
      .then((t) => { if (gone) t.dispose(); else { table.current = t; setReady(true); } }, () => undefined);
    return () => { gone = true; table.current?.dispose(); table.current = null; };
  }, []);

  return <span ref={stage} role="button" tabIndex={0} className={`${className}${ready ? " is-ready" : ""}`} aria-label="Turn the Silkscreen Kimono over"
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); table.current?.turnOver(); } }} />;
}
