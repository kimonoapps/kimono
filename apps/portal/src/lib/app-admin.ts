import "server-only";

import { accentOf, appRegistry } from "./apps";
import { appBackupSelection, readBackupConfig, saveAppBackups } from "./backups";
import { backupCatalog } from "./backup-catalog";
import { getAppDefinition, scanAppDefinitions, type AppDefinition } from "./definitions";
import { configureDefinition, getPlatformSettings, saveAppEnvironment, saveAppSetup, tunnelIsReady, tunnelZones } from "./settings";

/*
 * 管 Managing an app, for the phone: the same views and the same saves as the
 * website's /admin/apps/[id] (Setup, Settings, Advanced, Backups). Answers are
 * plain JSON; changes are turned into the form the website posts and saved by
 * the very same functions, so the two can never disagree about what an app is.
 * The Portal itself and Kimono's built-in apps are managed on the website.
 */

export type AppSummary = { id: string; name: string; description: string; accent: string; glyph: string | null; icon: string | null; state: string; stateLabel: string; stateDetail: string };

export async function managedApps(): Promise<AppSummary[]> {
  const [settings, scan] = await Promise.all([getPlatformSettings(), scanAppDefinitions()]);
  /* The apps the website manages on /admin/apps/[id]; Kimono VPN keeps its own page there. */
  return appRegistry(settings, scan.definitions).filter((app) => app.catalogHref === `/admin/apps/${app.id}`).map((app) => ({
    id: app.id, name: app.name, description: app.description, accent: app.accent, glyph: app.glyph ?? null, icon: app.iconUrl || null,
    state: app.state, stateLabel: app.stateLabel, stateDetail: app.stateDetail,
  }));
}

/* An app set up under its own id is found through the definition it was made from. */
async function definitionFor(id: string): Promise<AppDefinition> {
  if (id === "kimono-portal") throw new Error("Manage Kimono itself on the website.");
  const settings = await getPlatformSettings();
  const definition = await getAppDefinition(settings.apps[id]?.definitionId ?? id);
  if (!definition) throw new Error("There's no app by that name.");
  return definition;
}

/* The saves key an app by its definition, so one set up under another id can be read here but not changed. */
async function changeableDefinition(id: string): Promise<AppDefinition> {
  const definition = await definitionFor(id);
  if (definition.metadata.id !== id) throw new Error("This app can't be changed from here yet.");
  return definition;
}

const fieldOut = (environment: Record<string, { value: string; secret: boolean }>) => (field: AppDefinition["spec"]["configuration"][number]) => {
  const saved = environment[field.key];
  return {
    key: field.key, label: field.label, group: field.group, kind: field.kind, description: field.description ?? null, options: field.options ?? [],
    /* A secret's value never leaves the server: only whether one is set. */
    value: field.kind === "secret" ? "" : saved?.value ?? field.default ?? "",
    configured: Boolean(saved), placeholder: field.kind === "secret" ? null : field.default ?? null,
  };
};

