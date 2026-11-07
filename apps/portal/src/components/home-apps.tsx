"use client";

import type { ReactNode } from "react";
import { AppTiles } from "./app-card";
import { usePins } from "./pins";
import type { KimonoApp } from "@/lib/apps";
import type { RailApp } from "./rail";

type TileApp = RailApp & { mobileApp?: KimonoApp["mobileApp"]; line?: string };

/**
 * Home's apps: Your apps first, dragged into your order (the rail and the
 * phone's flower follow), then [children] (Now), then every other app under
 * what it's for.
 */
export function HomeApps({ apps, mine, groups, children }: { apps: TileApp[]; mine: string[]; groups: { id: string; label: string; apps: string[] }[]; children?: ReactNode }) {
  const [pins, setPins] = usePins(mine);
  const byId = new Map(apps.map((app) => [app.id, app]));
  const mineHere = pins.flatMap((id) => byId.get(id) ?? []);
  /* Every other app under what it's for: a pinned one is already up top. */
  const pinned = new Set(pins);
  const rest = groups.map((group) => ({ ...group, apps: group.apps.flatMap((id) => pinned.has(id) ? [] : byId.get(id) ?? []) })).filter((group) => group.apps.length);
  /* Apps this person can't open right now keep their place at the end. */
  const reorder = (ids: string[]) => setPins([...ids, ...pins.filter((id) => !byId.has(id))]);
  return <>
    <section className="home-section">
      <h2 className="home-section-title">Your apps</h2>
      {mineHere.length ? <AppTiles apps={mineHere} mine={mine} onReorder={reorder} /> : <p className="home-empty">Pin an app below to keep it here.</p>}
    </section>
    {children}
    {rest.length ? <section className="home-section home-more">
      <h2 className="home-section-title">{mineHere.length ? "More apps" : "Apps"}</h2>
      {rest.map((group) => <div className="home-more-group" key={group.id}>
        {rest.length > 1 ? <h3 className="home-more-label">{group.label}</h3> : null}
        <AppTiles apps={group.apps} mine={mine} compact />
      </div>)}
    </section> : null}
  </>;
}
