/*
 * 観 Kimono Watch's API as the web app reads it (lib/watch/index.ts has the
 * server side). Every call goes with the browser's session.
 */

export type Shelf = "Film" | "Series" | "Anime";
export type Card = {
  id: string; name: string; kind: "movie" | "series"; shelf: Shelf; year: number | null; age: string;
  poster: string | null; backdrop: string | null; logo: string | null; badge?: string | null; top?: number;
};
export type ContinueCard = Card & { season: number; episode: number; fraction: number; left: number; label?: string };
export type Row = { id: string; title: string; kind: "continue" | "top" | "cards" | string; items: (Card | ContinueCard)[] };
/** A page of Home: the first has the hero; `next` asks for the page after it, null at the end. */
export type Home = { featured: (Card & { backdropLarge: string | null; overview: string }) | null; rows: Row[]; next?: string | null };

export type Layout = "single" | "continuous" | "seasons";
export type Rating = "down" | "up" | "love";
export type FillerChoice = "ask" | "skip" | "watch";
export type Mark = { episode: number; state: "done" | "skip" | "upcoming" | "open"; fraction: number };
export type Episode = {
  /** Which season it sits in, its number there, and its number counted from the first episode. */
  season?: number; absolute?: number;
  /** How to name it: "S2:E3", "E27" or "E3", as the title's layout says. */
  label?: string;
  number: number; name: string; overview: string; still: string | null; runtime: number | null; airDate: string | null;
  filler: boolean; recap: boolean; fraction: number;
};
export type TitleView = {
  title: Card & { overview: string; genres: string[]; moods: string[]; cast: string[]; runtime: number | null; status: string; nextAirDate: string | null; backdropLarge: string | null };
  inList: boolean; rating: Rating | null; reminding: boolean;
  tracks: { audio: string; subtitles: string } | null;
  /** What it plays in now ([subtitles]: "off", "signs" or a language), and the languages to offer. */
  language?: { audio: string; subtitles: string; original: string; mine: string; subtitleLanguage: string; preferred?: string; fallback?: string };
  playable: boolean;
  /** Why it can't play, when it can't: not out yet, only in cinemas, or no copy found. */
  availability?: { state: "ready" | "upcoming" | "cinemas" | "missing"; note: string | null };
  resume: ({ season: number; episode: number; position: number; started: boolean; label?: string }) | ({ position: number; fraction: number }) | null;
  /** "single": one season, so no season anywhere; "continuous": one list numbered from the first; "seasons": the picker. */
  /** This show's own episode layout, or null to follow the default in Settings. */
  showEpisodes?: "seasons" | "continuous" | null;
  layout?: Layout;
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
  hls?: string | null;
  version: { index: number; key: string; label: string; badges: string[]; source: string; bytes?: number | null };
  versions: { index: number; key: string; label: string; source: string }[];
  startAt: number;
  next: (Ref & { skipped: number; label?: string }) | null;
  fillerAhead: { first: Ref & { label?: string }; count: number; canon: (Ref & { label?: string }) | null } | null;
  /** How this title lays out its episodes, and the playing one's name in it ("E2", "S2:E3"). */
  layout?: Layout;
  label?: string | null;
  autoplayNext: boolean;
  markers: Markers;
  skipIntros: boolean;
  tracks: { audio: { language: string; tags: string[] }; subtitles: { language: string; tags: string[]; kind: "full" | "signs"; signsTitles: string[] } | null };
  languages: { audio: string[]; subtitles: string[] };
  /** The quality playing and the ones this release offers here; absent from older servers. */
  quality?: { current: string; options: { value: string; label: string }[] };
};
/** Languages to pick from, by their ISO 639-1 code. */
export const languages = ["en", "ja", "fr", "de", "es", "it", "pt", "nl", "sv", "no", "da", "fi", "pl", "ru", "uk", "tr", "ar", "hi", "ko", "zh"];

