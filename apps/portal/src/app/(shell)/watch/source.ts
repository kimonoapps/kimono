import type { Play } from "./api";

/*
 * What the <video> opens. Browsers can't open Matroska, so the HLS address
 * comes first when the server offers it: Safari plays HLS itself, the rest go
 * through hls.js (loaded only then). Without HLS the relayed file plays as it
 * is, which works for MP4 and WebM.
 */

type Hls = import("hls.js").default;
export type Track = { id: number; label: string; language: string };
export type Attached = {
  kind: "hls-native" | "hls-js" | "file";
  /** Audio and subtitle tracks hls.js knows of; native players use the element's own lists. */
  audio: () => Track[];
  subtitles: () => Track[];
  audioNow: () => number;
  subtitleNow: () => number;
  setAudio: (id: number) => void;
  setSubtitles: (id: number) => void;
  detach: () => void;
};

export const nativeHls = (video: HTMLVideoElement) => video.canPlayType("application/vnd.apple.mpegurl") !== "";

const plain = (kind: Attached["kind"], video: HTMLVideoElement): Attached => ({
  kind, audio: () => [], subtitles: () => [], audioNow: () => -1, subtitleNow: () => -1, setAudio: () => {}, setSubtitles: () => {},
  detach: () => { video.removeAttribute("src"); video.load(); },
});

/** hls.js where the browser has Media Source (it handles every rendition the same way); the browser's own HLS only where it hasn't, as on an iPhone. */
const viaHlsJs = () => typeof window !== "undefined" && (typeof MediaSource !== "undefined" || "ManagedMediaSource" in window);

/** startAt: where playback will begin, so the first segment asked for is that one, not the opening (the packager encodes wherever it's asked). */
export async function attach(video: HTMLVideoElement, play: Play, onFatal: () => void, startAt = 0): Promise<Attached> {
  if (play.hls && viaHlsJs()) {
    const { default: Hls } = await import("hls.js");
    if (Hls.isSupported()) {
      /* The packager can take 5–20 s for a first segment: wait for it rather than give up. */
      const patient = { maxTimeToFirstByteMs: 30_000, maxLoadTimeMs: 120_000, timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 }, errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 } };
      /* The playlists come from the Portal, which has already waited on the source: a copy it calls gone (404, 410) or too slow (503) is asked about once, not seven times. */
      const settled = (code: unknown) => code === 404 || code === 410 || code === 503;
      const playlists = { ...patient, errorRetry: { ...patient.errorRetry, shouldRetry: (_c: unknown, _n: number, _t: boolean, response: { code?: number } | undefined, retry: boolean) => retry && !settled(response?.code) } };
      const hls: Hls = new Hls({ enableWorker: true, backBufferLength: 60, maxBufferLength: 40, fragLoadPolicy: { default: patient }, playlistLoadPolicy: { default: playlists }, manifestLoadPolicy: { default: playlists }, ...(startAt > 0 ? { startPosition: startAt } : {}) });
      /* A stream the server can't read keeps failing: after a few tries it's this version that's broken, not the network. */
      let failures = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        /* This version won't play: straight to the next, without loading its playlist again. */
        if (settled(data.response?.code) && (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR)) { onFatal(); return; }
        if (++failures > 3) { onFatal(); return; }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else onFatal();
      });
      hls.on(Hls.Events.FRAG_LOADED, () => { failures = 0; });
      hls.loadSource(play.hls);
      hls.attachMedia(video);
      hls.subtitleDisplay = false;
      /* hls.js drops the segment it is loading only when a seek goes past it; seeking back, it would first wait for
         that one (often the packager's next, still being made) before asking for where you went. */
      const seeking = () => {
        const t = video.currentTime, b = video.buffered;
        for (let i = 0; i < b.length; i++) if (t >= b.start(i) && t < b.end(i) - 0.5) return;
        hls.stopLoad();
        hls.startLoad(t);
      };
      video.addEventListener("seeking", seeking);
      const named = (list: { name: string; lang?: string }[]) => list.map((t, id) => ({ id, label: t.name, language: t.lang ?? "" }));
      return {
        kind: "hls-js",
        audio: () => named(hls.audioTracks),
        subtitles: () => named(hls.subtitleTracks),
        audioNow: () => hls.audioTrack,
        subtitleNow: () => hls.subtitleTrack,
        setAudio: (id) => { hls.audioTrack = id; },
        setSubtitles: (id) => { hls.subtitleTrack = id; },
        detach: () => { video.removeEventListener("seeking", seeking); hls.destroy(); video.removeAttribute("src"); video.load(); },
      };
    }
  }
  if (play.hls && nativeHls(video)) {
    video.src = startAt > 0 ? `${play.hls}#t=${Math.floor(startAt)}` : play.hls;
    video.load();
    return plain("hls-native", video);
  }
  video.src = play.url;
  video.load();
  return plain("file", video);
}

/**
 * Opens the same stream in a second, hidden <video> for the scrubber's
 * pictures: at the lowest quality where hls.js plays it. Gives back how to let go.
 */
export function attachThumb(thumb: HTMLVideoElement, play: Play): () => void {
  const clear = () => { thumb.removeAttribute("src"); thumb.load(); };
  if (!play.hls || !viaHlsJs()) { thumb.src = play.hls ?? play.url; return clear; }
  let hls: Hls | null = null, gone = false;
  void import("hls.js").then(({ default: Hls }) => {
    if (gone) return;
    if (!Hls.isSupported()) { thumb.src = play.hls!; return; }
    hls = new Hls({ startLevel: 0, capLevelToPlayerSize: true, maxBufferLength: 4, maxMaxBufferLength: 8, backBufferLength: 0 });
    hls.loadSource(play.hls!);
    hls.attachMedia(thumb);
  });
  return () => { gone = true; hls?.destroy(); clear(); };
}
