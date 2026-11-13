/**
 * 友 Friends, profiles and recommendations: Kimono's, not one app's.
 *
 * Friendship: anyone can ask anyone; once the other says yes they're friends.
 * Asking someone who already asked you makes you friends. No (or taking an
 * ask back, or unfriending) forgets the link.
 *
 * A profile is a short bio plus shelves apps fill in (Books: favourites and
 * currently reading). Watch's shelves are worked out from what's watched and
 * rated, so they aren't kept here.
 *
 * A recommendation is one title from one app (`app` + `itemId`, with a small
 * snapshot of its name and cover so it shows without that app), sent to a
 * friend or put on your own profile, with a note if you like.
 *
 * Pure logic over SQLite, tested in scripts/test-friends.mjs; ./index.ts serves it.
 */
import type { DatabaseSync } from "node:sqlite";

export function migrateSocial(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS friends (a TEXT NOT NULL, b TEXT NOT NULL, asked_by TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (a, b));
    CREATE INDEX IF NOT EXISTS friends_b ON friends (b);
    CREATE TABLE IF NOT EXISTS profiles (username TEXT PRIMARY KEY, bio TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS shelves (username TEXT NOT NULL, app TEXT NOT NULL, shelf TEXT NOT NULL, item_id TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, cover TEXT, at INTEGER NOT NULL, PRIMARY KEY (username, app, shelf, item_id));
    CREATE TABLE IF NOT EXISTS recommendations (id TEXT PRIMARY KEY, from_user TEXT NOT NULL, to_user TEXT, app TEXT NOT NULL, item_id TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, cover TEXT, note TEXT, at INTEGER NOT NULL, seen_at INTEGER, dismissed_at INTEGER);
    CREATE INDEX IF NOT EXISTS recommendations_to ON recommendations (to_user);
    CREATE INDEX IF NOT EXISTS recommendations_from ON recommendations (from_user);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
}

export class FriendsProblem extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/* ───── Friendship ───── */

const pair = (x: string, y: string): [string, string] => { const a = x.toLowerCase(), b = y.toLowerCase(); return a < b ? [a, b] : [b, a]; };

/** "friends"; "asked": they asked you; "asking": you asked them. */
export type LinkState = "friends" | "asked" | "asking";
export type Link = { username: string; state: LinkState; at: number };

type Row = { a: string; b: string; asked_by: string; state: string; at: number };

export function linksOf(db: DatabaseSync, me: string): Link[] {
  const u = me.toLowerCase();
  const rows = db.prepare("SELECT * FROM friends WHERE a = ? OR b = ? ORDER BY at DESC").all(u, u) as Row[];
  return rows.map((r) => {
    const other = r.a === u ? r.b : r.a;
    const state: LinkState = r.state === "friends" ? "friends" : r.asked_by === u ? "asking" : "asked";
    return { username: other, state, at: Number(r.at) };
  });
}

export function linkOf(db: DatabaseSync, me: string, them: string): LinkState | null {
  const [a, b] = pair(me, them);
  const r = db.prepare("SELECT * FROM friends WHERE a = ? AND b = ?").get(a, b) as Row | undefined;
  if (!r) return null;
  return r.state === "friends" ? "friends" : r.asked_by === me.toLowerCase() ? "asking" : "asked";
}

export const areFriends = (db: DatabaseSync, x: string, y: string) => linkOf(db, x, y) === "friends";
export const friendsOf = (db: DatabaseSync, me: string) => linksOf(db, me).filter((l) => l.state === "friends").map((l) => l.username);

/** Asks to be friends; when they already asked, it's a yes. Answers what it is now. */
export function askFriend(db: DatabaseSync, me: string, them: string, now = Date.now()): LinkState {
  const u = me.toLowerCase(), t = them.toLowerCase();
  if (!t || u === t) throw new Error("self");
  const state = linkOf(db, u, t);
  if (state === "friends" || state === "asking") return state;
  const [a, b] = pair(u, t);
  if (state === "asked") { db.prepare("UPDATE friends SET state = 'friends', at = ? WHERE a = ? AND b = ?").run(now, a, b); return "friends"; }
  db.prepare("INSERT INTO friends (a, b, asked_by, state, at) VALUES (?, ?, ?, 'asked', ?)").run(a, b, u, now);
  return "asking";
}

/** Says yes or no to someone who asked. No forgets the link. */
export function answerFriend(db: DatabaseSync, me: string, them: string, yes: boolean, now = Date.now()): LinkState | null {
  const state = linkOf(db, me, them);
  if (state !== "asked") return state;
  if (yes) return askFriend(db, me, them, now);
  removeFriend(db, me, them);
  return null;
}

export function removeFriend(db: DatabaseSync, me: string, them: string) {
  const [a, b] = pair(me, them);
  db.prepare("DELETE FROM friends WHERE a = ? AND b = ?").run(a, b);
  /* What they sent each other goes with the friendship. */
  db.prepare("DELETE FROM recommendations WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)").run(a, b, b, a);
}

/**
 * Brings in friendships kept somewhere else before (Watch's own table), once:
 * a link already here stays as it is, and nothing is ever dropped.
 */
export function importFriends(db: DatabaseSync, rows: Row[], marker: string): number {
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(marker)) return 0;
  let added = 0;
  const insert = db.prepare("INSERT OR IGNORE INTO friends (a, b, asked_by, state, at) VALUES (?, ?, ?, ?, ?)");
  for (const r of rows) {
    const [a, b] = pair(String(r.a), String(r.b));
    if (!a || a === b) continue;
    added += Number(insert.run(a, b, String(r.asked_by).toLowerCase(), r.state === "friends" ? "friends" : "asked", Number(r.at) || 0).changes);
  }
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(marker, String(added));
  return added;
}

