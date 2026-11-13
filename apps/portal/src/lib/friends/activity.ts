/**
 * 友 What friends are up to, for Kimono's Home: what they're watching now and
 * watched lately, what they're reading and have read, and what they sent you.
 *
 * Each app hands in what it has (lib/watch, lib/books, the recommendations
 * here); this keeps only what each friend lets friends see, the latest first:
 *  - only friends, and never anyone gone invisible;
 *  - not an app they keep off their profile, nor a row they keep to themselves
 *    (Watched covers watching and watched; Books' Reading now and Read);
 *  - on Watch, nothing while they don't share what they watch, and never a
 *    title they watched invisibly.
 * A recommendation was sent to you, so their app and row switches don't hide it.
 *
 * Pure logic over SQLite, tested in scripts/test-friends.mjs; ./index.ts serves it.
 */
import type { DatabaseSync } from "node:sqlite";
import { areFriends, hiddenAppsOf, isInvisible, isOffProfile, keptOf, offProfileOf } from "./model";

export type ActivityKind = "watching" | "watched" | "reading" | "read" | "recommended";

export type Activity = {
  kind: ActivityKind; app: string; from: string;
  itemId: string; title: string; subtitle: string | null; cover: string | null; href: string | null;
  at: number;
  /** 0–1 through it (an episode, a book). */
  progress?: number | null;
  /** Where they are ("S1:E3"). */
  label?: string | null;
  note?: string | null;
};

/** The profile row each kind comes from: kept back, it isn't shown. */
export const rowOfKind: Record<ActivityKind, string | null> = {
  watching: "watch:watched", watched: "watch:watched", reading: "books:reading", read: "books:read", recommended: null,
};

/** Watch's own switches: whether someone shares what they watch, and the titles they watched invisibly. */
export type WatchShare = { sharing: (username: string) => boolean; hidden: (username: string) => Set<string> };

export function friendsActivity(
  db: DatabaseSync, me: string, items: Activity[], watch: WatchShare | null,
  { limit = 8, perFriend = 3, since = 0 }: { limit?: number; perFriend?: number; since?: number } = {},
): Activity[] {
  const u = me.toLowerCase();
  const known = new Map<string, { ok: boolean; apps: string[]; kept: string[]; sharing: boolean; hidden: Set<string>; off: Set<string> }>();
  const of = (f: string) => {
    let p = known.get(f);
    if (!p) {
      const ok = f !== u && areFriends(db, u, f) && !isInvisible(db, f);
      p = ok
        ? { ok, apps: hiddenAppsOf(db, f), kept: keptOf(db, f), sharing: watch?.sharing(f) ?? false, hidden: watch?.hidden(f) ?? new Set(), off: offProfileOf(db, f) }
        : { ok, apps: [], kept: [], sharing: false, hidden: new Set(), off: new Set() };
      known.set(f, p);
    }
    return p;
  };
  const shown = (a: Activity) => {
    const p = of(a.from.toLowerCase());
    if (!p.ok || a.at < since) return false;
    if (a.kind === "recommended") return true;
    if (p.apps.includes(a.app)) return false;
    const row = rowOfKind[a.kind];
    if (row && p.kept.includes(row)) return false;
    /* Taken off their profile. */
    if (row && isOffProfile(p.off, row, a.itemId)) return false;
    if (a.app === "watch" && (!p.sharing || p.hidden.has(a.itemId))) return false;
    return true;
  };
  const seen = new Set<string>();
  const count = new Map<string, number>();
  const out: Activity[] = [];
  for (const a of [...items].sort((x, y) => y.at - x.at)) {
    const f = a.from.toLowerCase();
    const key = `${f}\n${a.app}\n${a.itemId}`;
    if (seen.has(key) || !shown(a)) continue;
    seen.add(key);
    if ((count.get(f) ?? 0) >= perFriend) continue;
    count.set(f, (count.get(f) ?? 0) + 1);
    out.push({ ...a, from: f });
    if (out.length >= limit) break;
  }
  return out;
}
