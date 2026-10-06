import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Palette } from "./settings";
import type { GlyphName } from "@kimono/ui";
import { apiConfiguration, validateApiCollection, type ToolApi } from "./tool-apis/catalog";
import { validateApiAdapters } from "./tool-apis/adapters";

export type ConfigurationField = {
  key: string;
  label: string;
  kind: "text" | "number" | "bytes" | "email" | "secret" | "select" | "toggle";
  group: "general" | "storage" | "email" | "diagnostics" | string;
  /**
   * Where the administrator's answer lands. Environment fields become variables
   * on the app's routed service; settings fields are written into the settings
   * document the app reads instead.
   */
  target?: "environment" | "settings";
  default?: string;
  description?: string;
  options?: string[];
  advanced?: boolean;
};

/**
 * Apps that keep their own configuration in a file rather than the environment.
 * Kimono renders the document beside the Compose project and mounts it read-only,
 * so the Admin portal stays the one place a household changes an app.
 */
export type SettingsFile = { service: string; path: string; document: unknown };

export type BackupSource = {
  id: string;
  label: string;
  description: string;
  enabledByDefault: boolean;
  method: "files" | "postgres" | "sqlite" | "settings";
  volume?: string;
  service?: string;
  paths?: string[];
  exclude?: string[];
  database?: string;
  username?: string;
};

/**
 * How a connected app receives single sign-on. Outline reads OIDC settings from
 * its environment; other apps expect a configuration file, and every app owns
 * the paths its identity provider is allowed to return to.
 */
export type IdentityIntegration = {
  /** Redirect URIs registered with the provider. `{{hostname}}` is resolved. */
  redirectUris: string[];
  /** Where the app expects its provider: its environment, or its settings document. */
  delivery?: "environment" | "settings";
  /** Replaces Kimono's default OIDC_* variables when the app names them differently. */
  environment?: Record<string, string>;
};

export type AppDefinition = {
  apiVersion: "apps.kimono.dev/v1alpha1";
  kind: "AppDefinition";
  metadata: {
    id: string;
    name: string;
    shortName: string;
    description: string;
    category: string;
    version: string;
    icon: string;
    glyph?: GlyphName;
    colors: Palette;
  };
  spec: {
    integration: "native" | "headless" | "fork" | "connected" | "hosted";
    /** Native apps use the same configuration system, with an internal destination. */
    portalPath?: string;
    /** False while the app configuration contract is still being implemented. */
    setupReady?: boolean;
    mobileApp?: { name: string; guideUrl: string; steps: string[] };
    apiCollection?: ToolApi[];
    services: Array<{
      id: string;
      image: string;
      internal?: boolean;
      dependsOn?: string[];
      endpoint?: { id: string; port: number; protocol: "http" | "https" | "tcp" };
      environment?: Record<string, string>;
    }>;
    volumes: Array<{ id: string; service: string; path: string; backup: boolean; backupLabel?: string; backupDescription?: string }>;
    backups?: BackupSource[];
    identity?: IdentityIntegration;
    settingsFile?: SettingsFile;
    /** Work the upstream application deliberately leaves to its own UI or tooling. */
    manualSetup?: {
      title: string;
      description: string;
      steps: string[];
    };
    configuration: ConfigurationField[];
    managedEnvironment: string[];
    defaultNetworkPolicy: { internetAccess: boolean; allowedApps: string[] };
  };
  source: "embedded" | "filesystem";
  iconUrl: string;
  iconPath: string;
};

export type DefinitionScan = { definitions: AppDefinition[]; errors: string[] };

const idPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const colorPattern = /^#[0-9a-f]{6}$/i;
const embeddedRoot = process.env.NODE_ENV === "production"
  ? "/usr/share/kimono/app-definitions"
  : join(process.cwd(), "app-definitions");
const filesystemRoot = "/etc/kimono/app-definitions";