/* ───── Profiles ───── */

export const bioLimit = 280;

export function bioOf(db: DatabaseSync, username: string): string {
  return (db.prepare("SELECT bio FROM profiles WHERE username = ?").get(username.toLowerCase()) as { bio?: string } | undefined)?.bio ?? "";
}

export function setBio(db: DatabaseSync, username: string, bio: unknown, now = Date.now()): string {
  if (typeof bio !== "string") throw new FriendsProblem("Write a few words.");
  const clean = bio.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if ([...clean].length > bioLimit) throw new FriendsProblem(`Keep it under ${bioLimit} characters.`);
  db.prepare("INSERT INTO profiles (username, bio, updated_at) VALUES (?, ?, ?) ON CONFLICT (username) DO UPDATE SET bio = excluded.bio, updated_at = excluded.updated_at").run(username.toLowerCase(), clean, now);
  return clean;
}

/** A title from one app, as a profile or a recommendation shows it. */
export type Item = { app: string; itemId: string; title: string; subtitle: string | null; cover: string | null };

/** The apps whose titles can be shared, and the shelves each keeps on a profile here. */
export const apps: Record<string, { name: string; shelves: Record<string, string> }> = {
  watch: { name: "Watch", shelves: {} },
  books: { name: "Books", shelves: { reading: "Reading now", favourites: "Favourite books" } },
};
export const shelfSize = 24;

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
/** A cover is an address on the web or on this Portal; anything else is left out. */
const coverOf = (value: unknown) => {
  const v = text(value, 1000);
  return /^https?:\/\/[^\s]+$/i.test(v) || /^\/[^\s/][^\s]*$/.test(v) ? v : null;
};

/** What a request says about a title, checked: a known app, an id and a name. */
export function itemOf(raw: Record<string, unknown>): Item {
  const app = text(raw.app, 40).toLowerCase();
  if (!apps[app]) throw new FriendsProblem("That app's titles can't be shared.");
  const itemId = text(raw.itemId, 200);
  const title = text(raw.title, 200);
  if (!itemId || !title) throw new FriendsProblem("Pick something to share.");
  return { app, itemId, title, subtitle: text(raw.subtitle, 200) || null, cover: coverOf(raw.cover) };
}

type ShelfRow = { app: string; shelf: string; item_id: string; title: string; subtitle: string | null; cover: string | null; at: number };
const itemFrom = (r: { app: string; item_id: string; title: string; subtitle: string | null; cover: string | null }): Item =>
  ({ app: r.app, itemId: r.item_id, title: r.title, subtitle: r.subtitle ?? null, cover: r.cover ?? null });

/** Someone's kept shelves, by app then shelf, the latest first. */
export function shelvesOf(db: DatabaseSync, username: string): Record<string, Record<string, (Item & { at: number })[]>> {
  const rows = db.prepare("SELECT * FROM shelves WHERE username = ? ORDER BY at DESC").all(username.toLowerCase()) as ShelfRow[];
  const out: Record<string, Record<string, (Item & { at: number })[]>> = {};
  for (const r of rows) {
    if (!apps[r.app]?.shelves[r.shelf]) continue;
    ((out[r.app] ??= {})[r.shelf] ??= []).push({ ...itemFrom(r), at: Number(r.at) });
  }
  return out;
}

/** Puts a title on a shelf (moving it to the front if it's there); the oldest falls off past [shelfSize]. */
export function shelve(db: DatabaseSync, username: string, shelf: string, raw: Record<string, unknown>, now = Date.now()): Item {
  const item = itemOf(raw);
  if (!apps[item.app].shelves[shelf]) throw new FriendsProblem("That shelf isn't one this app keeps.");
  const u = username.toLowerCase();
  db.prepare("INSERT INTO shelves (username, app, shelf, item_id, title, subtitle, cover, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (username, app, shelf, item_id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle, cover = excluded.cover, at = excluded.at")
    .run(u, item.app, shelf, item.itemId, item.title, item.subtitle, item.cover, now);
  db.prepare("DELETE FROM shelves WHERE username = ? AND app = ? AND shelf = ? AND item_id NOT IN (SELECT item_id FROM shelves WHERE username = ? AND app = ? AND shelf = ? ORDER BY at DESC LIMIT ?)")
    .run(u, item.app, shelf, u, item.app, shelf, shelfSize);
  return item;
}