export type Prefs = {
  fillers: FillerChoice; quality: string; subtitleLanguage: string;
  /** "original" or a language; the fallback when no copy has it; audioLanguage is the server's: the language understood. */
  preferredLanguage: string; fallbackLanguage: string; audioLanguage: string; subtitles: "auto" | "always" | "off";
  autoplayNext: boolean; skipIntros: boolean; animeEpisodes?: "seasons" | "continuous";
  subtitleSize?: "small" | "medium" | "large"; subtitleBackground?: "none" | "shadow" | "box";
  previews?: boolean; downloadQuality?: "standard" | "higher";
};
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
/* A language change still on its way, per title: a play waits for it, or it gets the old languages. */
const savingTracks = new Map<string, Promise<unknown>>();

export const watchApi = {
  home: (shelf?: Shelf | null, cursor?: string | null) => {
    const q = new URLSearchParams();
    if (shelf) q.set("shelf", shelf);
    if (cursor) q.set("cursor", cursor);
    return call<Home>(`home${q.size ? `?${q}` : ""}`);
  },
  /** Home's rows from the first page on until the ones wanted have come (My list, Continue watching), at most a few pages. */
  homeUntil: async (want: string[], pages = 6) => {
    let page = await call<Home>("home");
    const all: Home = { ...page, rows: [...page.rows] };
    for (let i = 1; i < pages && page.next && !want.every((id) => all.rows.some((r) => r.id === id)); i++) {
      page = await call<Home>(`home?cursor=${encodeURIComponent(page.next)}`);
      all.rows.push(...page.rows.filter((r) => !all.rows.some((x) => x.id === r.id)));
      all.next = page.next;
    }
    return all;
  },
  search: (q: string, signal?: AbortSignal) => call<{ results: Card[] }>(`search?q=${encodeURIComponent(q)}`, { signal }),
  title: (id: string, season?: number) => call<TitleView>(`titles/${encodeURIComponent(id)}${season ? `?season=${season}` : ""}`),
  /** The page comes back for `season` when given, so the episode list stays where it was. */
  mark: (id: string, change: { inList?: boolean; rating?: Rating | null; reminding?: boolean; tracks?: { audio: string; subtitles: string } | null; episodes?: "seasons" | "continuous" | null }, season?: number) => {
    const done = call<TitleView>(`titles/${encodeURIComponent(id)}${season ? `?season=${season}` : ""}`, put(change));
    if (change.tracks !== undefined) {
      const settled = done.catch(() => {});
      savingTracks.set(id, settled);
      void settled.then(() => { if (savingTracks.get(id) === settled) savingTracks.delete(id); });
    }
    return done;
  },
  prefs: () => call<Prefs>("prefs"),
  /** While a stream stalls: whether the server's side or this connection is holding it up. */
  health: (titleId: string, season: number, episode: number) => call<{ slow: "server" | "connection" | null }>(`health?titleId=${encodeURIComponent(titleId)}&season=${season}&episode=${episode}`),
  /** This browser's own quality, or null when it follows the person's. */
  deviceQuality: () => call<Prefs & { device?: { id: string; quality: string | null } }>(`prefs?device=${encodeURIComponent(deviceId())}`).then((p) => p.device?.quality ?? null),
  setPrefs: (change: Partial<Prefs>) => call<Prefs>("prefs", put(change)),
  /** This browser's own preferred quality. */
  setDeviceQuality: (quality: string) => call<Prefs>("prefs", put({ device: deviceId(), quality })),
  play: async (body: { titleId: string; season?: number; episode?: number; version?: number; avoid?: string[]; quality?: string; startAt?: number; device: Device }) => {
    await savingTracks.get(body.titleId);
    return call<Play>("play", post({ ...body, deviceId: deviceId() }));
  },
  prepare: (body: { titleId: string; season: number; episode: number; device: Device }) => call<{ next: (Ref & { skipped: number; label?: string }) | null; ready: boolean }>("prepare", post({ ...body, deviceId: deviceId() })),
  /** Kept alive so it still lands when the page is closing. */
  /** Ends every stream this person has going, on every screen. */
  endStreams: () => call<{ ended: number }>("streams", { method: "DELETE" }),
  /** Asks the admins for one more screen at once. */
  askScreens: () => call<{ asked: { want: number; at: number } }>("screens", post({})),
  progress: (body: { titleId: string; season: number; episode: number; position: number; duration: number }) =>
    fetch("/api/v1/watch/progress", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" }, credentials: "same-origin", keepalive: true }).catch(() => null),
};

/* ───── This browser ───── */

let memoryId: string | null = null;
/** A stable id for this browser, kept in localStorage (or for the visit, where storage is off). */
export function deviceId(): string {
  try {
    const known = localStorage.getItem("kw.device");
    if (known) return known;
    const made = `web-${crypto.randomUUID()}`;
    localStorage.setItem("kw.device", made);
    return made;
  } catch {
    memoryId ??= `web-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    return memoryId;
  }
}

/** Qualities someone can ask this device for; the player shows only what a stream offers. */
export const qualities = [
  { value: "auto", label: "Auto" }, { value: "best", label: "Best picture" }, { value: "2160", label: "4K" }, { value: "1080", label: "1080p" }, { value: "720", label: "720p" }, { value: "saver", label: "Data saver" },
];
export function savedQuality(): string {
  try { return localStorage.getItem("kw.quality") || "auto"; } catch { return "auto"; }
}
export function saveQuality(value: string) {
  try { localStorage.setItem("kw.quality", value); } catch { /* the server keeps it too */ }
}

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
/** Containers tag tracks "eng", "jpn", "fre"; the server keeps languages as "en", "ja", "fr". Null when it can't tell ("und"). */
const threeToTwo: Record<string, string> = {
  eng: "en", jpn: "ja", fre: "fr", fra: "fr", ger: "de", deu: "de", spa: "es", ita: "it", por: "pt", rus: "ru", ara: "ar", hin: "hi",
  chi: "zh", zho: "zh", kor: "ko", pol: "pl", ind: "id", tha: "th", vie: "vi", tur: "tr", dut: "nl", nld: "nl", may: "ms", msa: "ms",
  heb: "he", swe: "sv", nor: "no", nob: "no", nno: "no", dan: "da", fin: "fi", cze: "cs", ces: "cs", hun: "hu", gre: "el", ell: "el",
  rum: "ro", ron: "ro", ukr: "uk", per: "fa", fas: "fa", tam: "ta", tel: "te", ben: "bn", fil: "tl", tgl: "tl",
};
export function twoLetter(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (/^[a-z]{2}$/.test(c)) return c;
  return threeToTwo[c] ?? null;
}
export const languageName = (code: string) => { try { return languageNames?.of(code) ?? code; } catch { return code; } };
export function airText(date: string) {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

/* ───── Naming episodes ───── */

/** An episode's label from the title page, else built the way the layout would: "E4" without seasons, "S2:E3" with. */
export function labelOf(view: Pick<TitleView, "layout" | "episodes" | "season"> | null | undefined, season: number, episode: number): string {
  const found = view?.episodes?.find((e) => (e.season ?? view.season) === season && e.number === episode);
  if (found?.label) return found.label;
  if (view?.layout === "continuous" && found?.absolute) return `E${found.absolute}`;
  return view?.layout && view.layout !== "seasons" ? `E${episode}` : `S${season}:E${episode}`;
}
/** "S2:E3" said in full ("Season 2, Episode 3"); "E27" is "Episode 27". */
export function longLabel(label: string) {
  const m = /^S(\d+):E(\d+)$/.exec(label);
  if (m) return `Season ${m[1]}, Episode ${m[2]}`;
  const e = /^E(\d+)$/.exec(label);
  return e ? `Episode ${e[1]}` : label;
}
/** The number an episode goes by in its label: 27 for "E27", 3 for "S2:E3". */
export const shownNumber = (label: string | undefined, fallback: number) => Number(/E(\d+)$/.exec(label ?? "")?.[1]) || fallback;
