/**
 * HLS for screens that can't open the original file: browsers, AirPlay
 * (iPhone, Safari, Apple TV) and Chromecast's built-in player. The native
 * apps play the file itself; these get the same stream packaged as HLS with
 * fMP4 segments by the packager beside the Portal (infra/compose/server/
 * watch-packager).
 *
 * Everything about a stream is decided here, from what the packager's probe
 * found in the file and what the screen can do: the video is copied when
 * the screen decodes it as it is and transcoded only when it can't (H.264,
 * tone-mapped to SDR for HDR the screen can't show, with a ladder of
 * sizes); audio becomes AAC unless the screen takes E-AC3 or AC3 as it is;
 * text subtitles become WebVTT, and bitmap ones (PGS) are burned in when
 * they are the ones wanted. The packager only runs the ffmpeg arguments
 * built here around wherever the viewer is.
 *
 * Addresses are /api/v1/watch/hls/<token>/main.m3u8: the token seals the
 * stream's own relay token with the screen and the tracks wanted, like a
 * stream address (./token.ts), so receivers never see the packager.
 *
 * Pure, tested in scripts/test-watch.mjs.
 */
import { createHash } from "node:crypto";
import type { AudioFormat, Codec, Device, Hdr } from "./releases";
import { openJson, sealJson } from "./token";

export type Cast = "chromecast" | "airplay";

/** What the screen playing the HLS can do. */
export type Screen = Pick<Device, "codecs" | "hdr" | "dvProfiles" | "maxHeight" | "passthrough">;

export const castOf = (raw: unknown): Cast | null => (raw === "chromecast" || raw === "airplay" ? raw : null);

/**
 * The screen the HLS plays on: the browser as it describes itself, or a
 * receiver as it is known to be. Chromecast's built-in player is held to
 * what every model plays (H.264 at 1080p, SDR, AAC); AirPlay goes to Apple
 * TVs and AirPlay TVs, which take HEVC, HDR10 and Dolby audio.
 */
export function screenFor(device: Device, cast: Cast | null): Device {
  if (cast === "chromecast") return { client: "web", maxHeight: 1080, hdr: [], dvProfiles: [], codecs: ["h264"], passthrough: [], ...(device.mbps ? { mbps: device.mbps } : {}), ...(device.lan ? { lan: true } : {}) };
  if (cast === "airplay") return { client: "web", maxHeight: 2160, hdr: ["hdr10", "hlg"], dvProfiles: [], codecs: ["h264", "hevc"], passthrough: ["eac3", "ac3"], ...(device.lan ? { lan: true } : {}) };
  return device;
}

/** A screen that takes anything, for picking a release when only transcoding will do. */
export const anything = (device: Device): Device => ({ ...device, codecs: ["h264", "hevc", "av1"], hdr: ["hdr10", "hdr10plus", "hlg", "dv"], dvProfiles: [5, 7, 8], tenBit: true, hi10p: true });

/* ───── The address ───── */

export type HlsGrant = {
  /** The stream's relay token (./token.ts): the packager reads the file through the relay. */
  stream: string;
  username: string;
  expiresAt: number;
  screen: Screen;
  /** Container tags for the audio wanted ("ja", "jpn"). */
  audio: string[];
  subtitles: { tags: string[]; kind: "full" | "signs"; signsTitles: string[] } | null;
  /** Burn the wanted subtitles into the picture (text ones too), for screens that draw WebVTT badly. */
  burn: boolean;
};

export const sealHls = (key: Buffer, grant: HlsGrant) => sealJson(key, { k: "hls", ...grant }, grant.expiresAt);

export function openHls(key: Buffer, token: string, now = Date.now()): HlsGrant | null {
  const raw = openJson(key, token, now) as (HlsGrant & { k?: string }) | null;
  if (!raw || raw.k !== "hls" || typeof raw.stream !== "string" || typeof raw.username !== "string" || !raw.screen) return null;
  const { k: _kind, ...grant } = raw; // eslint-disable-line @typescript-eslint/no-unused-vars
  return grant;
}

/** How often a probe is asked before a slow source counts as failing. */
export const probeAttempts = 3;

/**
 * What the packager's answer to a probe means: read, worth asking again
 * (504: no answer in time, a server error; or no answer at all), or a copy
 * that will never play (422: refused, or not a video).
 */
export function probeOutcome(status: number | null): "ok" | "slow" | "unreadable" {
  if (status !== null && status >= 200 && status < 300) return "ok";
  return status === 422 ? "unreadable" : "slow";
}

