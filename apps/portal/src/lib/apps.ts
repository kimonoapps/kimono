import type { AppIdentity, GlyphName } from "@kimono/ui";
import { kimonoApps, type KimonoOwnApp } from "./kimono-apps";
import { appHostname, tunnelIsReady, type PlatformSettings } from "./settings";
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
  mobileApp?: { name: string; guideUrl: string; steps: string[] };
};

/**
 * A hosted app's accent. Installed apps still store a legacy triple; its first
 * entry has always been the colour they are recognised by.
 */
export function accentOf(colors: readonly string[]): string {
  return colors[0] || "#a84d63";
}

/** One resolved registry feeds every application view. */
export type RegisteredApp = KimonoApp & {
  category: string;
  version: string;
  source: "native" | "embedded" | "filesystem";
  installed: boolean;
  enabled: boolean;
  state: "problem" | "disabled" | "private" | "public" | "system" | "available";
  stateLabel: string;
  stateDetail: string;
  hostname?: string;
  catalogHref: string;
  launchable: boolean;
  publishable: boolean;
  requires?: "mesh";
};

/** The same configuration gate controls the catalog, launcher, and app routes. */
export function nativeAppEnabled(app: KimonoOwnApp, settings: PlatformSettings): boolean {
  switch (app.configuration) {
    case "mesh": return Boolean(settings.meshDomain && process.env.KIMONO_MESH_API_KEY);
  }
}

export function appRegistry(settings: PlatformSettings, definitions: AppDefinition[]): RegisteredApp[] {
  const hosted: RegisteredApp[] = definitions.filter((definition) => definition.metadata.id !== "kimono-portal").flatMap((definition) => {
    const instances = Object.values(settings.apps).filter((app) => app.definitionId === definition.metadata.id);
    return (instances.length ? instances : [undefined]).map((instance): RegisteredApp => {
      const nativePath = definition.spec.portalPath;
      const enabled = Boolean(instance?.enabled && definition.spec.setupReady !== false);
      const tunnel = instance?.tunnelId ? settings.tunnels[instance.tunnelId] : undefined;
      const tunnelConnected = tunnelIsReady(tunnel);
      const endpoint = definition.spec.services.some((service) => service.endpoint);
      const route = instance ? Object.values(settings.routes).find((candidate) => candidate.appId === instance.id && candidate.tunnelId === instance.tunnelId) : undefined;
      let state: RegisteredApp["state"] = "available";
      let stateLabel = "Available";
      let stateDetail = "Not configured";
      if (instance) {
        if (!enabled) { state = "disabled"; stateLabel = "Disabled"; stateDetail = "Configured, switched off"; }
        else if (nativePath) { state = "system"; stateLabel = "Enabled"; stateDetail = "Built into Kimono"; }
        else if (!instance.tunnelId) { state = "private"; stateLabel = "Private"; stateDetail = "Running without a public tunnel"; }
        else if (!tunnel) { state = "problem"; stateLabel = "Needs attention"; stateDetail = "Selected tunnel no longer exists"; }
        else if (!tunnelConnected) { state = "problem"; stateLabel = "Needs attention"; stateDetail = `${tunnel.name} is not connected`; }
        else if (endpoint && !route?.enabled) { state = "problem"; stateLabel = "Needs attention"; stateDetail = "Public route is not active"; }
        else { state = "public"; stateLabel = "Public"; stateDetail = `Through ${tunnel.name}`; }
      }
      return {
        id: instance?.id || definition.metadata.id,
        shortName: definition.metadata.shortName || instance?.name || definition.metadata.name,
        integration: definition.spec.integration,
        glyph: definition.metadata.glyph,
        external: !nativePath,
        mobileApp: definition.spec.mobileApp,
        href: nativePath || (instance ? `https://${appHostname(instance.domain, settings.baseDomain)}` : ""),
        catalogHref: `/admin/apps/${instance?.id || definition.metadata.id}`,
        launchable: enabled && Boolean(nativePath || instance?.tunnelId),
        publishable: !nativePath,
        name: instance?.name || definition.metadata.name,
        description: definition.metadata.description,
        category: definition.metadata.category,
        version: definition.metadata.version,
        source: nativePath ? "native" : definition.source,
        iconUrl: definition.iconUrl,
        accent: accentOf(instance?.colors || definition.metadata.colors),
        installed: Boolean(instance),
        enabled,
        state,
        stateLabel,
        stateDetail,
        hostname: instance && state === "public" ? instance.domain.includes(".") ? instance.domain : `${instance.domain}.${settings.baseDomain}` : undefined,
      };
    });
  });

  const native: RegisteredApp[] = kimonoApps.map((app) => {
    const enabled = nativeAppEnabled(app, settings);
    return {
    id: app.id,
    name: app.name,
    description: app.description,
    category: "Built into Kimono",
    version: "",
    source: "native",
    iconUrl: "",
    accent: app.accent,
    glyph: app.glyph,
    href: app.path,
    catalogHref: app.managementPath,
    shortName: app.shortName,
    integration: "native",
    external: false,
    requires: app.requires,
    launchable: enabled,
    publishable: false,
    installed: true,
    enabled,
    state: enabled ? "system" : "disabled",
    stateLabel: enabled ? "Enabled" : "Disabled",
    stateDetail: enabled ? "Mesh configured" : "Mesh is not configured",
    };
  });
  return [...hosted, ...native];
}

export function launcherApps(registry: RegisteredApp[], available: { mesh: boolean }): KimonoApp[] {
  return registry.filter((app) => app.launchable && (!app.requires || available[app.requires]));
}

export function catalogApps(registry: RegisteredApp[], intent?: "publish"): RegisteredApp[] {
  return intent === "publish" ? registry.filter((app) => app.publishable) : registry;
}

/** What an app shows of itself: its bloom, its lockup, its header. */
export function appIdentity(app: KimonoApp): AppIdentity {
  return { id: app.id, name: app.shortName, accent: app.accent, glyph: app.glyph };
}
