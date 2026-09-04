import type { AppIdentity, GlyphName } from "@kimono/ui";
import { kimonoApps } from "./kimono-apps";
import { appHostname, type PlatformSettings } from "./settings";
import type { AppDefinition } from "./definitions";

export type KimonoApp = {
  id: string;
  name: string;
  /** What follows the Kimono wordmark in a lockup: "VPN", "Notes". */
  shortName: string;
  description: string;
  href: string;
  iconUrl: string;
  integration: "native" | "headless" | "fork" | "connected" | "hosted";
  /** The one colour the app owns. Its bloom and lockup derive from this. */
  accent: string;
  /** Kimono's own apps draw a glyph; hosted apps ship an icon file. */
  glyph?: GlyphName;
  /** Kimono's own surfaces open in place; hosted apps leave the Portal. */
  external: boolean;
};

/**
 * A hosted app's accent. Installed apps still store a legacy triple; its first
 * entry has always been the colour they are recognised by.
 */
export function accentOf(colors: readonly string[]): string {
  return colors[0] || "#a84d63";
}

/** Kimono's own apps, as launcher entries. Identity comes from the registry. */
export function ownApps(available: { mesh: boolean }): KimonoApp[] {
  return kimonoApps
    .filter((app) => !app.requires || available[app.requires])
    .map((app) => ({
      id: app.id,
      name: app.name,
      shortName: app.shortName,
      description: app.description,
      href: app.path,
      iconUrl: "",
      integration: "native" as const,
      accent: app.accent,
      glyph: app.glyph,
      external: false,
    }));
}

/**
 * The server-side application registry is the single source of truth for the
 * launcher. Apps only appear when they have a real, configured destination;
 * each app owns its flower palette through its deployment configuration.
 */
export function getApps(settings: PlatformSettings, definitions: AppDefinition[]): KimonoApp[] {
  const byId = new Map(definitions.map((definition) => [definition.metadata.id, definition]));
  return Object.values(settings.apps).flatMap((instance) => {
    if (!instance.enabled || instance.definitionId === "kimono-portal" || !instance.tunnelId) return [];
    const definition = byId.get(instance.definitionId);
    if (!definition) return [];
    return [{ id: instance.id, name: instance.name, shortName: definition.metadata.shortName || instance.name, description: definition.metadata.description,
      href: `https://${appHostname(instance.domain, settings.baseDomain)}`, iconUrl: definition.iconUrl,
      integration: definition.spec.integration, accent: accentOf(instance.colors), external: true }];
  });
}

/** What an app shows of itself: its bloom, its lockup, its header. */
export function appIdentity(app: KimonoApp): AppIdentity {
  return { id: app.id, name: app.shortName, accent: app.accent, glyph: app.glyph };
}
