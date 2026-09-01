import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppDefinition } from "./definitions";
import { publishDesiredState } from "./desired-state";
import { legacySettingsPath, settingsPath } from "./state";
import { getTunnelProvider, parseCloudflareTunnelToken, providerRunsConnector } from "./tunnel-providers";

export type CloudflareZone = { id: string; name: string };

export type Palette = readonly [`#${string}`, `#${string}`, `#${string}`];
export type EnvironmentOverride = { value: string; secret: boolean };
export type AppInstance = {
  id: string;
  definitionId: string;
  name: string;
  enabled: boolean;
  domain: string;
  colors: Palette;
  tunnelId: string | null;
  environment: Record<string, EnvironmentOverride>;
  networkPolicy: { internetAccess: boolean; allowedApps: string[] };
};
export type TunnelInstance = {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
  configuration: Record<string, EnvironmentOverride>;
};
export type AppRoute = {
  id: string;
  appId: string;
  endpointId: string;
  hostname: string;
  path: string;
  tunnelId: string;
  enabled: boolean;
};
export type PlatformSettings = {
  version: 4;
  baseDomain: string;
  identityDomain: string;
  meshDomain: string;
  brand: { colors: Palette };
  apps: Record<string, AppInstance>;
  tunnels: Record<string, TunnelInstance>;
  routes: Record<string, AppRoute>;
};

const domainPattern = /^(?:@|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/;
const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const idPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const colorPattern = /^#[0-9a-f]{6}$/i;

function hostnameFromUrl(value: string | undefined) { try { return value ? new URL(value).hostname : ""; } catch { return ""; } }
function validPalette(value: unknown, fallback: Palette): Palette {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "string" && colorPattern.test(item)) ? value as unknown as Palette : fallback;
}
function environmentMap(value: unknown): Record<string, EnvironmentOverride> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, EnvironmentOverride] => {
    const item = entry[1] as Partial<EnvironmentOverride> | null;
    return Boolean(item && typeof item.value === "string" && typeof item.secret === "boolean");
  }));
}

function defaults(): PlatformSettings {
  const baseDomain = process.env.KIMONO_BASE_DOMAIN || "example.com";
  const identityDomain = process.env.KIMONO_IDENTITY_DOMAIN || hostnameFromUrl(process.env.AUTHENTIK_ISSUER) || "";
  const meshDomain = process.env.KIMONO_MESH_DOMAIN || "";
  const notesColors: Palette = ["#b56d78", "#5f3441", "#ecd2b7"];
  return {
    version: 4,
    baseDomain,
    identityDomain,
    meshDomain,
    brand: { colors: ["#d77b8c", "#5f3441", "#f2cbd2"] },
    apps: {
      "kimono-portal": {
        id: "kimono-portal", definitionId: "kimono-portal", name: "Kimono Portal", enabled: true,
        domain: hostnameFromUrl(process.env.KIMONO_PORTAL_URL) || "kimono", colors: ["#d77b8c", "#5f3441", "#f2cbd2"],
        tunnelId: "public", environment: {}, networkPolicy: { internetAccess: true, allowedApps: [] },
      },
      // Applications start unpublished. An administrator enables Notes, picks its
      // hostname, and assigns a connection in the Admin portal.
      outline: {
        id: "outline", definitionId: "outline", name: "Kimono Notes", enabled: false,
        domain: "notes", colors: notesColors, tunnelId: null, environment: {},
        networkPolicy: { internetAccess: true, allowedApps: [] },
      },
    },
    tunnels: {
      public: { id: "public", name: "Public Cloudflare", provider: "cloudflare", enabled: true, configuration: {} },
    },
    routes: {
      "outline-web": { id: "outline-web", appId: "outline", endpointId: "web", hostname: `notes.${baseDomain}`, path: "/*", tunnelId: "public", enabled: false },
    },
  };
}