export function unshelve(db: DatabaseSync, username: string, app: string, shelf: string, itemId: string) {
  db.prepare("DELETE FROM shelves WHERE username = ? AND app = ? AND shelf = ? AND item_id = ?").run(username.toLowerCase(), app, shelf, itemId);
}

/* ───── Recommendations ───── */

export const noteLimit = 500;

export type Recommendation = Item & { id: string; from: string; to: string | null; note: string | null; at: number; seen: boolean };
type RecRow = { id: string; from_user: string; to_user: string | null; app: string; item_id: string; title: string; subtitle: string | null; cover: string | null; note: string | null; at: number; seen_at: number | null };
const recFrom = (r: RecRow): Recommendation => ({ ...itemFrom(r), id: r.id, from: r.from_user, to: r.to_user, note: r.note ?? null, at: Number(r.at), seen: r.seen_at !== null });

/**
 * Recommends a title to each of [to] (friends only), or puts it on your own profile when [to] is empty.
 * Recommending the same title to the same person again brings it back to the top with the new note.
 */
export function recommend(db: DatabaseSync, from: string, to: string[], raw: Record<string, unknown>, newId: () => string, now = Date.now()): Recommendation[] {
  const u = from.toLowerCase();
  const item = itemOf(raw);
  const note = text(raw.note, noteLimit + 1);
  if ([...note].length > noteLimit) throw new FriendsProblem(`Keep the note under ${noteLimit} characters.`);
  const targets = [...new Set(to.map((t) => t.toLowerCase()).filter(Boolean))];
  if (targets.some((t) => t === u)) throw new FriendsProblem("Pick someone else.");
  if (targets.some((t) => !areFriends(db, u, t))) throw new FriendsProblem("You can only recommend to friends.", 403);
  return (targets.length ? targets : [null]).map((t) => {
    const was = db.prepare("SELECT id FROM recommendations WHERE from_user = ? AND to_user IS ? AND app = ? AND item_id = ?").get(u, t, item.app, item.itemId) as { id: string } | undefined;
    const id = was?.id ?? newId();
    if (was) db.prepare("UPDATE recommendations SET title = ?, subtitle = ?, cover = ?, note = ?, at = ?, seen_at = NULL, dismissed_at = NULL WHERE id = ?").run(item.title, item.subtitle, item.cover, note || null, now, id);
    else db.prepare("INSERT INTO recommendations (id, from_user, to_user, app, item_id, title, subtitle, cover, note, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, u, t, item.app, item.itemId, item.title, item.subtitle, item.cover, note || null, now);
    return recFrom(db.prepare("SELECT * FROM recommendations WHERE id = ?").get(id) as RecRow);
  });
}

/** What friends sent you and you haven't put away, the latest first. Only from people you're still friends with. */
export function receivedBy(db: DatabaseSync, me: string, app?: string): Recommendation[] {
  const u = me.toLowerCase();
  const friends = new Set(friendsOf(db, u));
  const rows = db.prepare(`SELECT * FROM recommendations WHERE to_user = ? AND dismissed_at IS NULL ${app ? "AND app = ?" : ""} ORDER BY at DESC LIMIT 200`).all(...(app ? [u, app] : [u])) as RecRow[];
  return rows.map(recFrom).filter((r) => friends.has(r.from));
}

/** What you sent to friends, the latest first. */
export function sentBy(db: DatabaseSync, me: string): Recommendation[] {
  return (db.prepare("SELECT * FROM recommendations WHERE from_user = ? AND to_user IS NOT NULL ORDER BY at DESC LIMIT 200").all(me.toLowerCase()) as RecRow[]).map(recFrom);
}

/** What someone put on their profile, the latest first. */
export function onProfile(db: DatabaseSync, username: string): Recommendation[] {
  return (db.prepare("SELECT * FROM recommendations WHERE from_user = ? AND to_user IS NULL ORDER BY at DESC LIMIT 60").all(username.toLowerCase()) as RecRow[]).map(recFrom);
}

/** What friends recommended you of one title (for its page). */
export function recommendedTo(db: DatabaseSync, me: string, app: string, itemId: string): Recommendation[] {
  return receivedBy(db, me, app).filter((r) => r.itemId === itemId);
}

export function markSeen(db: DatabaseSync, me: string, now = Date.now()) {
  db.prepare("UPDATE recommendations SET seen_at = ? WHERE to_user = ? AND seen_at IS NULL").run(now, me.toLowerCase());
}

export const unseenCount = (db: DatabaseSync, me: string) => receivedBy(db, me).filter((r) => !r.seen).length;

/** The sender takes it back (or off their profile); the one it was sent to puts it away. */
export function dropRecommendation(db: DatabaseSync, me: string, id: string, now = Date.now()): boolean {
  const u = me.toLowerCase();
  const row = db.prepare("SELECT from_user, to_user FROM recommendations WHERE id = ?").get(id) as { from_user: string; to_user: string | null } | undefined;
  if (!row) return false;
  if (row.from_user === u) { db.prepare("DELETE FROM recommendations WHERE id = ?").run(id); return true; }
  if (row.to_user === u) { db.prepare("UPDATE recommendations SET dismissed_at = ? WHERE id = ?").run(now, id); return true; }
  return false;
}
