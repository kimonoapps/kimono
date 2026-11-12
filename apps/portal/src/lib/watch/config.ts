import type { AppIdentity } from "@kimono/ui";
import { accentOf } from "../apps";
import { getAppDefinition } from "../definitions";
import type { PlatformSettings } from "../settings";

export const watchAppId = "kimono-watch";

/* The Applications page shows service names; AIOStreams knows them by these. */
const debridIds: Record<string, string> = { "Real-Debrid": "realdebrid", TorBox: "torbox", AllDebrid: "alldebrid", Premiumize: "premiumize" };

/** Watch as the Applications admin sets it up: where metadata and streams come from. */
export function watchConfig(settings: PlatformSettings) {
  const instance = settings.apps[watchAppId];
  const value = (key: string) => instance?.environment[key]?.value?.trim() || "";
  const nzbdavUrl = (process.env.KIMONO_WATCH_NZBDAV_URL || "http://nzbdav:3000").replace(/\/+$/, "");
  return {
    enabled: Boolean(instance?.enabled),
    /* TMDB: an API read access token (long) or a v3 API key (32 hex characters). */
    tmdbToken: value("tmdb_token"),
    /* The household's accounts. Kimono sets up nzbdav and AIOStreams from these (./provision.ts). */
    usenet: {
      host: value("usenet_host"),
      port: Number(value("usenet_port")) || 563,
      ssl: (value("usenet_ssl") || "on") === "on",
      username: value("usenet_username"),
      password: value("usenet_password"),
      connections: Math.min(Math.max(Number(value("usenet_connections")) || 20, 1), 200),
    },
    indexer: { url: value("indexer_url").replace(/\/+$/, ""), key: value("indexer_key") },
    debrid: { service: debridIds[value("debrid_service")] ?? "", key: value("debrid_key") },
    /* Where the Portal reaches the two services: beside it on the server's network. */
    aiostreamsUrl: (process.env.KIMONO_WATCH_AIOSTREAMS_URL || "http://aiostreams:3000").replace(/\/+$/, ""),
    nzbdavUrl,
    /* Where nzbdav's streams are fetched from: the Portal relays them, so its own way in. */
    nzbdavStreamUrl: nzbdavUrl,
    /* The HLS packager beside the Portal (./hls.ts), and the Portal's own address as it reads streams from it. */
    packager: {
      url: (process.env.KIMONO_WATCH_PACKAGER_URL || "http://watch-packager:8080").replace(/\/+$/, ""),
      key: process.env.KIMONO_WATCH_PACKAGER_KEY?.trim() || "",
      input: (process.env.KIMONO_WATCH_PACKAGER_INPUT_URL || "http://portal:3000").replace(/\/+$/, ""),
    },
    /* Shows from broadcasters' YouTube uploads (./youtube.ts): off unless KIMONO_WATCH_YOUTUBE=on. */
    youtube: process.env.KIMONO_WATCH_YOUTUBE === "on",
    /* Age ratings and release dates are read for this country first. */
    region: (value("region") || "US").toUpperCase().slice(0, 2),
    jikanUrl: (value("jikan_url") || "https://api.jikan.moe/v4").replace(/\/+$/, ""),
    anilistUrl: "https://graphql.anilist.co",
    /* Opening, ending and recap times for anime. */
    aniskipUrl: "https://api.aniskip.com/v2",
    /* Episode counts of anime seasons split into parts. */
    kitsuUrl: "https://kitsu.app/api/edge",
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