function normalizeInstance(value: unknown, fallback?: AppInstance): AppInstance | null {
  if (!value || typeof value !== "object") return fallback || null;
  const input = value as Partial<AppInstance>;
  if (!input.id || !input.definitionId) return fallback || null;
  return {
    id: input.id, definitionId: input.definitionId, name: input.name || fallback?.name || input.id,
    enabled: typeof input.enabled === "boolean" ? input.enabled : fallback?.enabled ?? false,
    domain: input.domain || fallback?.domain || input.id,
    colors: validPalette(input.colors, fallback?.colors || ["#777777", "#333333", "#dddddd"]),
    tunnelId: typeof input.tunnelId === "string" ? input.tunnelId : input.tunnelId === null ? null : fallback?.tunnelId || null,
    environment: environmentMap(input.environment),
    networkPolicy: {
      internetAccess: typeof input.networkPolicy?.internetAccess === "boolean" ? input.networkPolicy.internetAccess : fallback?.networkPolicy.internetAccess ?? true,
      allowedApps: Array.isArray(input.networkPolicy?.allowedApps) ? input.networkPolicy.allowedApps.filter((item): item is string => typeof item === "string") : fallback?.networkPolicy.allowedApps || [],
    },
  };
}

function normalize(value: unknown): PlatformSettings {
  const fallback = defaults();
  if (!value || typeof value !== "object") return fallback;
  const input = value as { version?: number; baseDomain?: string; identityDomain?: string; brand?: { colors?: unknown }; apps?: unknown; tunnels?: unknown; routes?: unknown };
  if (input.version !== 2 && input.version !== 3 && input.version !== 4) {
    const legacy = input as { baseDomain?: string; brand?: { colors?: unknown }; apps?: { notes?: { enabled?: boolean; domain?: string; colors?: unknown } } };
    if (legacy.apps?.notes) {
      fallback.baseDomain = legacy.baseDomain || fallback.baseDomain;
      fallback.brand.colors = validPalette(legacy.brand?.colors, fallback.brand.colors);
      fallback.apps.outline.enabled = legacy.apps.notes.enabled ?? fallback.apps.outline.enabled;
      fallback.apps.outline.domain = legacy.apps.notes.domain || fallback.apps.outline.domain;
      fallback.apps.outline.colors = validPalette(legacy.apps.notes.colors, fallback.apps.outline.colors);
      fallback.routes["outline-web"].hostname = appHostname(fallback.apps.outline.domain, fallback.baseDomain);
      fallback.routes["outline-web"].enabled = fallback.apps.outline.enabled;
    }
    return fallback;
  }
  const apps: Record<string, AppInstance> = {};
  if (input.apps && typeof input.apps === "object") {
    for (const [id, app] of Object.entries(input.apps)) {
      const instance = normalizeInstance(app, fallback.apps[id]);
      if (instance) apps[id] = instance;
    }
  }
  const tunnels = { ...fallback.tunnels };
  if ((input.version === 3 || input.version === 4) && input.tunnels && typeof input.tunnels === "object") {
    for (const [id, raw] of Object.entries(input.tunnels)) {
      const tunnel = raw as Partial<TunnelInstance>;
      if (idPattern.test(id) && tunnel.name && tunnel.provider) tunnels[id] = { id, name: tunnel.name, provider: tunnel.provider, enabled: tunnel.enabled !== false, configuration: environmentMap(tunnel.configuration) };
    }
  }
  const routes = { ...fallback.routes };
  if ((input.version === 3 || input.version === 4) && input.routes && typeof input.routes === "object") {
    for (const [id, raw] of Object.entries(input.routes)) {
      const route = raw as Partial<AppRoute>;
      if (idPattern.test(id) && route.appId && route.endpointId && route.hostname && route.tunnelId) routes[id] = { id, appId: route.appId, endpointId: route.endpointId, hostname: route.hostname, path: route.path || "/*", tunnelId: route.tunnelId, enabled: route.enabled !== false };
    }
  } else {
    const outline = apps.outline || fallback.apps.outline;
    routes["outline-web"] = { ...routes["outline-web"], hostname: appHostname(outline.domain, input.baseDomain || fallback.baseDomain), tunnelId: outline.tunnelId || "public", enabled: outline.enabled && Boolean(outline.tunnelId) };
  }
  return { version: 4, baseDomain: input.baseDomain || fallback.baseDomain, identityDomain: input.identityDomain || fallback.identityDomain, meshDomain: fallback.meshDomain, brand: { colors: validPalette(input.brand?.colors, fallback.brand.colors) }, apps: { ...fallback.apps, ...apps }, tunnels, routes };
}

