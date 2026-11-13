import type { AppIdentity } from "@kimono/ui";
import { accentOf } from "../apps";
import { getAppDefinition } from "../definitions";
import type { PlatformSettings } from "../settings";

export const booksAppId = "kimono-books";

/** Books as the Applications admin sets it up: which sources it may ask. */
export function booksConfig(settings: PlatformSettings) {
  const instance = settings.apps[booksAppId];
  const value = (key: string) => instance?.environment[key]?.value?.trim() || "";
  const annasUrl = value("annas_url").replace(/\/+$/, "");
  return {
    enabled: Boolean(instance?.enabled),
    googleKey: value("google_key"),
    hardcoverToken: value("hardcover_token"),
    /* Only an https address the admin typed: the key goes nowhere else. */
    annas: /^https:\/\/[^/\s]+$/i.test(annasUrl) && value("annas_key") ? { url: annasUrl, key: value("annas_key") } : null,
    colors: instance?.colors,
  };
}
export type BooksConfig = ReturnType<typeof booksConfig>;

export async function booksIdentity(settings: PlatformSettings): Promise<AppIdentity> {
  const definition = await getAppDefinition(booksAppId);
  const colors = settings.apps[booksAppId]?.colors || definition?.metadata.colors;
  return { id: booksAppId, name: "Books", accent: colors ? accentOf(colors) : "#5b6b3f", glyph: "book" };
}
