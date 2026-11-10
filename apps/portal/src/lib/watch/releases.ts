/**
 * Releases: what a stream is (from its name), and which one a device should
 * play. People never see a list of release names; Watch picks one for the
 * device and the connection, and keeps the rest as "Other versions".
 *
 * Pure logic, tested in scripts/test-watch.mjs.
 */

import { languageOf, type LanguageWant } from "./languages";

/* Anime groups that release Japanese audio with their own subtitles (or none, for "raws"): their listed languages are subtitles. */
const subGroups = /\[(subsplease|erai-raws|horriblesubs|judas|asw|ember|tsundere-raws|anime time|commie|gjm|kaleido-subs|yameii|dkb|ssa|toonshub|varyg|sallysubs|nep_blanc|[a-z-]*-raws)\]|-(subsplease|erai-raws|judas|asw|ember)\b|\b[a-z]+-raws\b/i;

export type Hdr = "hdr10" | "hdr10plus" | "hlg" | "dv";
export type Codec = "h264" | "hevc" | "av1" | "other";
export type Source = "remux" | "bluray" | "web-dl" | "webrip" | "hdtv" | "dvd" | "unknown";
export type AudioFormat = "truehd" | "dts-hd" | "dts" | "eac3" | "ac3" | "aac" | "opus" | "flac" | "unknown";

export type Release = {
  /** Where it was found, as AIOStreams reports it, and the upstream address (never sent to apps). */
  url: string;
  name: string;
  filename: string;
  height: number;
  source: Source;
  codec: Codec;
  tenBit: boolean;
  hdr: Hdr[];
  /** Dolby Vision profile, guessed from how the release was made (5: web single layer, 7: disc, 8: with HDR10 under it). */
  dvProfile: 5 | 7 | 8 | null;
  audio: AudioFormat;
  atmos: boolean;
  channels: string | null;
  /** Audio languages (ISO 639-1), as listed or guessed; "multi" when it says so without naming them; empty when unknown. */
  languages: string[];
  /** Subtitle languages listed for it; empty when unknown. */
  subtitles: string[];
  /** Megabits a second when the listing says (season packs make size alone misleading). */
  mbps: number | null;
  bytes: number | null;
  /** True when the debrid service already has it (plays at once), false when it would have to fetch it, null when unknown. */
  cached: boolean | null;
  service: "usenet" | "debrid" | "p2p" | "unknown";
  /** Cam rips and the like, never offered. */
  junk: boolean;
};

export type Device = {
  client: "android" | "android-tv" | "ios" | "web";
  /** The screen's height in pixels (2160 for a 4K TV). */
  maxHeight: number;
  hdr: Hdr[];
  dvProfiles: number[];
  codecs: Codec[];
  /** Audio a TV or soundbar can take as-is; anything else is decoded on the device. */
  passthrough: AudioFormat[];
  /** Measured at the start of playback, in megabits a second; missing when unknown. */
  mbps?: number;
  /** On the same network as the server: full-size remuxes are fine. */
  lan?: boolean;
};

export type Quality = "auto" | "2160" | "1080" | "720" | "saver";

const has = (text: string, pattern: RegExp) => pattern.test(text);

