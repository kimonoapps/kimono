import type { Play } from "./api";

/*
 * What the <video> opens. Browsers can't open Matroska, so the HLS address
 * comes first once the server offers it (Safari plays HLS itself); until
 * then the relayed file plays as it is, which works for MP4 and WebM.
 */

export type Attached = { kind: "hls-native" | "file"; detach: () => void };

export const nativeHls = (video: HTMLVideoElement) => video.canPlayType("application/vnd.apple.mpegurl") !== "";

export function attach(video: HTMLVideoElement, play: Play): Attached {
  const src = play.hls && nativeHls(video) ? play.hls : play.url;
  video.src = src;
  video.load();
  return { kind: src === play.url ? "file" : "hls-native", detach: () => { video.removeAttribute("src"); video.load(); } };
}

/** The address a second, hidden <video> can open for scrubber pictures; null where it can't. */
export const thumbSource = (video: HTMLVideoElement, play: Play) => (play.hls && nativeHls(video) ? play.hls : play.url);
