import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Palette } from "./settings";

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
    colors: Palette;
  };
  spec: {
    integration: "native" | "headless" | "fork" | "connected";
    services: Array<{
      id: string;
      image: string;
      internal?: boolean;
      dependsOn?: string[];
      endpoint?: { id: string; port: number; protocol: "http" | "https" | "tcp" };
      environment?: Record<string, string>;
    }>;
    volumes: Array<{ id: string; service: string; path: string; backup: boolean }>;
    identity?: IdentityIntegration;
    settingsFile?: SettingsFile;
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
  if (definition.spec.integration === "connected") validateIdentity(definition.spec.identity);
  validateSettings(definition.spec.settingsFile, definition.spec.configuration, definition.spec.services);
  const iconPath = join(directory, definition.metadata.icon);
  return { ...definition, source, iconPath, iconUrl: `/api/app-definitions/${definition.metadata.id}/icon` };
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