async function persist(settings: PlatformSettings) {
  await mkdir(dirname(settingsPath), { recursive: true, mode: 0o700 });
  const temporary = `${settingsPath}.new`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, settingsPath);
  await publishDesiredState(settings);
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  for (const path of [settingsPath, legacySettingsPath]) {
    try { return normalize(JSON.parse(await readFile(path, "utf8"))); } catch { continue; }
  }
  return defaults();
}

export function appHostname(domain: string, baseDomain: string) {
  const value = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (value === "@") return baseDomain;
  return value.includes(".") ? value : `${value}.${baseDomain}`;
}

/**
 * Whether an exposure can carry traffic. A connector-based provider needs its
 * credentials; one served by the appliance's own proxy needs nothing beyond
 * being switched on, because the address it publishes is the server's own.
 */
export function tunnelIsReady(tunnel: TunnelInstance | undefined): boolean {
  if (!tunnel?.enabled) return false;
  if (!providerRunsConnector(tunnel.provider)) return true;
  return Boolean(tunnel.configuration.TUNNEL_TOKEN || (tunnel.configuration.TUNNEL_ID && tunnel.configuration.CREDENTIALS_FILE));
}

export function tunnelZones(tunnel: TunnelInstance | undefined): CloudflareZone[] {
  try {
    const zones = JSON.parse(tunnel?.configuration.ZONES?.value || "[]") as unknown;
    return Array.isArray(zones) ? zones.filter((zone): zone is CloudflareZone => Boolean(zone && typeof zone === "object" && typeof (zone as CloudflareZone).id === "string" && typeof (zone as CloudflareZone).name === "string")) : [];
  } catch { return []; }
}

export async function installDefinition(definition: AppDefinition) {
  const settings = await getPlatformSettings();
  const id = definition.metadata.id;
  if (!settings.apps[id]) {
    settings.apps[id] = {
      id, definitionId: id, name: definition.metadata.name, enabled: false, domain: definition.metadata.shortName.toLowerCase(),
      colors: definition.metadata.colors, tunnelId: null, environment: {}, networkPolicy: definition.spec.defaultNetworkPolicy,
    };
    await persist(settings);
  }
}

export async function saveAppOverview(definition: AppDefinition, form: FormData) {
  const settings = await getPlatformSettings();
  const current = settings.apps[definition.metadata.id];
  if (!current) throw new Error("Install this app before configuring it");
  const domain = String(form.get("domain") || "").trim().toLowerCase();
  if (!(labelPattern.test(domain) || domainPattern.test(domain))) throw new Error("Enter a short app name or full hostname");
  const colors = [0, 1, 2].map((index) => String(form.get(`color${index}`) || "").toLowerCase());
  if (!colors.every((color) => colorPattern.test(color))) throw new Error("Every flower color must be a six-digit hex value");
  settings.apps[current.id] = { ...current, name: String(form.get("name") || definition.metadata.name).trim(), enabled: form.get("enabled") === "on", domain, colors: colors as unknown as Palette };
  for (const route of Object.values(settings.routes)) {
    if (route.appId === current.id) { route.hostname = appHostname(domain, settings.baseDomain); route.enabled = settings.apps[current.id].enabled && Boolean(current.tunnelId); }
  }
  await persist(settings);
}