/** One packager session per address. */
export const sessionOf = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 32);

/* ───── What the probe says ───── */

export type ProbeStream = {
  index: number;
  codec_type: "video" | "audio" | "subtitle" | "attachment" | "data";
  codec_name?: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  pix_fmt?: string;
  color_transfer?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  channels?: number;
  bit_rate?: string;
  tags?: { language?: string; title?: string };
  disposition?: { default?: number; forced?: number; attached_pic?: number };
  side_data_list?: { side_data_type?: string; dv_profile?: number }[];
};

export type Hardware = { kind: "nvenc" | "qsv" | "vaapi" | "software"; device?: string; tonemapx?: boolean; zscale?: boolean };

export type Probe = {
  format: { duration?: string; bit_rate?: string; size?: string };
  streams: ProbeStream[];
  /** Video keyframe times from the file's index; null when it has none (copying needs them). */
  keyframes: number[] | null;
  hardware: Hardware;
};

const textSubtitles = ["subrip", "ass", "ssa", "webvtt", "mov_text", "text"];
const bitmapSubtitles = ["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle"];

/** What a video stream is, in the terms releases use. */
export function videoOf(s: ProbeStream): { codec: Codec; hdr: Hdr | null; dvProfile: number | null; tenBit: boolean } {
  const name = s.codec_name ?? "";
  const codec: Codec = name === "h264" ? "h264" : name === "hevc" ? "hevc" : name === "av1" ? "av1" : "other";
  const dvProfile = s.side_data_list?.find((d) => /dovi|dolby vision/i.test(d.side_data_type ?? ""))?.dv_profile ?? null;
  const hdr: Hdr | null = s.color_transfer === "smpte2084" ? "hdr10" : s.color_transfer === "arib-std-b67" ? "hlg" : dvProfile !== null ? "dv" : null;
  return { codec, hdr, dvProfile, tenBit: /10|12/.test(s.pix_fmt ?? "") };
}

/* ───── The plan ───── */

export type Rung = { height: number; width: number; kbps: number };

export type HlsPlan = {
  duration: number;
  /** Where each segment starts, in seconds of the file's own time. */
  segments: number[];
  video:
    | { index: number; mode: "copy"; codec: Codec; codecs: string; width: number; height: number; bandwidth: number; range: "SDR" | "PQ" | "HLG"; frameRate: number | null }
    | { index: number; mode: "transcode"; rungs: Rung[]; tonemap: boolean; hwDecode: boolean; frameRate: number | null; tenBit: boolean };
  audio: { index: number; mode: "copy" | "aac"; codecs: string } | null;
  subtitles: { index: number; name: string; language: string; default: boolean; forced: boolean }[];
  burn: { index: number; bitmap: boolean } | null;
};

export const segmentTarget = 6;

/**
 * Where segments start. Copying cuts only at the file's keyframes, so a
 * segment runs from one keyframe to the first at least six seconds on;
 * transcoding puts keyframes every six seconds itself.
 */
export function segmentTimes(duration: number, keyframes: number[] | null, target = segmentTarget): number[] {
  if (!keyframes) return Array.from({ length: Math.max(1, Math.ceil(duration / target - 0.01)) }, (_, i) => i * target);
  const starts = [0];
  for (const t of keyframes) {
    if (t - starts[starts.length - 1] >= target - 0.01 && duration - t >= 1) starts.push(t);
  }
  return starts;
}

const rate = (r?: string) => {
  const [a, b] = (r ?? "").split("/").map(Number);
  return a && b ? Math.round((a / b) * 1000) / 1000 : null;
};

/** The CODECS attribute for a copied stream: what Safari and Chromecast check before playing. */
export function codecString(s: ProbeStream): string {
  const level = Number(s.level) || 0;
  if (s.codec_name === "h264") {
    const profile = ({ baseline: "42", "constrained baseline": "42", main: "4d", high: "64", "high 10": "6e", "high 4:2:2": "7a" } as Record<string, string>)[(s.profile ?? "high").toLowerCase()] ?? "64";
    return `avc1.${profile}00${(level || 40).toString(16).padStart(2, "0")}`;
  }
  if (s.codec_name === "hevc") {
    const main10 = /10/.test(s.profile ?? "") || /10/.test(s.pix_fmt ?? "");
    return `hvc1.${main10 ? "2.4" : "1.6"}.L${level || 120}.B0`;
  }
  if (s.codec_name === "av1") return `av01.0.08M.${/10/.test(s.pix_fmt ?? "") ? "10" : "08"}`;
  return "avc1.640028";
}

