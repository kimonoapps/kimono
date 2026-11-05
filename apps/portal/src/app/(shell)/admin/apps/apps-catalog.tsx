"use client";

import { AppBloom, InkCard } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import type { RegisteredApp } from "@/lib/apps";
import { useMemo, useState } from "react";

type CatalogApp = RegisteredApp;
type Filter = "all" | "attention" | "running" | "disabled" | "available";

const running = (app: CatalogApp) => app.state === "public" || app.state === "private" || app.state === "system";
const order = ["problem", "public", "private", "system", "disabled", "available"];

/* A state is a dot with a word: moss when it runs, suō when it needs you, quiet otherwise. */
function StateDot({ app }: { app: CatalogApp }) {
  if (app.state === "problem") return <span className="k-ink-dot k-wants">Needs you</span>;
  if (running(app)) return <span className="k-ink-dot k-running">{app.state === "private" ? "Private" : "Running"}</span>;
  return <span className="k-ink-dot">{app.state === "disabled" ? "Off" : "Available"}</span>;
}

/*
 * Applications (design/mockups/m3-everywhere.html): apps that need you come
 * first in pink cards with the reason written out, then everything else.
 * Filters are Material filter chips that tick when on.
 */
export function AppsCatalog({ apps, intent }: { apps: CatalogApp[]; intent?: "publish" }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const counts = useMemo(() => ({
    attention: apps.filter((app) => app.state === "problem").length,
    running: apps.filter(running).length,
    disabled: apps.filter((app) => app.state === "disabled").length,
    available: apps.filter((app) => app.state === "available").length,
  }), [apps]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (app: CatalogApp) => filter === "all"
      || filter === "attention" && app.state === "problem"
      || filter === "running" && running(app)
      || app.state === filter;
    return apps.filter((app) => matches(app) && (!needle || [app.name, app.description, app.category, app.id, app.stateLabel, app.stateDetail, app.hostname || ""].some((value) => value.toLowerCase().includes(needle))))
      .toSorted((left, right) => order.indexOf(left.state) - order.indexOf(right.state) || left.name.localeCompare(right.name));
  }, [apps, filter, query]);
  const needYou = visible.filter((app) => app.state === "problem");
  const rest = visible.filter((app) => app.state !== "problem");

  const card = (app: CatalogApp) => {
    const want = app.state === "problem";
    const link = <Crossing className={want ? "app-card want" : "app-card"} kind="kakejiku" href={`${app.catalogHref}${intent === "publish" ? "?intent=publish" : ""}`}>
      <span className="top"><AppBloom className="bloom" identity={{ id: app.id, name: app.name, accent: app.accent, glyph: app.glyph }} glyphHref={app.iconUrl} size="mark" /><StateDot app={app} /></span>
      <b>{app.name}</b>
      <p>{want ? `${app.stateDetail}. Pick another connection or keep it private.` : app.description}</p>
      {want ? null : <code>{app.hostname && app.installed ? app.hostname : app.state === "system" ? "Built into Kimono" : app.category}</code>}
    </Crossing>;
    return want ? <InkCard key={app.id} colour="#a84d63" seed={`app-${app.id}`} className="app-card-ink">{link}</InkCard> : <span key={app.id} className="app-card-ink">{link}</span>;
  };

  return (
    <>
      <div className="apps-toolbar">
        <label className="search">
          <LineIcon name="search" />
          <span className="sr-only">Search applications</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search applications" />
          {query ? <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button> : null}
        </label>
        <div className="filters" role="group" aria-label="Filter applications">
          {([
            ["all", "All", apps.length],
            ["attention", "Needs you", counts.attention],
            ["running", "Running", counts.running],
            ["disabled", "Off", counts.disabled],
            ["available", "Available", counts.available],
          ] as Array<[Filter, string, number]>).filter(([id, , count]) => id === "all" || count > 0).map(([id, label, count]) =>
            <button key={id} type="button" className="filter" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label} <small>{count}</small></button>)}
        </div>
      </div>
      {needYou.length ? <><div className="label">Needs you</div><div className="apps-grid">{needYou.map(card)}</div></> : null}
      {rest.length ? <><div className="label">{needYou.length ? "Everything else" : intent === "publish" ? "Choose an app" : { all: "All apps", attention: "Needs you", running: "Running", disabled: "Off", available: "Available" }[filter]}</div><div className="apps-grid">{rest.map(card)}</div></> : null}
      {visible.length ? null : <p className="apps-empty">{query ? `No applications match “${query}”.` : "No applications have this status."}</p>}
    </>
  );
}