export async function saveAppSetup(definition: AppDefinition, form: FormData) {
  const settings = await getPlatformSettings();
  const current = settings.apps[definition.metadata.id];
  if (!current) throw new Error("Install this app before configuring it");
  const colors = [0, 1, 2].map((index) => String(form.get(`color${index}`) || "").toLowerCase());
  if (!colors.every((color) => colorPattern.test(color))) throw new Error("Every flower color must be a six-digit hex value");
  const tunnelValue = String(form.get("tunnelId") || "none");
  const tunnelId = tunnelValue === "none" ? null : tunnelValue;
  const tunnel = tunnelId ? settings.tunnels[tunnelId] : undefined;
  if (tunnelId && !tunnel) throw new Error("Select an existing tunnel");

  let domain = current.domain;
  const zones = tunnel?.provider === "cloudflare" ? tunnelZones(tunnel) : [];
  if (tunnel && zones.length) {
    const zone = String(form.get(`zone.${tunnel.id}`) || "");
    const subdomain = String(form.get(`subdomain.${tunnel.id}`) || "").trim().toLowerCase();
    if (!zones.some((candidate) => candidate.name === zone)) throw new Error("Select a domain authorized for this Cloudflare tunnel");
    if (subdomain !== "@" && !labelPattern.test(subdomain)) throw new Error("Subdomain must be one DNS label, or @ for the root domain");
    domain = subdomain === "@" ? zone : `${subdomain}.${zone}`;
  } else if (tunnel) {
    domain = String(form.get(`domain.${tunnel?.id || "none"}`) || current.domain).trim().toLowerCase();
    if (!(labelPattern.test(domain) || domainPattern.test(domain))) throw new Error("Enter a short app name or complete hostname");
  } else {
    domain = definition.metadata.shortName.toLowerCase();
  }

  const enabled = form.get("enabled") === "on";
  settings.apps[current.id] = {
    ...current,
    name: String(form.get("name") || definition.metadata.name).trim(),
    enabled,
    domain,
    colors: colors as unknown as Palette,
    tunnelId,
    networkPolicy: { ...current.networkPolicy, internetAccess: form.get("internetAccess") === "on" },
  };
  const endpoint = definition.spec.services.flatMap((service) => service.endpoint ? [service.endpoint] : [])[0];
  const routeId = `${current.id}-${endpoint?.id || "web"}`;
  if (endpoint && tunnelId) settings.routes[routeId] = { id: routeId, appId: current.id, endpointId: endpoint.id, hostname: appHostname(domain, settings.baseDomain), path: "/*", tunnelId, enabled };
  else if (settings.routes[routeId]) settings.routes[routeId].enabled = false;
  await persist(settings);
}

export async function saveAppEnvironment(definition: AppDefinition, form: FormData) {
  const settings = await getPlatformSettings();
  const current = settings.apps[definition.metadata.id];
  if (!current) throw new Error("Install this app before configuring it");
  // Each form posts one target, so saving app settings never disturbs the
  // environment view's answers, and an unticked box still means "off".
  const target = String(form.get("target") || "environment") === "settings" ? "settings" : "environment";
  const environment = { ...current.environment };
  for (const field of definition.spec.configuration) {
    if ((field.target || "environment") !== target) continue;
    if (field.kind === "toggle") {
      const value = form.get(`env.${field.key}`) === null ? "off" : "on";
      if (value === (field.default || "off")) delete environment[field.key];
      else environment[field.key] = { value, secret: false };
      continue;
    }
    const submitted = form.get(`env.${field.key}`);
    if (submitted === null || field.kind === "secret" && submitted === "") continue;
    const value = String(submitted);
    if (value === "" || value === field.default) delete environment[field.key];
    else environment[field.key] = { value, secret: field.kind === "secret" };
  }
  settings.apps[current.id] = { ...current, environment };
  await persist(settings);
}