const audioCodecs: Record<string, string> = { aac: "mp4a.40.2", eac3: "ec-3", ac3: "ac-3" };
const ladder: Rung[] = [{ height: 2160, width: 3840, kbps: 20000 }, { height: 1080, width: 1920, kbps: 6000 }, { height: 720, width: 1280, kbps: 3000 }, { height: 480, width: 854, kbps: 1200 }];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Why the screen can't take the video as it is, or null when it can. */
export function cannotCopy(s: ProbeStream, screen: Screen): string | null {
  const v = videoOf(s);
  if (v.codec === "other" || !screen.codecs.includes(v.codec)) return `${s.codec_name} isn't decoded here`;
  const pix = s.pix_fmt ?? "";
  if (!/^(yuvj?420p|yuv420p10le|nv12|p010le)$/.test(pix)) return `${pix} isn't decoded here`;
  if (v.codec === "h264" && v.tenBit) return "10-bit H.264 isn't decoded here";
  if (v.dvProfile === 5 && !screen.dvProfiles.includes(5)) return "Dolby Vision profile 5 needs tone-mapping";
  if (v.hdr === "hdr10" || (v.hdr === "dv" && v.dvProfile !== 5)) { if (!screen.hdr.includes("hdr10")) return "HDR needs tone-mapping"; }
  if (v.hdr === "hlg" && !screen.hdr.includes("hlg")) return "HLG needs tone-mapping";
  if ((s.height ?? 0) > screen.maxHeight * 1.1) return "too tall for this screen";
  return null;
}

const tagged = (s: ProbeStream, tags: string[]) => tags.includes((s.tags?.language ?? "").toLowerCase());

export function planHls(probe: Probe, grant: Pick<HlsGrant, "screen" | "audio" | "subtitles" | "burn">): HlsPlan {
  const duration = Number(probe.format.duration) || 0;
  const video = probe.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!video || !duration) throw new Error("There's no picture in this file.");
  const audios = probe.streams.filter((s) => s.codec_type === "audio");
  const audio = audios.find((s) => tagged(s, grant.audio)) ?? audios.find((s) => s.disposition?.default) ?? audios[0];

  /* Subtitles: the wanted language and kind is the default one. */
  const subs = probe.streams.filter((s) => s.codec_type === "subtitle");
  const signs = (s: ProbeStream) => (grant.subtitles?.signsTitles ?? ["signs", "songs", "forced"]).some((w) => (s.tags?.title ?? "").toLowerCase().includes(w));
  const wanted = (s: ProbeStream) => Boolean(grant.subtitles && tagged(s, grant.subtitles.tags) && signs(s) === (grant.subtitles.kind === "signs"));
  const text = subs.filter((s) => textSubtitles.includes(s.codec_name ?? "")).slice(0, 8);
  const wantedText = text.find(wanted);
  const wantedBitmap = subs.find((s) => bitmapSubtitles.includes(s.codec_name ?? "") && wanted(s));
  const burnStream = grant.burn ? (wantedText ?? wantedBitmap ?? null) : !wantedText && wantedBitmap ? wantedBitmap : null;
  const burn = burnStream ? { index: burnStream.index, bitmap: bitmapSubtitles.includes(burnStream.codec_name ?? "") } : null;

  const v = videoOf(video);
  const width = video.width ?? 1920, height = video.height ?? 1080;
  const frameRate = rate(video.avg_frame_rate) ?? rate(video.r_frame_rate);
  const copy = !burn && probe.keyframes && probe.keyframes.length > 1 && !cannotCopy(video, grant.screen);
  const hw = probe.hardware.kind;
  let plan: HlsPlan["video"];
  if (copy) {
    const bits = Number(probe.format.bit_rate) || (Number(probe.format.size) * 8) / duration || 8e6;
    plan = {
      index: video.index, mode: "copy", codec: v.codec, codecs: codecString(video), width, height, bandwidth: Math.round(bits * 1.25),
      range: v.hdr === "hlg" ? "HLG" : v.hdr ? "PQ" : "SDR", frameRate,
    };
  } else {
    /* Software encoding keeps to two sizes at 1080p or less; a GPU does the whole ladder. */
    const top = Math.min(height, grant.screen.maxHeight, hw === "software" || burn ? 1080 : 2160);
    let rungs = ladder.filter((r) => r.height <= top + 8);
    if (!rungs.length || rungs[0].height < top - 8) rungs = [{ height: even(top), width: 0, kbps: top >= 720 ? 3000 : 1200 }, ...rungs];
    if (hw === "software" || burn) rungs = rungs.slice(0, 2);
    rungs = rungs.map((r) => ({ ...r, width: even((width * r.height) / height) }));
    plan = { index: video.index, mode: "transcode", rungs, tonemap: Boolean(v.hdr), hwDecode: !burn && (v.codec === "hevc" || (v.codec === "h264" && !v.tenBit)), frameRate, tenBit: v.tenBit };
  }
  const passes = audio && (audio.codec_name === "aac" || ((audio.codec_name === "eac3" || audio.codec_name === "ac3") && grant.screen.passthrough.includes(audio.codec_name as AudioFormat)));
  return {
    duration,
    segments: segmentTimes(duration, copy ? probe.keyframes : null),
    video: plan,
    audio: audio ? { index: audio.index, mode: passes ? "copy" : "aac", codecs: passes ? audioCodecs[audio.codec_name ?? "aac"] : "mp4a.40.2" } : null,
    subtitles: text.filter((s) => s.index !== burn?.index).map((s) => ({
      index: s.index,
      name: s.tags?.title?.trim() || languageName(s.tags?.language) || `Subtitles ${s.index}`,
      language: s.tags?.language ?? "und",
      default: s === wantedText && !burn,
      forced: Boolean(s.disposition?.forced) || signs(s),
    })),
    burn,
  };
}