export async function managedApp(id: string) {
  const definition = await definitionFor(id);
  const [settings, scan, backupConfig] = await Promise.all([getPlatformSettings(), scanAppDefinitions(), readBackupConfig()]);
  const instance = settings.apps[id];
  const registered = appRegistry(settings, scan.definitions).find((app) => app.id === id);
  const base = {
    id, name: instance?.name || definition.metadata.name, description: definition.metadata.description,
    accent: accentOf(instance?.colors || definition.metadata.colors), glyph: definition.metadata.glyph ?? null, icon: definition.iconUrl || null,
    state: registered?.state ?? "available", stateLabel: registered?.stateLabel ?? "Available", stateDetail: registered?.stateDetail ?? "Not configured",
    setupReady: definition.spec.setupReady !== false, configured: Boolean(instance),
  };
  if (!instance) return { ...base, setup: null, settings: [], environment: [], backups: null };
  const builtIn = Boolean(definition.spec.portalPath);
  const tunnels = builtIn ? [] : Object.values(settings.tunnels).filter((tunnel) => tunnelIsReady(tunnel)).map((tunnel) => {
    const zones = tunnelZones(tunnel).map((zone) => zone.name);
    const zone = zones.toSorted((a, b) => b.length - a.length).find((name) => instance.domain === name || instance.domain.endsWith(`.${name}`));
    return {
      id: tunnel.id, name: tunnel.name, detail: tunnel.configuration.ACCOUNT_NAME?.value || tunnel.provider, zones,
      zone: zone ?? zones[0] ?? null,
      subdomain: zone ? instance.domain === zone ? "@" : instance.domain.slice(0, -(zone.length + 1)) : definition.metadata.shortName.toLowerCase(),
      domain: instance.domain,
    };
  });
  const fields = definition.spec.configuration.map(fieldOut(instance.environment));
  const backup = appBackupSelection(backupConfig, backupCatalog(settings, [definition]), id);
  return {
    ...base,
    setup: {
      enabled: instance.enabled, name: instance.name, builtIn,
      tunnelId: tunnels.some((tunnel) => tunnel.id === instance.tunnelId) ? instance.tunnelId : null, tunnels,
      internetAccess: instance.networkPolicy.internetAccess,
    },
    settings: fields.filter((_, index) => definition.spec.configuration[index].target === "settings"),
    environment: fields.filter((_, index) => definition.spec.configuration[index].target !== "settings"),
    backups: {
      storage: Boolean(backupConfig), enabled: backup.enabled,
      items: backup.items.map((item) => ({ id: item.id, label: item.label, description: item.description ?? "", kept: backupConfig?.items[item.id] ?? item.enabledByDefault })),
    },
  };
}

export async function startApp(id: string) {
  await configureDefinition(await changeableDefinition(id));
}

type Change =
  | { section: "setup"; enabled?: boolean; name?: string; tunnelId?: string | null; subdomain?: string; zone?: string; domain?: string; internetAccess?: boolean }
  | { section: "settings" | "environment"; values: Record<string, string | boolean> }
  | { section: "backups"; enabled?: boolean; items?: Record<string, boolean> };

/** Saves one view's answers, as the website's form for that view would post them. */
export async function changeApp(id: string, change: Change) {
  const definition = await changeableDefinition(id);
  const settings = await getPlatformSettings();
  const instance = settings.apps[id];
  if (!instance) throw new Error("Start setup first.");
  const form = new FormData();
  if (change.section === "setup") {
    const on = (value: boolean | undefined, fallback: boolean) => (value ?? fallback) ? "on" : "";
    if (on(change.enabled, instance.enabled)) form.set("enabled", "on");
    form.set("name", change.name ?? instance.name);
    instance.colors.forEach((colour, index) => form.set(`color${index}`, colour));
    const tunnelId = change.tunnelId === undefined ? instance.tunnelId : change.tunnelId;
    form.set("tunnelId", tunnelId ?? "none");
    if (tunnelId) {
      if (change.zone !== undefined) form.set(`zone.${tunnelId}`, change.zone);
      if (change.subdomain !== undefined) form.set(`subdomain.${tunnelId}`, change.subdomain);
      form.set(`domain.${tunnelId}`, change.domain ?? instance.domain);
    }
    if (on(change.internetAccess, instance.networkPolicy.internetAccess)) form.set("internetAccess", "on");
    await saveAppSetup(definition, form);
  } else if (change.section === "settings" || change.section === "environment") {
    const target = change.section;
    form.set("target", target);
    for (const field of definition.spec.configuration) {
      if ((field.target || "environment") !== target) continue;
      const given = change.values[field.key];
      if (field.kind === "toggle") {
        /* An untouched switch keeps its state; the website's form always posts every box. */
        const current = (instance.environment[field.key]?.value ?? field.default ?? "off") === "on";
        if (given === undefined ? current : given === true || given === "on") form.set(`env.${field.key}`, "on");
      } else if (given !== undefined) form.set(`env.${field.key}`, String(given));
    }
    await saveAppEnvironment(definition, form);
  } else if (change.section === "backups") {
    const config = await readBackupConfig();
    const backup = appBackupSelection(config, backupCatalog(settings, [definition]), id);
    if (change.enabled ?? backup.enabled) form.set("enabled", "on");
    for (const item of backup.items) if (change.items?.[item.id] ?? config?.items[item.id] ?? item.enabledByDefault) form.set(`item.${item.id}`, "on");
    await saveAppBackups(id, form);
  }
}
