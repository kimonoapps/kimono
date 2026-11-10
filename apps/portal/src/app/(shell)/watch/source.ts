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

export async function attach(video: HTMLVideoElement, play: Play, onFatal: () => void): Promise<Attached> {
  if (play.hls && viaHlsJs()) {
    const { default: Hls } = await import("hls.js");
    if (Hls.isSupported()) {
      const hls: Hls = new Hls({ enableWorker: true, backBufferLength: 60, maxBufferLength: 40 });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else onFatal();
      });
      hls.loadSource(play.hls);
      hls.attachMedia(video);
      hls.subtitleDisplay = false;
      const named = (list: { name: string; lang?: string }[]) => list.map((t, id) => ({ id, label: t.name, language: t.lang ?? "" }));
      return {
        kind: "hls-js",
        audio: () => named(hls.audioTracks),
        subtitles: () => named(hls.subtitleTracks),
        audioNow: () => hls.audioTrack,
        subtitleNow: () => hls.subtitleTrack,
        setAudio: (id) => { hls.audioTrack = id; },
        setSubtitles: (id) => { hls.subtitleTrack = id; },
        detach: () => { hls.destroy(); video.removeAttribute("src"); video.load(); },
      };
    }
  }
  if (play.hls && nativeHls(video)) {
    video.src = play.hls;
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