const names: Record<string, string> = { eng: "English", jpn: "Japanese", fre: "French", fra: "French", ger: "German", deu: "German", spa: "Spanish", ita: "Italian", por: "Portuguese", rus: "Russian", ara: "Arabic", chi: "Chinese", zho: "Chinese", kor: "Korean" };
const languageName = (tag?: string) => (tag ? names[tag.toLowerCase()] : undefined);

/* ───── ffmpeg ───── */

export type PackagerJob = {
  args: string[];
  /** The same in software, used when the GPU won't. */
  fallback?: string[];
  /** Run once before the first encode (extracting text subtitles to burn). */
  prepare?: string[][];
  outputs: { name: string; kind: "fmp4" | "vtt" }[];
  seekPad: number;
};

const movflags = "frag_keyframe+delay_moov+default_base_moof+frag_discont+negative_cts_offsets";

function tonemapFilter(hw: Hardware, format: string): string {
  if (hw.tonemapx !== false) return `tonemapx=tonemap=bt2390:desat=0:peak=100:t=bt709:m=bt709:p=bt709:format=${format}`;
  if (hw.zscale) return `zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=${format}`;
  return `format=${format}`;
}

/** The ffmpeg arguments for a plan: {input}, {start} and {dir} are the packager's to fill in; outputs are pipes 3, 4, … in order. */
export function ffmpegArgs(plan: HlsPlan, hardware: Hardware): PackagerJob {
  const outputs: PackagerJob["outputs"] = [];
  const v = plan.video;
  const renditions = v.mode === "copy" ? 1 : v.rungs.length;
  for (let i = 0; i < renditions; i++) outputs.push({ name: `v${i}`, kind: "fmp4" });
  plan.subtitles.forEach((_, i) => outputs.push({ name: `s${i}`, kind: "vtt" }));
  const build = (hw: Hardware) => args(plan, hw);
  const job: PackagerJob = { args: build(hardware), outputs, seekPad: v.mode === "copy" ? 0.25 : 0 };
  if (v.mode === "transcode" && hardware.kind !== "software") job.fallback = build({ ...hardware, kind: "software" });
  if (plan.burn && !plan.burn.bitmap) {
    job.prepare = [["-hide_banner", "-nostdin", "-v", "error", "-y", "-dump_attachment:t", "", "-i", "{input}", "-map", `0:${plan.burn.index}`, "-c:s", "ass", "{dir}/burn.ass"]];
  }
  return job;
}