export async function saveAppNetwork(definition: AppDefinition, form: FormData) {
  const settings = await getPlatformSettings();
  const current = settings.apps[definition.metadata.id];
  if (!current) throw new Error("Install this app before configuring it");
  const tunnelValue = String(form.get("tunnelId") || "none");
  const tunnelId = tunnelValue === "none" ? null : tunnelValue;
  if (tunnelId && !settings.tunnels[tunnelId]) throw new Error("Select an existing tunnel");
  let domain = current.domain;
  const tunnel = tunnelId ? settings.tunnels[tunnelId] : undefined;
  const zones = tunnel?.provider === "cloudflare" ? tunnelZones(tunnel) : [];
  if (tunnel && zones.length) {
    const zone = String(form.get(`zone.${tunnel.id}`) || "");
    const subdomain = String(form.get(`subdomain.${tunnel.id}`) || "").trim().toLowerCase();
    if (!zones.some((candidate) => candidate.name === zone)) throw new Error("Select a domain authorized for this Cloudflare tunnel");
    if (subdomain !== "@" && !labelPattern.test(subdomain)) throw new Error("Subdomain must be one DNS label, or @ for the root domain");
    domain = subdomain === "@" ? zone : `${subdomain}.${zone}`;
  }
  settings.apps[current.id] = { ...current, domain, tunnelId, networkPolicy: { ...current.networkPolicy, internetAccess: form.get("internetAccess") === "on" } };
  const endpoint = definition.spec.services.flatMap((service) => service.endpoint ? [service.endpoint] : [])[0];
  const routeId = `${current.id}-${endpoint?.id || "web"}`;
  if (endpoint && tunnelId) settings.routes[routeId] = { id: routeId, appId: current.id, endpointId: endpoint.id, hostname: appHostname(domain, settings.baseDomain), path: "/*", tunnelId, enabled: current.enabled };
  else if (settings.routes[routeId]) settings.routes[routeId].enabled = false;
  await persist(settings);
}

/**
 * Creates an exposure served by the appliance itself. There is nothing to
 * authenticate, so it is ready the moment it exists.
 */
export async function createDirectTunnel(name: string) {
  const settings = await getPlatformSettings();
  const label = name.trim() || "Direct";
  let id = "direct";
  for (let suffix = 2; settings.tunnels[id]; suffix += 1) id = `direct-${suffix}`;
  settings.tunnels[id] = { id, name: label, provider: "direct", enabled: true, configuration: {} };
  await persist(settings);
  return id;
}

export async function saveTunnel(form: FormData) {
  const settings = await getPlatformSettings();
  const id = String(form.get("id") || "").trim().toLowerCase();
  const name = String(form.get("name") || "").trim();
  const provider = String(form.get("provider") || "").trim().toLowerCase();
  if (!idPattern.test(id)) throw new Error("Tunnel ID must be a lowercase slug");
  if (!name || !provider) throw new Error("Tunnel name and provider are required");
  if (!getTunnelProvider(provider)) throw new Error(`Tunnel provider ${provider} is not installed`);
  const previous = settings.tunnels[id];
  const configuration = { ...previous?.configuration };
  for (const [key, secret] of [["TUNNEL_ID", false], ["CREDENTIALS_FILE", false], ["TUNNEL_TOKEN", true]] as const) {
    const value = String(form.get(key) || "").trim();
    if (!value && secret && configuration[key]) continue;
    if (value) configuration[key] = { value, secret };
    else delete configuration[key];
  }
  // A provider with no connector has nothing to authenticate: it publishes on
  // the server's own address, so demanding tunnel credentials would make it
  // impossible to save.
  if (providerRunsConnector(provider) && !configuration.TUNNEL_TOKEN && !(configuration.TUNNEL_ID && configuration.CREDENTIALS_FILE)) {
    throw new Error("Provide a tunnel token, or a tunnel ID and credentials file");
  }
  settings.tunnels[id] = { id, name, provider, enabled: form.get("enabled") === "on", configuration };
  await persist(settings);
}

export async function connectCloudflareTunnel(form: FormData) {
  const settings = await getPlatformSettings();
  const id = String(form.get("id") || "public").trim().toLowerCase();
  const name = String(form.get("name") || "Public Cloudflare").trim();
  if (!idPattern.test(id)) throw new Error("Tunnel ID must be a lowercase slug");
  if (!name) throw new Error("Give this connection a name");
  const parsed = parseCloudflareTunnelToken(String(form.get("tokenInput") || ""));
  const previous = settings.tunnels[id];
  const configuration: Record<string, EnvironmentOverride> = {
    ...previous?.configuration,
    TUNNEL_TOKEN: { value: parsed.token, secret: true },
    AUTH_MODE: { value: "remote-token", secret: false },
  };
  delete configuration.ACCOUNT_ID;
  delete configuration.TUNNEL_ID;
  if (parsed.accountId) configuration.ACCOUNT_ID = { value: parsed.accountId, secret: false };
  if (parsed.tunnelId) configuration.TUNNEL_ID = { value: parsed.tunnelId, secret: false };
  delete configuration.CREDENTIALS_FILE;
  settings.tunnels[id] = { id, name, provider: "cloudflare", enabled: true, configuration };
  await persist(settings);
}

