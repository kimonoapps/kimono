"use client";

import { useCallback, useSyncExternalStore } from "react";

/*
 * My apps: the apps a person keeps close, in their order. The list is kept on
 * the server (/api/v1/me/apps) so the rail here and the flower on the phone
 * agree. The page arrives with it; a change shows at once everywhere on the
 * page and is saved behind it. Other tabs hear of it through storage.
 */
const ECHO = "kimono-my-apps";

let current: string[] | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key !== ECHO || !event.newValue) return;
    try { current = JSON.parse(event.newValue).apps; tell(); } catch { /* not ours */ }
  };
  window.addEventListener("storage", fromOtherTab);
  return () => { listeners.delete(onChange); window.removeEventListener("storage", fromOtherTab); };
}

/* Only ever in the browser (the server reads its own snapshot): there, this module is shared by everyone signed in. */
function seeded(fromServer: string[]) {
  if (current === null) current = fromServer;
  return current;
}

let saving: Promise<unknown> = Promise.resolve();
function save(next: string[]) {
  current = next;
  tell();
  try { localStorage.setItem(ECHO, JSON.stringify({ apps: next, at: Date.now() })); } catch { /* storage refused: other tabs catch up on their next page */ }
  saving = saving.catch(() => {}).then(() => fetch("/api/v1/me/apps", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apps: next }) }));
}

/** My apps, starting from what the server sent with the page. */
export function usePins(fromServer: string[]) {
  const pins = useSyncExternalStore(subscribe, () => seeded(fromServer), () => fromServer);
  const setPins = useCallback((next: string[]) => save(next), []);
  return [pins, setPins] as const;
}
