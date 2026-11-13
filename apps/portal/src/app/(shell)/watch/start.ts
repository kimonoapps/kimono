/*
 * The start ring's progress, by time (the phone app's StartClock.kt does the
 * same). Starting has three steps: finding a copy (the server), opening it
 * (the server preparing the stream from the source's first bytes: most of
 * the wait) and buffering. Nothing reports progress inside the middle one,
 * so the ring shares itself out by how long each step really took in this
 * browser lately (the median of the last plays, kept in localStorage) and
 * moves through each step at that pace: steadily to most of its share by the
 * time it usually ends, then creeping, and on only when it's really done.
 * Buffering also follows the buffer itself.
 */

/** Typical milliseconds per step before this browser has played anything. */
const defaults = [2500, 14000, 3000];
const kept = "kw.startTimes";

export type StartHistory = number[][];

export function shares(expected: number[]): number[] {
  const total = expected.reduce((a, b) => a + Math.max(1, b), 0);
  const floored = expected.map((e) => Math.max(Math.max(1, e) / total, 0.1));
  const sum = floored.reduce((a, b) => a + b, 0);
  return floored.map((f) => f / sum);
}

/** How far through a step it looks after `elapsed` of an `expected`: 85% by then, then creeping to 95%. */
export function within(elapsed: number, expected: number): number {
  const x = elapsed / Math.max(1, expected);
  return x <= 1 ? 0.85 * x : 0.85 + 0.1 * (1 - Math.exp(-(x - 1) * 1.5));
}

/** The ring, 0–1, at `step` (0–2; 3 is done), `elapsed` into it; `fill` is the buffer's own 0–1 in the last step. */
export function ringValue(step: number, elapsed: number, fill: number, expected: number[]): number {
  if (step >= 3) return 1;
  const s = shares(expected);
  const done = s.slice(0, step).reduce((a, b) => a + b, 0);
  const inside = Math.max(within(elapsed, expected[step]), step === 2 ? Math.min(1, Math.max(0, fill)) : 0);
  return Math.min(0.99, done + s[step] * inside);
}

const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

export function loadStarts(): StartHistory {
  try {
    const raw = JSON.parse(localStorage.getItem(kept) ?? "null") as unknown;
    if (Array.isArray(raw) && raw.length === 3 && raw.every((l) => Array.isArray(l))) return (raw as number[][]).map((l) => l.filter((n) => Number.isFinite(n)).slice(-7));
  } catch { /* fresh */ }
  return [[], [], []];
}

export const expectedOf = (history: StartHistory) => history.map((l, i) => (l.length ? median(l) : defaults[i]));

/** Notes how long a step took, for next time; under 50 ms it was already done, not measured. */
export function noteStep(history: StartHistory, step: number, took: number): StartHistory {
  if (step < 0 || step > 2 || took < 50) return history;
  const next = history.map((l, i) => (i === step ? [...l, Math.round(took)].slice(-7) : l));
  try { localStorage.setItem(kept, JSON.stringify(next)); } catch { /* kept for this visit only */ }
  return next;
}
