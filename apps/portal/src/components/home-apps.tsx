"use client";

import type { ReactNode } from "react";
import { AppTiles } from "./app-card";
import { usePins } from "./pins";
import type { KimonoApp } from "@/lib/apps";
import type { RailApp } from "./rail";

type TileApp = RailApp & { mobileApp?: KimonoApp["mobileApp"]; line?: string };

/**
 * Home's apps: My apps first, dragged into your order (the rail and the
 * phone's flower follow), then [children] (the glance at the house), then
 * every app under what it's for.
 */
export function HomeApps({ apps, mine, groups, children }: { apps: TileApp[]; mine: string[]; groups: { id: string; label: string; apps: string[] }[]; children?: ReactNode }) {
  const [pins, setPins] = usePins(mine);
  const byId = new Map(apps.map((app) => [app.id, app]));
  const mineHere = pins.flatMap((id) => byId.get(id) ?? []);
  /* Apps this person can't open right now keep their place at the end. */
  const reorder = (ids: string[]) => setPins([...ids, ...pins.filter((id) => !byId.has(id))]);
  return <>
    <section className="home-section">
      <h2 className="home-section-title">My apps</h2>
      {mineHere.length ? <AppTiles apps={mineHere} mine={mine} onReorder={reorder} /> : <p className="home-empty">Pin an app to keep it here.</p>}
    </section>
    {children}
    {groups.map((group) => <section className="home-section" key={group.id}>
      <h2 className="home-section-title">{group.label}</h2>
      <AppTiles apps={group.apps.flatMap((id) => byId.get(id) ?? [])} mine={mine} compact />
    </section>)}
  </>;
}
