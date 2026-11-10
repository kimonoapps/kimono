/**
 * Finding streams. AIOStreams speaks Stremio's addon protocol and searches
 * every source Kimono is set up with (debrid services and Usenet through
 * nzbdav) at once: Watch asks it for one film or episode by its IMDb id and
 * reads what comes back as releases (./releases.ts).
 *
 * The answer is kept for a few minutes, so opening a title page and then
 * pressing play doesn't search twice.
 */
import { parseRelease, type Release } from "./releases";
import { WatchProblem } from "./model";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The addon's base address from its manifest's: ".../manifest.json" → "...". */
export function addonBase(manifest: string): string {
  return manifest.replace(/\/manifest\.json(\?.*)?$/, "").replace(/\/+$/, "");
}

/** Stremio's id for a film ("tt0133093") or an episode ("tt0944947:1:2"). */
export function stremioId(imdbId: string, season?: number, episode?: number) {
  return season && episode ? `${imdbId}:${season}:${episode}` : imdbId;
}

/** Streams from an addon's answer, as releases. Ones without a direct address (torrent hashes, links out) are left out. */
export function releasesFrom(body: Json): Release[] {
  const streams: Json[] = Array.isArray(body.streams) ? body.streams : [];
  return streams.flatMap((s) => {
    if (typeof s.url !== "string" || !/^https?:\/\//.test(s.url)) return [];
    const hints: Json = s.behaviorHints ?? {};
    return [parseRelease({ url: s.url, name: s.name, title: s.title, description: s.description, filename: hints.filename, bytes: Number(hints.videoSize) || null })];
  });
}

export async function findStreams(manifest: string, kind: "movie" | "series", id: string): Promise<Release[]> {
  if (!manifest) throw new WatchProblem("Watch has no stream source yet. Add the AIOStreams address in Applications → Watch.", 503);
  const url = `${addonBase(manifest)}/stream/${kind}/${encodeURIComponent(id)}.json`;
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(25_000) }).catch(() => null);
  if (!response?.ok) throw new WatchProblem("The stream search didn't answer. Try again in a moment.", 502);
  return releasesFrom((await response.json()) as Json);
}