/** Reads a release's name the way people write them: "Show.S01E02.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.H.265-GRP". */
export function parseRelease(input: { url: string; name?: string; title?: string; description?: string; filename?: string; bytes?: number | null }): Release {
  const filename = input.filename || "";
  const text = [input.name, input.title, input.description, filename].filter(Boolean).join(" \n ");
  const t = text.toLowerCase().replace(/[._]/g, " ");

  const height = has(t, /\b(2160p|4k|uhd)\b/) ? 2160 : has(t, /\b1440p\b/) ? 1440 : has(t, /\b1080[pi]\b/) ? 1080 : has(t, /\b720p\b/) ? 720 : has(t, /\b(576|480)p\b/) ? 480 : 0;
  const source: Source = has(t, /\bremux\b/) ? "remux"
    : has(t, /\b(blu ?ray|bdrip|brrip|bd25|bd50)\b/) ? "bluray"
    : has(t, /\bweb ?dl\b|\bweb\b(?! ?rip)/) ? "web-dl"
    : has(t, /\bweb ?rip\b/) ? "webrip"
    : has(t, /\bhdtv\b/) ? "hdtv" : has(t, /\bdvd(rip)?\b/) ? "dvd" : "unknown";
  const codec: Codec = has(t, /\bav1\b/) ? "av1" : has(t, /\b(x265|h ?265|hevc)\b/) ? "hevc" : has(t, /\b(x264|h ?264|avc)\b/) ? "h264" : "other";
  const dv = has(t, /\b(dv|dovi|dolby ?vision)\b/);
  const hdr10plus = has(t, /\bhdr10(\+|plus)|hdr10 ?\+/);
  const hdr10 = hdr10plus || has(t, /\bhdr(10)?\b/);
  const hlg = has(t, /\bhlg\b/);
  const hdr: Hdr[] = [...(hdr10 ? ["hdr10" as const] : []), ...(hdr10plus ? ["hdr10plus" as const] : []), ...(hlg ? ["hlg" as const] : []), ...(dv ? ["dv" as const] : [])];
  /* Disc releases carry profile 7 over HDR10; a web release that also says HDR is a profile 8 hybrid; DV alone from the web is profile 5. */
  const dvProfile = !dv ? null : source === "remux" || source === "bluray" ? 7 : hdr10 ? 8 : 5;
  if (dvProfile === 7 && !hdr.includes("hdr10")) hdr.unshift("hdr10");

  /* Audio is written glued to its channels ("DDP5.1", "AAC2.0"), so a digit may follow the name. */
  const end = "(?=\\d|\\b)";
  const audio: AudioFormat = has(t, new RegExp(`\\btrue ?hd${end}`)) ? "truehd"
    : has(t, /\bdts ?(hd|x|ma)\b|dts-hd/) ? "dts-hd" : has(t, new RegExp(`\\bdts${end}`)) ? "dts"
    : has(t, new RegExp(`\\b(ddp|dd\\+|e ?ac ?3|eac3|dolby digital plus)${end}`)) ? "eac3"
    : has(t, new RegExp(`\\b(dd|ac ?3)${end}`)) ? "ac3" : has(t, new RegExp(`\\baac${end}`)) ? "aac" : has(t, /\bopus\b/) ? "opus" : has(t, /\bflac\b/) ? "flac" : "unknown";
  const ch = /(?<![\d])([257])[ .]([01])(?!\d)/.exec(text.toLowerCase().replace(/_/g, " "));
  const channels = ch ? `${ch[1]}.${ch[2]}` : null;
  /* AIOStreams lists audio after 🌎 and subtitles after 📝; otherwise the name says what it can. */
  const listed = (mark: string) => {
    const at = text.indexOf(mark);
    if (at < 0) return [] as string[];
    const rest = text.slice(at + mark.length).split(/📝|📁|\n| \/ /u)[0];
    return [...new Set(rest.split("|").map((x) => languageOf(x)).filter((x): x is string => Boolean(x)))];
  };
  const fansub = subGroups.test(text);
  /* "Raws" are Japanese audio with no subtitles at all; Erai-raws, despite the name, is a subtitle group. */
  const raws = /(?<!erai)-raws\b/i.test(text);
  const dual = has(t, /\bdual ?audio\b/);
  const dubbed = has(t, /\b(dub|dubbed|eng ?dub)\b/) && !has(t, /\bsub(bed|s)?\b(?! ?(&|and) ?dub)/);
  let languages = listed("🌎");
  let subtitles = listed("📝");
  if (fansub && !dual && !dubbed) { subtitles = raws ? [] : [...new Set([...subtitles, ...languages, ...(subtitles.length || languages.length ? [] : ["en"])])]; languages = ["ja"]; }
  if (!languages.length) {
    languages = [
      ...(dual ? ["ja", "en"] : has(t, /\bmulti\b/) ? ["multi"] : []),
      ...(has(t, /\b(japanese|jpn)\b/) ? ["ja"] : []),
      ...(has(t, /\b(english|eng)\b/) || dubbed ? ["en"] : []),
      ...(has(t, /\b(french|vff|vf2|truefrench)\b/) ? ["fr"] : []),
      ...(has(t, /\b(spanish|esp|latino)\b/) ? ["es"] : []),
      ...(has(t, /\b(german|ger)\b/) ? ["de"] : []),
    ].filter((x, i, all) => all.indexOf(x) === i);
  }
  if (!subtitles.length && has(t, /\b(esubs?|eng ?subs?|english ?subs?)\b/)) subtitles = ["en"];
  const rate = /\((\d+(?:\.\d+)?)\s*(mbps|kbps)\)/i.exec(text);
  const mbps = rate ? Number(rate[1]) / (rate[2].toLowerCase() === "kbps" ? 1000 : 1) : null;
  const sized = /(\d+(?:\.\d+)?)\s*(tb|gb|mb)\b/i.exec(text);
  const bytes = input.bytes && input.bytes > 0 ? input.bytes : sized ? Math.round(Number(sized[1]) * { tb: 1024 ** 4, gb: 1024 ** 3, mb: 1024 ** 2 }[sized[2].toLowerCase() as "tb" | "gb" | "mb"]) : null;
  /* AIOStreams marks what the debrid service holds with ⚡ or a plus, what it would fetch with ⏳. */
  const cached = /⚡|\[[a-z]{2,3}\+\]/i.test(text) ? true : /⏳|\[[a-z]{2,3} download\]/i.test(text) ? false : null;
  const service = has(t, /\b(usenet|nzb|nzbdav|easynews|altmount)\b/) ? "usenet" : has(t, /\b(rd|real ?debrid|tb|torbox|ad|alldebrid|pm|premiumize|debrid)\b/) || cached !== null ? "debrid" : has(t, /\b(p2p|torrent)\b/) ? "p2p" : "unknown";
  /* Cinema recordings, and the extras a search drags in with an episode: openings, previews, shorts. */
  const junk = has(t, /\b(cam|camrip|hdcam|ts|telesync|hdts|tc|telecine|scr|screener|workprint)\b/)
    || has(t, /\b(ncop|nced|creditless|preview|trailer|mini anime|teaser|pv)\b/) || (mbps !== null && mbps < 0.4);
  return {
    url: input.url, name: (input.name || "").trim(), filename, height, source, codec, tenBit: has(t, /\b10 ?bit\b/) || hdr.length > 0,
    hdr, dvProfile, audio, atmos: has(t, /\batmos\b/), channels, languages, subtitles, mbps, bytes, cached, service, junk,
  };
}

