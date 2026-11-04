"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/*
 * Apps a person pins to the rail, in their order. Kept in this browser for
 * now; the rail and Home's grid share it, so pinning in one shows in the other.
 */
const KEY = "kimono-pins";
const EVENT = "kimono-pins";

function read(fallback: string[]): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : fallback;
  } catch {
    return fallback;
  }
}

let cache: { raw: string | null; value: string[] } | null = null;
function snapshot(fallback: string[]) {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* storage refused: pins live for this page only */ }
  if (!cache || cache.raw !== raw) cache = { raw, value: read(fallback) };
  return cache.value;
}

export function usePins(defaults: string[]) {
  const key = defaults.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the list is compared by content
  const fallback = useMemo(() => defaults, [key]);
  const pins = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(EVENT, onChange);
      window.addEventListener("storage", onChange);
      return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener("storage", onChange); };
    },
    () => snapshot(fallback),
    () => fallback,
  );
  const setPins = useCallback((next: string[]) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage refused */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [pins, setPins] as const;
}

