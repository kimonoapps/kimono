"use client";

import { useEffect } from "react";

/*
 * The tab names what's open: "{name} · {app}" — a chat, a folder, a note, a
 * book, a show — and just "{app}" when nothing is. The latest one shown wins,
 * and closing it puts back the one before.
 *
 * Next writes the page's own title into <head> when it moves between views of
 * a page (Drive → Recent), after the views' effects have run, so while a name
 * is shown its title is put back whenever <head> changes. Only on that page:
 * leaving the app leaves the tab to the next page.
 */

type Shown = { key: number; name: string; app: string; path: string };
const shown: Shown[] = [];
let lastKey = 0;
let lastSet: string | null = null;
let watching: MutationObserver | null = null;

const titleOf = (item: Shown) => `${item.name} · ${item.app}`;

function keep() {
  const top = shown.at(-1);
  if (!top || location.pathname !== top.path || document.title === titleOf(top)) return;
  lastSet = titleOf(top);
  document.title = lastSet;
}

function watch() {
  if (shown.length && !watching) {
    watching = new MutationObserver(keep);
    watching.observe(document.head, { subtree: true, childList: true, characterData: true });
  } else if (!shown.length && watching) {
    watching.disconnect();
    watching = null;
  }
}

export function useTabTitle(name: string | null | undefined, app: string) {
  useEffect(() => {
    const trimmed = name?.trim();
    if (!trimmed) return;
    const item = { key: ++lastKey, name: trimmed, app, path: location.pathname };
    shown.push(item);
    keep();
    watch();
    return () => {
      const at = shown.findIndex((other) => other.key === item.key);
      if (at >= 0) shown.splice(at, 1);
      if (shown.length) keep();
      /* Nothing named any more: back to the app's own name, unless the tab has moved on. */
      else if (location.pathname === item.path && document.title === lastSet) document.title = app;
      watch();
    };
  }, [name, app]);
}
