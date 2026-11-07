import type { AppIdentity } from "@kimono/ui";
import { accentOf } from "../apps";
import { getAppDefinition } from "../definitions";
import type { PlatformSettings } from "../settings";

export const notesAppId = "kimono-notes";

/** Notes as the Applications admin sets it up. Its notes live in Drive's store whether or not Drive itself is on. */
export function notesConfig(settings: PlatformSettings) {
  const instance = settings.apps[notesAppId];
  return { enabled: Boolean(instance?.enabled), colors: instance?.colors };
}

export async function notesIdentity(settings: PlatformSettings): Promise<AppIdentity> {
  const definition = await getAppDefinition(notesAppId);
  const colors = settings.apps[notesAppId]?.colors || definition?.metadata.colors;
  return { id: notesAppId, name: "Notes", accent: colors ? accentOf(colors) : "#b56d78", glyph: "notes" };
}