export async function provisionLocalCloudflareTunnel(input: {
  localId: string;
  name: string;
  domain: string;
  accountId?: string;
  tunnelId: string;
  credentialsFile: string;
  originCertificate: string;
}) {
  if (!idPattern.test(input.localId)) throw new Error("Tunnel ID must be a lowercase slug");
  const settings = await getPlatformSettings();
  if (settings.tunnels[input.localId]?.configuration.TUNNEL_TOKEN) throw new Error("A connected tunnel already uses that connection ID");
  settings.tunnels[input.localId] = {
    id: input.localId,
    name: input.name,
    provider: "cloudflare",
    enabled: true,
    configuration: {
      AUTH_MODE: { value: "cloudflared-login", secret: false },
      ...(input.accountId ? { ACCOUNT_ID: { value: input.accountId, secret: false } } : {}),
      ACCOUNT_NAME: { value: input.domain, secret: false },
      TUNNEL_ID: { value: input.tunnelId, secret: false },
      CREDENTIALS_FILE: { value: input.credentialsFile, secret: true },
      ORIGIN_CERTIFICATE: { value: input.originCertificate, secret: true },
      ZONES: { value: JSON.stringify([{ id: input.domain, name: input.domain }]), secret: false },
    },
  };
  await persist(settings);
}

export async function disconnectTunnel(id: string) {
  const settings = await getPlatformSettings();
  const tunnel = settings.tunnels[id];
  if (!tunnel) throw new Error("Tunnel does not exist");
  settings.tunnels[id] = { ...tunnel, enabled: false, configuration: {} };
  for (const route of Object.values(settings.routes)) if (route.tunnelId === id) route.enabled = false;
  await persist(settings);
}

export async function saveRoute(form: FormData) {
  const settings = await getPlatformSettings();
  const id = String(form.get("id") || "").trim().toLowerCase();
  const endpointReference = String(form.get("endpoint") || "").trim();
  const [selectedAppId, selectedEndpointId] = endpointReference.includes(":") ? endpointReference.split(":", 2) : ["", ""];
  const appId = selectedAppId || String(form.get("appId") || "").trim();
  const endpointId = selectedEndpointId || String(form.get("endpointId") || "").trim();
  const hostname = String(form.get("hostname") || "").trim().toLowerCase();
  const path = String(form.get("path") || "/*").trim();
  const tunnelId = String(form.get("tunnelId") || "").trim();
  if (!idPattern.test(id)) throw new Error("Route ID must be a lowercase slug");
  if (!settings.apps[appId]) throw new Error("Select an installed application");
  if (!endpointId) throw new Error("Select an application endpoint");
  if (!domainPattern.test(hostname) || hostname === "@") throw new Error("Enter a complete route hostname");
  if (!path.startsWith("/")) throw new Error("Route path must start with /");
  if (!settings.tunnels[tunnelId]) throw new Error("Select an existing tunnel");
  settings.routes[id] = { id, appId, endpointId, hostname, path, tunnelId, enabled: form.get("enabled") === "on" };
  await persist(settings);
}

export async function savePlatformBrand(form: FormData) {
  const settings = await getPlatformSettings();
  const baseDomain = String(form.get("baseDomain") || "").trim().toLowerCase();
  if (!domainPattern.test(baseDomain) || baseDomain === "@") throw new Error("Enter a valid base domain");
  const colors = [0, 1, 2].map((index) => String(form.get(`color${index}`) || "").toLowerCase());
  if (!colors.every((color) => colorPattern.test(color))) throw new Error("Every flower color must be a six-digit hex value");
  settings.baseDomain = baseDomain;
  settings.brand.colors = colors as unknown as Palette;
  if (settings.apps["kimono-portal"]) settings.apps["kimono-portal"].colors = colors as unknown as Palette;
  await persist(settings);
}
