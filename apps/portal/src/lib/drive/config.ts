import type { AppIdentity } from "@kimono/ui";
import { accentOf } from "../apps";
import { getAppDefinition } from "../definitions";
import type { PlatformSettings } from "../settings";

export const driveAppId = "kimono-drive";

/**
 * Drive as the Applications admin sets it up: switched on there like any
 * other app, with its settings on the same page, and its colours too.
 */
export function driveConfig(settings: PlatformSettings) {
  const instance = settings.apps[driveAppId];
  const value = (key: string) => instance?.environment[key]?.value;
  const largest = Number(value("largest_file_gb"));
  return {
    enabled: Boolean(instance?.enabled),
    publicLinks: (value("public_links") ?? "on") === "on",
    largestFileBytes: Number.isFinite(largest) && largest > 0 ? Math.floor(largest * 1024 ** 3) : 0,
    colors: instance?.colors,
  };
}

/** Drive's bloom and lockup, in the colours its admin page gives it. */
export async function driveIdentity(settings: PlatformSettings): Promise<AppIdentity> {
  const definition = await getAppDefinition(driveAppId);
  const colors = settings.apps[driveAppId]?.colors || definition?.metadata.colors;
  return { id: driveAppId, name: "Drive", accent: colors ? accentOf(colors) : "#5f5596", glyph: "file" };
}
