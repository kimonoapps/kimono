/*
 * 観 Kimono Watch's API as the web app reads it (lib/watch/index.ts has the
 * server side). Every call goes with the browser's session.
 */

export type Shelf = "Film" | "Series" | "Anime";
export type Card = {
  id: string; name: string; kind: "movie" | "series"; shelf: Shelf; year: number | null; age: string;
  poster: string | null; backdrop: string | null; logo: string | null; badge?: string | null; top?: number;
};
export type ContinueCard = Card & { season: number; episode: number; fraction: number; left: number };
export type Row = { id: string; title: string; kind: "continue" | "top" | "cards" | string; items: (Card | ContinueCard)[] };
export type Home = { featured: (Card & { backdropLarge: string | null; overview: string }) | null; rows: Row[] };

export type Rating = "down" | "up" | "love";
export type FillerChoice = "ask" | "skip" | "watch";
export type Mark = { episode: number; state: "done" | "skip" | "upcoming" | "open"; fraction: number };
export type Episode = {
  number: number; name: string; overview: string; still: string | null; runtime: number | null; airDate: string | null;
  filler: boolean; recap: boolean; fraction: number;
};
export type TitleView = {
  title: Card & { overview: string; genres: string[]; moods: string[]; cast: string[]; runtime: number | null; status: string; nextAirDate: string | null; backdropLarge: string | null };
  inList: boolean; rating: Rating | null; reminding: boolean;
  tracks: { audio: string; subtitles: string } | null;
  playable: boolean;
  resume: ({ season: number; episode: number; position: number; started: boolean }) | ({ position: number; fraction: number }) | null;
  seasons?: { number: number; name: string; episodeCount: number; airDate: string | null }[];
  tracker?: { season: number; left: number; marks: Mark[]; nextAirDate: string | null } | null;
  badge?: string | null;
  hasFillers?: boolean;
  fillers?: FillerChoice;
  season?: number;
  episodes?: Episode[];
};

export type Ref = { season: number; episode: number };
export type Markers = { intro?: [number, number]; recap?: [number, number]; credits?: number };
export type Play = {
  url: string;
  /** An HLS address, once the server packages streams for browsers. */
  hls?: string;
  version: { index: number; label: string; badges: string[]; source: string };
  versions: { index: number; label: string; source: string }[];
  startAt: number;
  next: (Ref & { skipped: number }) | null;
  fillerAhead: { first: Ref; count: number; canon: Ref | null } | null;
  autoplayNext: boolean;
  markers: Markers;
  skipIntros: boolean;
  tracks: { audio: { language: string; tags: string[] }; subtitles: { language: string; tags: string[]; kind: "full" | "signs"; signsTitles: string[] } | null };
  languages: { audio: string[]; subtitles: string[] };
};
export type Prefs = { fillers: FillerChoice; quality: string; audioLanguage: string; subtitleLanguage: string; animeAudio: string; filmAudio: string; subtitles: string; autoplayNext: boolean; skipIntros: boolean };
export type Device = { client: "web"; maxHeight: number; codecs: string[]; hdr: string[] };

export class WatchError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/watch/${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers }, credentials: "same-origin" });
  const body = await response.json().catch(() => null) as { error?: { message?: string } | string } | null;
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : body?.error?.message;
    throw new WatchError(message || "That didn't work.", response.status);
  }
  return body as T;
}
const put = (body: unknown): RequestInit => ({ method: "PUT", body: JSON.stringify(body) });
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const watchApi = {
  home: (shelf?: Shelf | null) => call<Home>(`home${shelf ? `?shelf=${shelf}` : ""}`),
  search: (q: string, signal?: AbortSignal) => call<{ results: Card[] }>(`search?q=${encodeURIComponent(q)}`, { signal }),
  title: (id: string, season?: number) => call<TitleView>(`titles/${encodeURIComponent(id)}${season ? `?season=${season}` : ""}`),
  mark: (id: string, change: { inList?: boolean; rating?: Rating | null; reminding?: boolean; tracks?: { audio: string; subtitles: string } | null }) => call<TitleView>(`titles/${encodeURIComponent(id)}`, put(change)),
  prefs: () => call<Prefs>("prefs"),
  setPrefs: (change: Partial<Prefs>) => call<Prefs>("prefs", put(change)),
  play: (body: { titleId: string; season?: number; episode?: number; version?: number; device: Device }) => call<Play>("play", post(body)),
  prepare: (body: { titleId: string; season: number; episode: number; device: Device }) => call<{ next: (Ref & { skipped: number }) | null; ready: boolean }>("prepare", post(body)),
  /** Kept alive so it still lands when the page is closing. */
  progress: (body: { titleId: string; season: number; episode: number; position: number; duration: number }) =>
    fetch("/api/v1/watch/progress", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" }, credentials: "same-origin", keepalive: true }).catch(() => null),
};

/* ───── What this browser can play ───── */

let known: Promise<Device> | null = null;
/** Codecs and HDR this browser decodes, and how tall the screen is, for picking a release. */
export function deviceOf(): Promise<Device> {
  known ??= (async () => {
    const probe = document.createElement("video");
    const can = (type: string) => {
      const native = probe.canPlayType(type) === "probably" || probe.canPlayType(type) === "maybe";
      const mse = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(type);
      return native || mse;
    };
    const codecs = ["h264"];
    if (can('video/mp4; codecs="hvc1.1.6.L120.90"') || can('video/mp4; codecs="hev1.1.6.L120.90"')) codecs.push("hevc");
    if (can('video/mp4; codecs="av01.0.08M.08"')) codecs.push("av1");
    const hdr: string[] = [];
    if (matchMedia("(dynamic-range: high)").matches && "mediaCapabilities" in navigator) {
      const test = async (transferFunction: "pq" | "hlg", contentType: string) => {
        try {
          const info = await navigator.mediaCapabilities.decodingInfo({ type: "media-source", video: { contentType, width: 3840, height: 2160, bitrate: 20_000_000, framerate: 24, transferFunction, colorGamut: "rec2020" } as VideoConfiguration });
          return info.supported;
        } catch { return false; }
      };
      const main10 = codecs.includes("hevc") ? 'video/mp4; codecs="hvc1.2.4.L153.90"' : 'video/mp4; codecs="av01.0.12M.10"';
      if (codecs.length > 1 && await test("pq", main10)) hdr.push("hdr10");
      if (codecs.length > 1 && await test("hlg", main10)) hdr.push("hlg");
    }
    const tall = Math.round(Math.max(screen.width, screen.height) * Math.min(devicePixelRatio || 1, 2) * 9 / 16);
    const maxHeight = [2160, 1440, 1080, 720].find((h) => tall >= h * 0.9) ?? 720;
    return { client: "web" as const, maxHeight, codecs, hdr };
  })();
  return known;
}

/* ───── Small helpers ───── */

export const isMovie = (c: Pick<Card, "kind">) => c.kind === "movie";
export const shelfName = (shelf: Shelf) => (shelf === "Film" ? "Films" : shelf);
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(x).padStart(2, "0")}`;
}
export const minutesText = (min: number | null | undefined) => (min ? (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`) : "");
const languageNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "language" }) : null;
export const languageName = (code: string) => { try { return languageNames?.of(code) ?? code; } catch { return code; } };
export function airText(date: string) {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}
