import type { AppIdentity } from "@kimono/ui";
import { accentOf } from "../apps";
import { getAppDefinition } from "../definitions";
import type { PlatformSettings } from "../settings";

export const watchAppId = "kimono-watch";

/** Watch as the Applications admin sets it up: where metadata and streams come from. */
export function watchConfig(settings: PlatformSettings) {
  const instance = settings.apps[watchAppId];
  const value = (key: string) => instance?.environment[key]?.value?.trim() || "";
  return {
    enabled: Boolean(instance?.enabled),
    /* TMDB: an API read access token (long) or a v3 API key (32 hex characters). */
    tmdbToken: value("tmdb_token"),
    /* AIOStreams' manifest address for Kimono's own configuration, on the private network. */
    streamsManifest: value("streams_manifest") || process.env.KIMONO_WATCH_STREAMS_MANIFEST?.trim() || "",
    /* Age ratings and release dates are read for this country first. */
    region: (value("region") || "US").toUpperCase().slice(0, 2),
    jikanUrl: (value("jikan_url") || "https://api.jikan.moe/v4").replace(/\/+$/, ""),
    anilistUrl: "https://graphql.anilist.co",
    /* Fribb's map between TMDB, TVDB, IMDb, AniList and MyAnimeList ids. */
    animeMapUrl: value("anime_map_url") || "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json",
    colors: instance?.colors,
  };
}
export type WatchConfig = ReturnType<typeof watchConfig>;

export async function watchIdentity(settings: PlatformSettings): Promise<AppIdentity> {
  const definition = await getAppDefinition(watchAppId);
  const colors = settings.apps[watchAppId]?.colors || definition?.metadata.colors;
  return { id: watchAppId, name: "Watch", accent: colors ? accentOf(colors) : "#a84d63", glyph: "play" };
}
