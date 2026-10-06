import type { CSSProperties } from "react";
import { accentRamp, KimonoMark, AppLockup, Field, Form, FormActions, Seal, Tray, Compartment } from "@kimono/ui";
import { notFound } from "next/navigation";
import { getAppDefinition } from "@/lib/definitions";
import { AppLauncher } from "@/components/app-card";
import { AppsCatalog } from "../admin/apps/apps-catalog";
import type { RegisteredApp } from "@/lib/apps";
import { ToolsDocumentation } from "../tools/tools-documentation";
import "../tools/tools.css";
export default async function ToolsPreview({ searchParams }: { searchParams: Promise<{view?: string}> }) {
  const { view } = await searchParams;
  if (process.env.NODE_ENV !== "development") notFound();
  const definition = await getAppDefinition("kimono-tools");
  if (!definition) notFound();
  const accent = definition.metadata.colors[0];
  const apis = (definition.spec.apiCollection || []).map(api => ({ api, enabled: false, hasKey: false, access: Object.fromEntries(api.operations.map(op => [op.id, "disabled" as const])) }));
  const definitions = (view === "catalog" || view === "home") ? await Promise.all(["kimono-tools", "forgejo", "outline", "pelican", "immich"].map(getAppDefinition)) : [];
  const catalog = definitions.filter(d => d !== undefined).map(d => ({ id: d.metadata.id, name: d.metadata.name, shortName: d.metadata.shortName || d.metadata.name, description: d.metadata.description, href: "", iconUrl: d.iconUrl, integration: d.spec.integration, accent: d.metadata.colors[0], glyph: d.metadata.glyph, external: !d.spec.portalPath, category: d.metadata.category, version: d.metadata.version, source: d.spec.portalPath ? "native" : d.source, installed: false, enabled: false, state: "available", stateLabel: "Available", stateDetail: "Not configured", catalogHref: `/admin/apps/${d.metadata.id}`, launchable: false, publishable: !d.spec.portalPath } as RegisteredApp));
  return <div className="app-frame in-app" style={{ "--k-app-accent": accentRamp(accent).deep } as CSSProperties}><header className="top-header"><div className="header-inner">{view === "home" ? <KimonoMark /> : <AppLockup identity={{ id: "kimono-tools", name: "tools", accent, glyph: "tools" }} />}</div></header>{view === "home" ? <main className="page home-page"><header className="home-hero"><div className="hero-copy"><h1>Welcome home.</h1></div></header><AppLauncher apps={catalog} /></main> : view === "catalog" ? <main className="page"><AppsCatalog apps={catalog} /></main> : view === "forms" ? <main className="page"><div className="page-header"><h1>Application configuration</h1><p>Shared controls · synthetic preview</p></div><Tray><Compartment label="Configuration"><Form><Field label="Application name"><input defaultValue="Kimono Tools" /></Field><Field label="Endpoint access"><select defaultValue="public"><option value="disabled">Disabled</option><option value="public">Public</option><option value="api-key">API key required</option></select></Field><FormActions><Seal>Save configuration</Seal><Seal tone="quiet">Cancel</Seal><Seal disabled>Unavailable</Seal></FormActions></Form></Compartment></Tray></main> : <ToolsDocumentation apis={apis} selectedId="mawaqit" administrator origin="http://localhost:3000" accent={accent} />}</div>;
}
