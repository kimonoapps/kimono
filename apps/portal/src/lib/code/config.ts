import type { AppIdentity } from "@kimono/ui";
import { accentOf } from "../apps";
import { getAppDefinition } from "../definitions";
import { appHostname, type PlatformSettings } from "../settings";

export const codeAppId = "kimono-code";

const whole = (raw: string, fallback: number, max: number, min = 1) => {
  const n = raw === "" ? fallback : Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

/** Dollars, to the cent. */
const money = (raw: string, fallback: number, max: number) => {
  const n = raw === "" ? fallback : Number(raw);
  return Number.isFinite(n) ? Math.round(Math.min(Math.max(n, 0), max) * 100) / 100 : fallback;
};

const percent = (raw: string, fallback: number) => {
  const n = raw === "" ? fallback : Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) / 100 : fallback / 100;
};

/** Code as the Applications admin sets it up: the sandbox node, and the two tokens the node uses on the agent's behalf. */
export function codeConfig(settings: PlatformSettings) {
  const instance = settings.apps[codeAppId];
  const value = (key: string) => instance?.environment[key]?.value?.trim() || "";
  const forgejo = Object.values(settings.apps).find((app) => app.definitionId === "forgejo" && app.enabled);
  const gitAddress = (value("git_address") || (forgejo ? `https://${appHostname(forgejo.domain, settings.baseDomain)}` : "")).replace(/\/+$/, "");
  /* Kimono's own Kimono Git, which Kimono AI gets a token from itself when nobody entered one. */
  const gitApp = forgejo && !value("git_address") ? forgejo.id : "";
  return {
    enabled: Boolean(instance?.enabled),
    nodeAddress: value("node_address").replace(/\/+$/, ""),
    nodeKey: value("node_key"),
    /* Whether a chat's or an artifact's link opens for someone not signed in (lib/code/sharing.ts). */
    publicLinks: (instance?.environment["public_links"]?.value?.trim() || "on") === "on",
    gitToken: value("git_token"),
    modelToken: value("model_token"),
    /* Composio's Tool Router: one session per person, its MCP reached through the node's gateway. Optional. */
    composioKey: value("composio_api_key"),
    /* OpenRouter, for speaking a message instead of typing it (api/v1/code/dictation, gpt-transcribe). Optional. */
    openrouterKey: value("openrouter_api_key") || process.env.OPENROUTER_API_KEY?.trim() || "",
    /* What each person may spend a month on paid tools (Composio's Instant), in US dollars; 0 is none (lib/code/media.ts). */
    mediaBudget: money(value("media_budget"), 20, 10_000),
    gitAddress,
    gitApp,
    /* Each person's share of the Claude plan, as fractions; the owner isn't limited. */
    shares: { week: percent(value("share_week"), 20), fiveHour: percent(value("share_five_hour"), 75) },
    /* What each task's sandbox may use, and how many may be awake at once; the node enforces them. */
    limits: {
      cpus: whole(value("sandbox_cpus"), 1, 64, 0.25),
      memoryMb: Math.round(whole(value("sandbox_memory_gb"), 2, 256, 0.25) * 1024),
      awakePerPerson: Math.round(whole(value("awake_per_person"), 6, 100)),
      awakePerNode: Math.round(whole(value("awake_per_node"), 12, 200)),
      diskGb: Math.round(whole(value("sandbox_disk_gb"), 10, 4096)),
    },
    colors: instance?.colors,
  };
}

export type CodeConfig = ReturnType<typeof codeConfig>;

/** What still stands between this server and a working Code, in the admin's words. */
export function missing(config: CodeConfig): string | null {
  if (!config.nodeAddress || !config.nodeKey || !config.modelToken) return "Kimono AI isn't set up yet. An administrator finishes it in Applications.";
  return null;
}

/** What stands between this server and working on a project: Kimono Git, and its token. */
export function projectMissing(config: CodeConfig): string | null {
  if (!config.gitAddress) return "Projects need Kimono Git. Switch it on first.";
  if (!config.gitToken && !config.gitApp) return "Projects need a Kimono Git token. Add it on Kimono AI's page in Applications.";
  return null;
}

export async function codeIdentity(settings: PlatformSettings): Promise<AppIdentity> {
  const definition = await getAppDefinition(codeAppId);
  const colors = settings.apps[codeAppId]?.colors || definition?.metadata.colors;
  return { id: codeAppId, name: "AI", accent: colors ? accentOf(colors) : "#3f6b6a", glyph: "code" };
}