/** The tallest picture a person's setting allows on this device. Phones top out at 1080p unless asked: 4K is wasted there. */
export function heightCap(device: Device, quality: Quality): number {
  const screen = device.maxHeight || 1080;
  const byQuality = quality === "2160" ? 2160 : quality === "1080" ? 1080 : quality === "720" || quality === "saver" ? 720 : device.client === "android" || device.client === "ios" ? 1080 : 2160;
  return Math.min(screen, byQuality);
}

/** Megabits a second: as listed, else from the file's size and the running time. */
export const bitrate = (r: Pick<Release, "bytes"> & { mbps?: number | null }, minutes: number | null) => (r.mbps ? r.mbps : r.bytes && minutes ? (r.bytes * 8) / (minutes * 60) / 1e6 : null);

/** Why a release won't do on this device, or null when it plays. */
export function unplayable(r: Release, device: Device, minutes: number | null): string | null {
  if (r.junk) return "not the film or episode itself";
  if (r.cached === false) return "not ready to stream";
  if (r.codec !== "other" && r.codec !== "h264" && !device.codecs.includes(r.codec)) return `${r.codec.toUpperCase()} isn't supported here`;
  /* Profile 5 has no HDR10 under it: elsewhere the picture comes out purple and green. */
  if (r.dvProfile === 5 && !device.dvProfiles.includes(5)) return "Dolby Vision this screen can't show";
  const mbps = bitrate(r, minutes);
  if (mbps !== null && device.mbps && mbps * 1.3 > device.mbps) return "too big for this connection";
  if (r.source === "remux" && !device.lan && (mbps ?? 60) > 35) return "full size only at home";
  return null;
}

const sourceRank: Record<Source, number> = { remux: 5, bluray: 4, "web-dl": 3, webrip: 2, hdtv: 1, dvd: 0, unknown: 1 };

/** Higher is better. Close to the cap, then picture, then sound, then a sensible size. */
/**
 * How well a release fits the languages wanted. A file with the wanted audio
 * scores up; one known to lack it scores down (far down when it is a dub
 * someone asked for, since the original-language version is never a dub).
 */
export function languageScore(r: Pick<Release, "languages" | "subtitles">, want: LanguageWant | string): number {
  const w = typeof want === "string" ? { audio: want, original: "", subtitles: null } : want;
  const known = r.languages.length > 0;
  const hasAudio = r.languages.includes(w.audio) || r.languages.includes("multi");
  let s = 0;
  if (hasAudio) s += 40;
  else if (known) s -= w.audio === w.original ? 20 : 200;
  else if (w.original && w.audio !== w.original) s -= 60;
  if (w.subtitles && w.audio !== w.subtitles) s += r.subtitles.includes(w.subtitles) ? 20 : r.subtitles.length ? -40 : 0;
  return s;
}

