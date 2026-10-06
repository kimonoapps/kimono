"use client";

import { AppBloom, StatedSeal, type SealState } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import type { RegisteredApp } from "@/lib/apps";
import { useMemo, useState } from "react";

type CatalogApp = RegisteredApp;

/* State is stamped, not tinted: every catalog card wears a 判 seal that says
   the same thing in words as the card says in material. */
const sealStates: Record<CatalogApp["state"], SealState> = {
  problem: "wants",
  disabled: "quiet",
  private: "private",
  public: "running",
  system: "running",
  available: "quiet",
};

type Filter = "all" | "attention" | "running" | "private" | "disabled" | "available";

export function AppsCatalog({ apps, intent }: { apps: CatalogApp[]; intent?: "publish" }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const counts = useMemo(() => ({
    attention: apps.filter((app) => app.state === "problem").length,
    running: apps.filter((app) => app.state === "public" || app.state === "private" || app.state === "system").length,
    private: apps.filter((app) => app.state === "private").length,
    disabled: apps.filter((app) => app.state === "disabled").length,
    available: apps.filter((app) => app.state === "available").length,
  }), [apps]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matchesFilter = (app: CatalogApp) => filter === "all"
      || filter === "attention" && app.state === "problem"
      || filter === "running" && (app.state === "public" || app.state === "private" || app.state === "system")
      || app.state === filter;
    return apps.filter((app) => matchesFilter(app) && (!needle || [app.name, app.description, app.category, app.id, app.stateLabel, app.stateDetail, app.hostname || ""].some((value) => value.toLowerCase().includes(needle))))
      .toSorted((left, right) => ["problem", "disabled", "private", "public", "system", "available"].indexOf(left.state) - ["problem", "disabled", "private", "public", "system", "available"].indexOf(right.state) || left.name.localeCompare(right.name));
  }, [apps, filter, query]);

  function grid(items: CatalogApp[]) {
    return <div className="app-catalog-grid">
      {items.map((app) => (
        <Crossing className={`catalog-app state-${app.state}`} kind="kakejiku" href={`${app.catalogHref}${intent === "publish" ? "?intent=publish" : ""}`} key={app.id}>
          <span className="catalog-card-top">
            <span className="catalog-icon"><AppBloom identity={{ id: app.id, name: app.name, accent: app.accent, glyph: app.glyph }} glyphHref={app.iconUrl} /></span>
            <StatedSeal state={sealStates[app.state]}>{app.stateLabel}</StatedSeal>
          </span>
          <span className="catalog-copy">
            <span className="catalog-title"><strong>{app.name}</strong></span>
            <span className="catalog-description">{app.description}</span>
            <span className="catalog-card-footer">
              {app.hostname && app.installed
                ? <code>{app.hostname}</code>
                : <span className={app.state === "problem" ? "is-wanted" : undefined}>{app.state === "problem" ? app.stateDetail : app.category}</span>}
              <span className="catalog-arrow" aria-hidden="true">{intent === "publish" ? "Choose" : "Open"} <b>→</b></span>
            </span>
          </span>
        </Crossing>
      ))}
    </div>;
  }

  return (
    <>
      <div className="catalog-toolbar">
        <label className="catalog-search">
          <span className="sr-only">Search applications</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search applications" />
          {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button> : null}
        </label>
        <nav className="catalog-filters" aria-label="Filter applications">
          {([
            ["all", "All", apps.length],
            ["attention", "Attention", counts.attention],
            ["running", "Running", counts.running],
            ["disabled", "Disabled", counts.disabled],
            ["available", "Available", counts.available],
          ] as Array<[Filter, string, number]>).filter(([id, , count]) => id === "all" || count > 0).map(([id, label, count]) => <button key={id} type="button" className={`k-seal ${filter === id ? "is-active" : "k-tone-quiet"} ${id === "attention" ? "has-problems" : ""}`} onClick={() => setFilter(id)}>{label}<span>{count}</span></button>)}
        </nav>
      </div>
      {visible.length ? (
        <div className="catalog-groups"><section><header className="catalog-results-heading"><h2>{intent === "publish" ? "Choose an application" : filter === "all" ? "All applications" : `${filter === "attention" ? "Needs attention" : filter[0].toUpperCase() + filter.slice(1)} applications`}</h2><span>{visible.length} {visible.length === 1 ? "app" : "apps"}</span></header>{grid(visible)}</section></div>
      ) : <p className="catalog-empty">{query ? `No applications match “${query}”.` : "No applications have this status."}</p>}
    </>
  );
}
