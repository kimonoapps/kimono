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
import { isStandIn, markDead } from "./dead";

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

/** Error entries a search answers with when one of its sources failed or timed out: the answer is then incomplete. */
export function searchErrors(body: Json): number {
  const streams: Json[] = Array.isArray(body.streams) ? body.streams : [];
  return streams.filter((s) => typeof s.url !== "string" && /❌|⚠|error|timed? ?out|failed|unavailable/i.test(`${s.name ?? ""} ${s.description ?? ""} ${s.title ?? ""}`)).length;
}

/** Whether the search itself turned the request away for coming too often (AIOStreams answers that as an error entry, not a 429). */
export function searchRefused(body: Json): boolean {
  const streams: Json[] = Array.isArray(body.streams) ? body.streams : [];
  return streams.some((s) => typeof s.url !== "string" && /rate.?limit|too many requests/i.test(`${s.name ?? ""} ${s.description ?? ""} ${s.title ?? ""}`));
}

/** Streams found, whether the search was complete (no source failed), so an empty answer can be trusted or not, and whether it was refused for coming too often. */
export async function searchStreams(manifest: string, kind: "movie" | "series", id: string): Promise<{ releases: Release[]; complete: boolean; refused: boolean }> {
  if (!manifest) throw new WatchProblem("Watch has nowhere to stream from yet.", 503);
  const url = `${addonBase(manifest)}/stream/${kind}/${encodeURIComponent(id)}.json`;
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(25_000) }).catch(() => null);
  if (!response?.ok) throw new WatchProblem("The stream search didn't answer. Try again in a moment.", 502);
  const body = (await response.json()) as Json;
  return { releases: releasesFrom(body), complete: searchErrors(body) === 0, refused: searchRefused(body) };
}

export async function findStreams(manifest: string, kind: "movie" | "series", id: string): Promise<Release[]> {
  if (!manifest) throw new WatchProblem("Watch has nowhere to stream from yet.", 503);
  const url = `${addonBase(manifest)}/stream/${kind}/${encodeURIComponent(id)}.json`;
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(25_000) }).catch(() => null);
  if (!response?.ok) throw new WatchProblem("The stream search didn't answer. Try again in a moment.", 502);
  return releasesFrom((await response.json()) as Json);
}

/** Upstream addresses may carry a login (nzbdav's WebDAV); fetch won't take one in the address, so it moves to a header. */
export function upstreamRequest(url: string): { url: string; authorization: string | null } {
  const parsed = new URL(url);
  if (!parsed.username && !parsed.password) return { url, authorization: null };
  const authorization = `Basic ${Buffer.from(`${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`).toString("base64")}`;
  parsed.username = ""; parsed.password = "";
  return { url: parsed.toString(), authorization };
}

/**
 * Fetches an upstream stream, following redirects itself: AIOStreams sends
 * Usenet playback on to nzbdav with its WebDAV login in the address, which
 * fetch refuses to follow. Each hop's login goes into a header for that hop
 * only, so it never travels to another host.
 */
export async function fetchUpstream(url: string, init: { method: string; headers: Headers; signal?: AbortSignal }, get: typeof fetch = fetch): Promise<Response | null> {
  /* An address that only opens for one client carries its User-Agent (./youtube.ts). */
  const at = url.indexOf("#kimono-ua=");
  const agent = at < 0 ? null : decodeURIComponent(url.slice(at + "#kimono-ua=".length));
  let next = at < 0 ? url : url.slice(0, at);
  for (let hop = 0; hop < 6; hop++) {
    const target = upstreamRequest(next);
    const headers = new Headers(init.headers);
    headers.delete("authorization");
    if (agent) headers.set("user-agent", agent);
    if (target.authorization) headers.set("authorization", target.authorization);
    const response = await get(target.url, { method: init.method, headers, redirect: "manual", signal: init.signal }).catch(() => null);
    if (!response) return null;
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {});
      next = new URL(location, next).toString();
      continue;
    }
    /* A stand-in clip ("this provider is unavailable") is a failure: mark the copy so the next play picks another. */
    const total = Number(/\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1] ?? (response.status === 200 ? response.headers.get("content-length") : NaN));
    if (response.ok && isStandIn(target.url, Number.isFinite(total) && total > 0 ? total : null, null)) {
      await response.body?.cancel().catch(() => {});
      markDead(url);
      return null;
    }
    return response;
  }
  return null;
}

/** What a file is, when the upstream only says "download this" (debrid links often do); players and browsers want the real type. */
export function videoType(contentType: string | null, url: string): string | null {
  if (contentType && !/octet-stream|force-download|binary/i.test(contentType)) return contentType;
  const ext = /\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  return ({ mkv: "video/x-matroska", mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", avi: "video/x-msvideo", ts: "video/mp2t", mov: "video/quicktime" } as Record<string, string>)[ext ?? ""] ?? contentType;
}