function args(plan: HlsPlan, hw: Hardware): string[] {
  const v = plan.video;
  const input = ["-reconnect", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "5"];
  const pre: string[] = [];
  const graph: string[] = [];
  const perRung: { map: string; codec: string[] }[] = [];
  if (v.mode === "copy") {
    perRung.push({ map: `0:${v.index}`, codec: ["-c:v", "copy", ...(v.codec === "hevc" ? ["-tag:v", "hvc1"] : [])] });
  } else {
    const kind = plan.burn ? "software" : hw.kind;
    const dev = hw.device ?? "/dev/dri/renderD128";
    /* t counts from the seek point, which is always on the grid: keyframes land every six seconds of the file's own time. */
    const keys = ["-force_key_frames:v", `expr:gte(t,n_forced*${segmentTarget})`];
    const rate = (kbps: number) => ["-b:v", `${kbps}k`, "-maxrate", `${Math.round(kbps * 1.5)}k`, "-bufsize", `${kbps * 2}k`];
    let chain = `[0:${v.index}]`;
    let scale: (r: Rung) => string;
    let encoder: (r: Rung) => string[];
    if (kind === "nvenc") {
      pre.push("-init_hw_device", "cuda=cu:0", "-filter_hw_device", "cu", ...(v.hwDecode ? ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"] : []));
      chain += v.hwDecode ? (v.tonemap ? `hwdownload,format=p010le,${tonemapFilter(hw, "yuv420p")},hwupload_cuda` : "null") : `${v.tonemap ? tonemapFilter(hw, "yuv420p") : "format=yuv420p"},hwupload_cuda`;
      scale = (r) => `scale_cuda=${r.width}:${r.height}:format=yuv420p`;
      encoder = (r) => ["-c:v", "h264_nvenc", "-preset", "p4", "-profile:v", "high", "-rc", "vbr", ...rate(r.kbps), "-forced-idr", "1", "-g", "600"];
    } else if (kind === "qsv" || kind === "vaapi") {
      if (kind === "qsv") pre.push("-init_hw_device", `vaapi=va:${dev}`, "-init_hw_device", "qsv=qs@va", "-filter_hw_device", "qs", ...(v.hwDecode ? ["-hwaccel", "qsv", "-hwaccel_output_format", "qsv"] : []));
      else pre.push("-init_hw_device", `vaapi=va:${dev}`, "-filter_hw_device", "va", ...(v.hwDecode ? ["-hwaccel", "vaapi", "-hwaccel_output_format", "vaapi", "-hwaccel_device", "va"] : []));
      const upload = kind === "qsv" ? "hwupload=extra_hw_frames=64" : "hwupload";
      chain += v.hwDecode ? (v.tonemap ? `hwdownload,format=p010le,${tonemapFilter(hw, "nv12")},${upload}` : "null") : `${v.tonemap ? tonemapFilter(hw, "nv12") : "format=nv12"},${upload}`;
      scale = (r) => (kind === "qsv" ? `scale_qsv=w=${r.width}:h=${r.height}:format=nv12` : `scale_vaapi=w=${r.width}:h=${r.height}:format=nv12`);
      encoder = (r) => kind === "qsv"
        ? ["-c:v", "h264_qsv", "-preset", "veryfast", "-profile:v", "high", ...rate(r.kbps), "-look_ahead", "0", "-forced_idr", "1", "-g", "600"]
        : ["-c:v", "h264_vaapi", "-profile:v", "high", ...rate(r.kbps), "-g", "600"];
    } else {
      const picture = v.tonemap ? tonemapFilter(hw, "yuv420p") : "format=yuv420p";
      if (plan.burn?.bitmap) chain = `[0:${v.index}]${picture}[pic];[pic][0:${plan.burn.index}]overlay`;
      else if (plan.burn) chain += `${picture},subtitles=filename={dir}/burn.ass:fontsdir={dir}`;
      else chain += picture;
      scale = (r) => `scale=${r.width}:${r.height}:flags=bicubic`;
      encoder = (r) => ["-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p", ...rate(r.kbps), "-g", "600", "-sc_threshold", "0"];
    }
    const n = v.rungs.length;
    const split = n > 1 ? `,split=${n}${v.rungs.map((_, i) => `[s${i}]`).join("")}` : "[s0]";
    graph.push(`${chain}${split}`);
    v.rungs.forEach((r, i) => {
      graph.push(`[s${i}]${scale(r)}[v${i}]`);
      perRung.push({ map: `[v${i}]`, codec: [...encoder(r), ...keys] });
    });
  }
  const audio = plan.audio
    ? ["-map", `0:${plan.audio.index}`, ...(plan.audio.mode === "copy" ? ["-c:a", "copy"] : ["-c:a", "aac", "-ac", "2", "-b:a", "192k"])]
    : [];
  const out: string[] = ["-hide_banner", "-nostdin", "-v", "error", ...pre, ...input, "-ss", "{start}", "-i", "{input}",
    "-copyts", "-start_at_zero", "-avoid_negative_ts", "disabled", "-max_muxing_queue_size", "4096", "-map_metadata", "-1", "-map_chapters", "-1"];
  if (graph.length) out.push("-filter_complex", graph.join(";"));
  let fd = 3;
  for (const r of perRung) {
    out.push("-map", r.map, ...r.codec, ...audio, "-f", "mp4", "-movflags", movflags, "-use_editlist", "0", `pipe:${fd++}`);
  }
  for (const s of plan.subtitles) out.push("-map", `0:${s.index}`, "-c:s", "webvtt", "-f", "webvtt", `pipe:${fd++}`);
  return out;
}

/* ───── Playlists ───── */

const quote = (s: string) => s.replace(/["\n\r]/g, "'");

/*
 * Playlists name everything relative to themselves: the sealed token is a
 * couple of kilobytes, and a film's media playlist lists a thousand segments.
 * Every player resolves them against the playlist's own address.
 */
export function masterPlaylist(plan: HlsPlan): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"];
  plan.subtitles.forEach((s, i) => {
    lines.push(`#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${quote(s.name)}",LANGUAGE="${quote(s.language)}",DEFAULT=${s.default ? "YES" : "NO"},AUTOSELECT=${s.default || !s.forced ? "YES" : "NO"},FORCED=NO,URI="s${i}.m3u8"`);
  });
  const subs = plan.subtitles.length ? `,SUBTITLES="subs",CLOSED-CAPTIONS=NONE` : "";
  const audio = plan.audio ? `,${plan.audio.codecs}` : "";
  const v = plan.video;
  const fps = v.frameRate ? `,FRAME-RATE=${v.frameRate.toFixed(3)}` : "";
  if (v.mode === "copy") {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},CODECS="${v.codecs}${audio}",RESOLUTION=${v.width}x${v.height}${fps},VIDEO-RANGE=${v.range}${subs}`, "v0.m3u8");
  } else {
    v.rungs.forEach((r, i) => {
      const avc = r.height > 1080 ? "avc1.640033" : r.height > 720 ? "avc1.640028" : "avc1.64001f";
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${Math.round(r.kbps * 1500 + 200_000)},AVERAGE-BANDWIDTH=${r.kbps * 1000 + 192_000},CODECS="${avc}${audio}",RESOLUTION=${r.width}x${r.height}${fps},VIDEO-RANGE=SDR${subs}`, `v${i}.m3u8`);
    });
  }
  return lines.join("\n") + "\n";
}