export function score(r: Release, device: Device, quality: Quality, minutes: number | null, language: LanguageWant | string = "en"): number {
  const cap = heightCap(device, quality);
  let s = 0;
  const h = r.height || 720;
  s += h > cap ? -400 - (h - cap) / 10 : (h / cap) * 400;
  const showsHdr = device.hdr.length > 0;
  if (showsHdr && r.hdr.includes("dv") && r.dvProfile !== null && device.dvProfiles.includes(r.dvProfile)) s += 60;
  if (showsHdr && r.hdr.some((x) => x !== "dv" && device.hdr.includes(x))) s += 50;
  if (!showsHdr && r.hdr.length) s -= 30; /* plays, tone-mapped: fine, but SDR is truer */
  s += sourceRank[r.source] * 12;
  if (r.atmos && device.passthrough.some((a) => a === "eac3" || a === "truehd")) s += 25;
  if ((r.audio === "truehd" || r.audio.startsWith("dts")) && !device.passthrough.includes(r.audio)) s -= 10;
  if (r.cached) s += 80;
  if (r.service === "usenet") s += 40; /* our own provider: no one else's limits */
  s += languageScore(r, language);
  const mbps = bitrate(r, minutes);
  if (mbps !== null) {
    const phone = device.client === "android" || device.client === "ios";
    const ideal = quality === "saver" ? 3 : h >= 2160 ? 22 : h >= 1080 ? (phone ? 6 : 10) : 4;
    s -= Math.max(0, mbps - ideal * 2) * (phone || quality === "saver" ? 3 : 1);
  }
  return s;
}

/** Everything that plays here, best first. */
export function rank(releases: Release[], device: Device, quality: Quality, minutes: number | null, language: LanguageWant | string = "en"): Release[] {
  return releases
    .filter((r) => unplayable(r, device, minutes) === null)
    .map((r) => ({ r, s: score(r, device, quality, minutes, language) }))
    .sort((a, b) => b.s - a.s)
    .map(({ r }) => r);
}

/** How a version is shown to people: "4K · Dolby Vision · Atmos · 18 GB". */
export function describe(r: Release): string {
  const parts = [
    r.height >= 2160 ? "4K" : r.height ? `${r.height}p` : "",
    r.hdr.includes("dv") ? "Dolby Vision" : r.hdr.includes("hdr10plus") ? "HDR10+" : r.hdr.length ? "HDR" : "",
    r.atmos ? "Atmos" : r.channels === "7.1" || r.channels === "5.1" ? r.channels : "",
    r.source === "remux" ? "Full quality" : "",
    r.bytes ? `${(r.bytes / 1024 ** 3).toFixed(r.bytes > 10 * 1024 ** 3 ? 0 : 1)} GB` : "",
  ];
  return parts.filter(Boolean).join(" · ") || "Standard";
}

/** The labels a title page shows for this device: only what it will actually get. */
export function badges(r: Release): string[] {
  return [
    ...(r.height >= 2160 ? ["4K"] : r.height >= 1080 ? ["HD"] : []),
    ...(r.hdr.includes("dv") ? ["Dolby Vision"] : r.hdr.length ? ["HDR"] : []),
    ...(r.atmos ? ["Dolby Atmos"] : r.channels === "5.1" || r.channels === "7.1" ? [r.channels] : []),
  ];
}

/** A device the API was told nothing about: a 1080p SDR phone that decodes H.264 and HEVC. */
export function cleanDevice(raw: unknown): Device {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(value: unknown, allowed: readonly T[]): T[] => (Array.isArray(value) ? value.filter((v): v is T => allowed.includes(v as T)) : []);
  const client = (["android", "android-tv", "ios", "web"] as const).find((c) => c === input.client) ?? "android";
  const codecs = pick(input.codecs, ["h264", "hevc", "av1"] as const);
  return {
    client,
    maxHeight: Math.min(4320, Math.max(360, Number(input.maxHeight) || (client === "android-tv" ? 2160 : 1080))),
    hdr: pick(input.hdr, ["hdr10", "hdr10plus", "hlg", "dv"] as const),
    dvProfiles: Array.isArray(input.dvProfiles) ? input.dvProfiles.map(Number).filter((n) => [5, 7, 8].includes(n)) : [],
    codecs: codecs.length ? codecs : client === "web" ? ["h264"] : ["h264", "hevc"],
    passthrough: pick(input.passthrough, ["truehd", "dts-hd", "dts", "eac3", "ac3"] as const),
    ...(Number(input.mbps) > 0 ? { mbps: Number(input.mbps) } : {}),
    ...(input.lan === true ? { lan: true } : {}),
  };
}