function parseDefinition(value: unknown, directory: string, source: AppDefinition["source"]): AppDefinition {
  if (!value || typeof value !== "object") throw new Error("manifest must be an object");
  const definition = value as Omit<AppDefinition, "source" | "iconUrl" | "iconPath">;
  if (definition.apiVersion !== "apps.kimono.dev/v1alpha1" || definition.kind !== "AppDefinition") throw new Error("unsupported apiVersion or kind");
  if (!idPattern.test(definition.metadata?.id || "")) throw new Error("metadata.id must be a lowercase slug");
  if (!definition.metadata.name || !definition.metadata.shortName || !definition.metadata.description) throw new Error("name, shortName, and description are required");
  if (!Array.isArray(definition.metadata.colors) || definition.metadata.colors.length !== 3 || !definition.metadata.colors.every((color) => colorPattern.test(color))) throw new Error("metadata.colors must contain three hex colors");
  if (basename(definition.metadata.icon) !== definition.metadata.icon || !definition.metadata.icon.endsWith(".svg")) throw new Error("metadata.icon must name an SVG in the definition directory");
  if (!Array.isArray(definition.spec?.services) || !Array.isArray(definition.spec?.configuration)) throw new Error("spec.services and spec.configuration are required");
  if (definition.spec.setupReady !== undefined && typeof definition.spec.setupReady !== "boolean") throw new Error("spec.setupReady must be a boolean");
  if (definition.spec.mobileApp !== undefined) {
    const mobile = definition.spec.mobileApp;
    if (!mobile || typeof mobile.name !== "string" || !mobile.name.trim() || typeof mobile.guideUrl !== "string" || !/^https:\/\//.test(mobile.guideUrl) || !Array.isArray(mobile.steps) || !mobile.steps.length || !mobile.steps.every((step) => typeof step === "string" && step.trim())) throw new Error("spec.mobileApp requires a name, HTTPS guide URL, and tutorial steps");
  }
  if (definition.spec.apiCollection !== undefined) {
    validateApiCollection(definition.spec.apiCollection);
    validateApiAdapters(definition.spec.apiCollection);
    const generated = apiConfiguration(definition.spec.apiCollection);
    if (generated.some((field) => definition.spec.configuration.some((existing) => existing.key === field.key))) throw new Error("API configuration keys conflict with app configuration");
    definition.spec.configuration = [...definition.spec.configuration, ...generated];
  }
  if (definition.spec.portalPath !== undefined && (definition.spec.integration !== "native" || !/^\/(?!\/)[a-z0-9/-]+$/.test(definition.spec.portalPath))) throw new Error("spec.portalPath must be an internal native app path");
  if (definition.spec.integration === "connected") validateIdentity(definition.spec.identity);
  validateManualSetup(definition.spec.manualSetup);
  if (!Array.isArray(definition.spec.volumes)) throw new Error("spec.volumes is required");
  const volumeIds = new Set<string>();
  for (const volume of definition.spec.volumes) {
    if (!idPattern.test(volume.id) || volumeIds.has(volume.id)) throw new Error("volume IDs must be unique lowercase slugs");
    volumeIds.add(volume.id);
    if (!definition.spec.services.some((service) => service.id === volume.service)) throw new Error(`volume ${volume.id} names an unknown service`);
    if (typeof volume.backup !== "boolean") throw new Error(`volume ${volume.id} must explicitly declare backup true or false`);
    for (const value of [volume.backupLabel, volume.backupDescription]) {
      if (value !== undefined && (typeof value !== "string" || !value.trim() || value.length > 1000)) throw new Error(`volume ${volume.id} has invalid backup text`);
    }
  }
  validateSettings(definition.spec.settingsFile, definition.spec.configuration, definition.spec.services);
  validateBackups(definition);
  const iconPath = join(directory, definition.metadata.icon);
  return { ...definition, source, iconPath, iconUrl: `/api/app-definitions/${definition.metadata.id}/icon` };
}

function validateBackups(definition: Omit<AppDefinition, "source" | "iconUrl" | "iconPath">) {
  const sources = definition.spec.backups;
  if (sources === undefined) return;
  if (!Array.isArray(sources)) throw new Error("spec.backups must be an array");
  const ids = new Set<string>();
  for (const source of sources) {
    if (!idPattern.test(source.id) || ids.has(source.id)) throw new Error("backup IDs must be unique lowercase slugs");
    ids.add(source.id);
    if (!source.label?.trim() || !source.description?.trim() || typeof source.enabledByDefault !== "boolean") throw new Error(`backup ${source.id} needs a label, description and default`);
    if (!["files", "postgres", "sqlite", "settings"].includes(source.method)) throw new Error(`backup ${source.id} has an unsupported method`);
    if (source.method === "files" || source.method === "sqlite") {
      if (!definition.spec.volumes.some((volume) => volume.id === source.volume)) throw new Error(`backup ${source.id} names an unknown volume`);
      if (!source.paths?.length || (source.method === "sqlite" && source.paths.length !== 1)) throw new Error(`backup ${source.id} needs source paths`);
      for (const path of [...source.paths, ...(source.exclude || [])]) {
        if (typeof path !== "string" || !/^[a-zA-Z0-9_./*-]+$/.test(path) || path.startsWith("/") || path.startsWith("-") || path.split("/").includes("..")) throw new Error(`backup ${source.id} paths must stay inside their volume`);
      }
    }
    if (source.method === "postgres" && (!definition.spec.services.some((service) => service.id === source.service) || !/^[a-zA-Z0-9_]+$/.test(source.database || "") || !/^[a-zA-Z0-9_]+$/.test(source.username || ""))) throw new Error(`backup ${source.id} needs a database service, database and username`);
    if (source.method === "settings" && !definition.spec.settingsFile) throw new Error(`backup ${source.id} needs spec.settingsFile`);
  }
}

function validateManualSetup(manualSetup: AppDefinition["spec"]["manualSetup"]) {
  if (!manualSetup) return;
  if (!manualSetup.title?.trim() || !manualSetup.description?.trim()) throw new Error("spec.manualSetup requires a title and description");
  if (!Array.isArray(manualSetup.steps) || manualSetup.steps.length === 0 || !manualSetup.steps.every((step) => typeof step === "string" && step.trim())) {
    throw new Error("spec.manualSetup.steps must contain non-empty strings");
  }
}

/**
 * A connected app is only as safe as the redirect URIs Kimono registers for it,
 * so they are declared rather than guessed from the integration kind.
 */
function validateIdentity(identity: IdentityIntegration | undefined) {
  if (!identity || !Array.isArray(identity.redirectUris) || identity.redirectUris.length === 0) throw new Error("a connected app must declare spec.identity.redirectUris");
  if (!identity.redirectUris.every((uri) => typeof uri === "string" && uri.trim().length > 0)) throw new Error("spec.identity.redirectUris must contain non-empty strings");
  if (identity.environment && Object.keys(identity.environment).some((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) throw new Error("spec.identity.environment names must be environment variables");
  if (identity.delivery && identity.delivery !== "environment" && identity.delivery !== "settings") throw new Error("spec.identity.delivery must be environment or settings");
}

/**
 * A settings document only makes sense with somewhere to mount it, and a field
 * that targets one would silently vanish without it.
 */
function validateSettings(file: SettingsFile | undefined, configuration: ConfigurationField[], services: AppDefinition["spec"]["services"]) {
  const targeted = configuration.filter((field) => field.target === "settings");
  if (!file) {
    if (targeted.length) throw new Error(`${targeted[0].key} targets settings, but spec.settingsFile is missing`);
    return;
  }
  if (!services.some((service) => service.id === file.service)) throw new Error(`spec.settingsFile names unknown service ${file.service}`);
  if (typeof file.path !== "string" || !file.path.startsWith("/") || file.path.includes("..") || file.path.includes(":")) throw new Error("spec.settingsFile.path must be an absolute container path");
  if (!file.document || typeof file.document !== "object") throw new Error("spec.settingsFile.document must be an object");
  for (const field of configuration) {
    if (field.kind === "toggle" && field.default && field.default !== "on" && field.default !== "off") throw new Error(`${field.key} is a toggle, so its default must be on or off`);
  }
}

async function scanRoot(root: string, source: AppDefinition["source"], errors: string[]) {
  const definitions: AppDefinition[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (source === "filesystem" && (error as NodeJS.ErrnoException).code === "ENOENT") return definitions;
    errors.push(`${source}: ${error instanceof Error ? error.message : "could not read definition directory"}`);
    return definitions;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    try {
      const manifest = await readFile(join(directory, "app.json"), "utf8");
      if (manifest.length > 1024 * 1024) throw new Error("app.json is larger than 1 MiB");
      const definition = parseDefinition(JSON.parse(manifest), directory, source);
      const icon = await readFile(definition.iconPath, "utf8");
      if (icon.length > 256 * 1024 || !/^\s*<svg[\s>]/i.test(icon)) throw new Error("icon is not a valid SVG file");
      if (/<(?:script|foreignObject|iframe|object|embed)\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["'](?!#)/i.test(icon)) throw new Error("icon.svg must be a self-contained glyph without scripts, event handlers, or external references");
      definitions.push(definition);
    } catch (error) {
      errors.push(`${source}/${entry.name}: ${error instanceof Error ? error.message : "invalid definition"}`);
    }
  }
  return definitions;
}

export async function scanAppDefinitions(): Promise<DefinitionScan> {
  const errors: string[] = [];
  const embedded = await scanRoot(embeddedRoot, "embedded", errors);
  const filesystem = await scanRoot(filesystemRoot, "filesystem", errors);
  const layered = new Map(embedded.map((definition) => [definition.metadata.id, definition]));
  for (const definition of filesystem) layered.set(definition.metadata.id, definition);
  return { definitions: [...layered.values()].sort((left, right) => left.metadata.name.localeCompare(right.metadata.name)), errors };
}

export async function getAppDefinition(id: string) {
  const { definitions } = await scanAppDefinitions();
  return definitions.find((definition) => definition.metadata.id === id);
}
