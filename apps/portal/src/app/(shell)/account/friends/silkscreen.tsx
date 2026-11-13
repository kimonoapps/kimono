"use client";

import { useEffect, useRef, useState } from "react";
import { Seal } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import type { Turntable } from "./silkscreen-scene";

/*
 * 本 Silkscreen Kimono: someone reads on a Silkscreen e-reader in Kimono's
 * case. The badge holds the case itself, turning (silkscreen-scene.ts, loaded
 * only here); the case is iandchasse's Silkscreen enclosure, CERN-OHL-S-2.0,
 * credited under it and in the model's NOTICE.
 */
export function SilkscreenBadge({ since, you }: { since: string; you: boolean }) {
  const when = new Date(since).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const stage = useRef<HTMLDivElement>(null);
  const table = useRef<Turntable | null>(null);
  const [ready, setReady] = useState(false);
  const [back, setBack] = useState(false);

  useEffect(() => {
    const host = stage.current;
    if (!host) return;
    let gone = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void import("./silkscreen-scene")
      .then(({ mountTurntable }) => mountTurntable(host, { still, onTurned: setBack }))
      .then((t) => { if (gone) t.dispose(); else { table.current = t; setReady(true); } }, () => undefined);
    return () => { gone = true; table.current?.dispose(); table.current = null; };
  }, []);

  const says = you ? "You read on a Silkscreen Kimono" : "Reads on a Silkscreen Kimono";
  return <div className="fr-silkscreen" role="group" aria-label={`${says} since ${when}`}>
    <div ref={stage} className={`fr-ss-stage${ready ? " is-ready" : ""}`} aria-hidden="true" title="Drag to turn it" />
    <div className="fr-ss-words">
      <b>{you ? says : "Silkscreen Kimono"}</b>
      <span>since {when}</span>
      <Seal tone="quiet" compact onClick={() => table.current?.turnOver()} disabled={!ready}>{back ? "Front" : "Turn over"}</Seal>
      <Crossing kind="kakejiku" external target="_blank" rel="noreferrer" className="fr-ss-credit" href="/models/silkscreen-kimono/NOTICE.txt">Case by iandchasse · CERN-OHL-S-2.0</Crossing>
    </div>
  </div>;
}
