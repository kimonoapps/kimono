import type { AppIdentity } from "@kimono/ui";
import { accentOf } from "../apps";
import { getAppDefinition } from "../definitions";
import { appHostname, type PlatformSettings } from "../settings";

export const codeAppId = "kimono-code";

/** Code as the Applications admin sets it up: the sandbox node, and the two tokens the node uses on the agent's behalf. */
export function codeConfig(settings: PlatformSettings) {
  const instance = settings.apps[codeAppId];
  const value = (key: string) => instance?.environment[key]?.value?.trim() || "";
  const forgejo = Object.values(settings.apps).find((app) => app.definitionId === "forgejo" && app.enabled);
  const gitAddress = (value("git_address") || (forgejo ? `https://${appHostname(forgejo.domain, settings.baseDomain)}` : "")).replace(/\/+$/, "");
  return {
    enabled: Boolean(instance?.enabled),
    nodeAddress: value("node_address").replace(/\/+$/, ""),
    nodeKey: value("node_key"),
    gitToken: value("git_token"),
    modelToken: value("model_token"),
    gitAddress,
    colors: instance?.colors,
  };
}

export type CodeConfig = ReturnType<typeof codeConfig>;

/** What still stands between this server and a working Code, in the admin's words. */
export function missing(config: CodeConfig): string | null {
  if (!config.nodeAddress || !config.nodeKey) return "Code needs a sandbox node. An administrator adds it on Code's page in Applications.";
  if (!config.gitAddress) return "Code works on Kimono Git repositories. Switch on Kimono Git first.";
  if (!config.gitToken || !config.modelToken) return "Code needs its Kimono Git and Claude tokens. An administrator adds them on Code's page in Applications.";
  return null;
}

export async function codeIdentity(settings: PlatformSettings): Promise<AppIdentity> {
  const definition = await getAppDefinition(codeAppId);
  const colors = settings.apps[codeAppId]?.colors || definition?.metadata.colors;
  return { id: codeAppId, name: "Code", accent: colors ? accentOf(colors) : "#3f6b6a", glyph: "code" };
}