function segmentList(plan: HlsPlan, uri: (k: number) => string, map?: string): string {
  const lengths = plan.segments.map((t, k) => (plan.segments[k + 1] ?? plan.duration) - t);
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...lengths))}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-INDEPENDENT-SEGMENTS"];
  if (map) lines.push(`#EXT-X-MAP:URI="${map}"`);
  lengths.forEach((d, k) => lines.push(`#EXTINF:${d.toFixed(3)},`, uri(k)));
  lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}

export const mediaPlaylist = (plan: HlsPlan, n: number) => segmentList(plan, (k) => `v${n}/${k}.m4s`, `v${n}/init.mp4`);
export const subtitlePlaylist = (plan: HlsPlan, n: number) => segmentList(plan, (k) => `s${n}/${k}.vtt`);

/** What a request under an HLS address is for; null for anything else. */
export function hlsPath(path: string[], plan: Pick<HlsPlan, "video" | "subtitles" | "segments">):
  | { kind: "master" } | { kind: "playlist"; output: string } | { kind: "file"; output: string; file: string } | null {
  const renditions = plan.video.mode === "copy" ? 1 : plan.video.rungs.length;
  const valid = (o: string) => (/^v\d+$/.test(o) && Number(o.slice(1)) < renditions) || (/^s\d+$/.test(o) && Number(o.slice(1)) < plan.subtitles.length);
  if (path.length === 1 && path[0] === "main.m3u8") return { kind: "master" };
  if (path.length === 1) {
    const m = /^([vs]\d+)\.m3u8$/.exec(path[0]);
    return m && valid(m[1]) ? { kind: "playlist", output: m[1] } : null;
  }
  if (path.length === 2 && valid(path[0])) {
    const video = path[0][0] === "v";
    const m = /^(\d{1,6})\.(m4s|vtt)$/.exec(path[1]);
    if (video && path[1] === "init.mp4") return { kind: "file", output: path[0], file: path[1] };
    if (m && Number(m[1]) < plan.segments.length && (m[2] === "m4s") === video) return { kind: "file", output: path[0], file: path[1] };
  }
  return null;
}
