/**
 * How fast each source really is. The relay sees every byte, so it times the
 * opening burst of each stream (a player fills its buffer as fast as it can
 * before settling to the picture's pace) and keeps a running figure per
 * source: Usenet through nzbdav, and the debrid service. The picker then
 * prefers versions a source can sustain, so a slow path is used only when
 * nothing faster has the title, and a source that speeds up wins again.
 *
 * Pure, tested in scripts/test-watch.mjs.
 */
import type { DatabaseSync } from "node:sqlite";
import { readState, writeState } from "./model";

export type Source = "usenet" | "debrid";
export type SourceSpeed = { mbps: number; firstByteMs: number; samples: number; at: number };
export type Speeds = Partial<Record<Source, SourceSpeed>>;

/** Only the opening burst is timed: after it, players read at the picture's pace, which says nothing about the source. */
export const burstBytes = 8 * 1024 * 1024;
const minBytes = 2 * 1024 * 1024;

/** A source's figure after one more timed burst: recent ones count most, and an old figure fades after a few hours. */
export function nextSpeed(prev: SourceSpeed | undefined, sample: { mbps: number; firstByteMs: number }, now = Date.now()): SourceSpeed {
  if (!prev) return { ...sample, samples: 1, at: now };
  const ageHours = (now - prev.at) / 3_600_000;
  const weight = Math.min(0.6, 0.3 + ageHours * 0.1);
  const mix = (a: number, b: number) => a * (1 - weight) + b * weight;
  return { mbps: mix(prev.mbps, sample.mbps), firstByteMs: mix(prev.firstByteMs, sample.firstByteMs), samples: prev.samples + 1, at: now };
}

/** A timed burst as a sample, or null when too little came through to say anything. */
export function sampleOf(bytes: number, firstByteMs: number, burstMs: number): { mbps: number; firstByteMs: number } | null {
  if (bytes < minBytes || burstMs < 200) return null;
  return { mbps: (bytes * 8) / (burstMs / 1000) / 1e6, firstByteMs };
}

/**
 * What a release needs from its source to play without stalling: its
 * bitrate when known, else a typical one for its picture, with headroom.
 */
export function needed(r: { height: number; mbps?: number | null }, listedOrEstimated: number | null): number {
  const typical = r.height >= 2160 ? 20 : r.height >= 1080 ? 8 : r.height >= 720 ? 4 : 2;
  return (listedOrEstimated ?? typical) * 1.25;
}

/**
 * How a source's speed moves a release in the ranking: far down when the
 * source can't keep up with it, a little down when it starts slowly, nothing
 * when unknown (so a new source gets tried).
 */
export function speedScore(speed: SourceSpeed | undefined, need: number, now = Date.now()): number {
  if (!speed || speed.samples < 1 || now - speed.at > 24 * 3_600_000) return 0;
  let s = 0;
  if (speed.mbps < need) s -= 300 * Math.min(1, (need - speed.mbps) / need + 0.3);
  if (speed.firstByteMs > 8000) s -= 60;
  else if (speed.firstByteMs > 4000) s -= 25;
  return s;
}

export const speedsOf = (db: DatabaseSync): Speeds => readState<Speeds>(db, "source-speeds") ?? {};
export function recordSpeed(db: DatabaseSync, source: Source, sample: { mbps: number; firstByteMs: number }, now = Date.now()) {
  const speeds = speedsOf(db);
  speeds[source] = nextSpeed(speeds[source], sample, now);
  writeState(db, "source-speeds", speeds);
}

/**
 * Passes a stream through unchanged while timing its opening burst; calls
 * back once with what it saw (when the burst ends, or the player hangs up).
 */
export function meter(body: ReadableStream<Uint8Array>, startedAt: number, done: (bytes: number, firstByteMs: number, burstMs: number) => void, clock: () => number = () => performance.now()): ReadableStream<Uint8Array> {
  let bytes = 0, first = 0, reported = false;
  const report = () => { if (reported || !first) return; reported = true; done(bytes, first - startedAt, clock() - first); };
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (!first) first = clock();
      if (!reported) { bytes += chunk.byteLength; if (bytes >= burstBytes) report(); }
      controller.enqueue(chunk);
    },
    flush() { report(); },
    cancel() { report(); },
  } as Transformer<Uint8Array, Uint8Array>));
}
