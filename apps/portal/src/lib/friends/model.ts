/**
 * 友 Friends, profiles and recommendations: Kimono's, not one app's.
 *
 * Friendship: anyone can ask anyone; once the other says yes they're friends.
 * Asking someone who already asked you makes you friends. No (or taking an
 * ask back, or unfriending) forgets the link.
 *
 * A profile is private until you're friends: anyone else sees a name and a
 * portrait, enough to ask. Friends see the bio, what someone recommends, and
 * each app's activity (Watch: watched, loved, liked, My list; Books: reading,
 * read, want to read), worked out from that app's own data. Anyone can keep an
 * app's activity off their profile, or just some of its rows (their Watchlist,
 * what they loved), or their friends list; or go invisible, when friends see
 * only their name and portrait and no app shows them what they're doing.
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
    CREATE TABLE IF NOT EXISTS recommendations (id TEXT PRIMARY KEY, from_user TEXT NOT NULL, to_user TEXT, app TEXT NOT NULL, item_id TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, cover TEXT, note TEXT, at INTEGER NOT NULL, seen_at INTEGER, dismissed_at INTEGER);
    CREATE INDEX IF NOT EXISTS recommendations_to ON recommendations (to_user);
    CREATE INDEX IF NOT EXISTS recommendations_from ON recommendations (from_user);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const columns = (db.prepare("PRAGMA table_info(profiles)").all() as { name: string }[]).map((c) => c.name);
  /* Apps whose activity someone keeps off their profile, comma-separated. */
  if (!columns.includes("hidden")) db.exec("ALTER TABLE profiles ADD COLUMN hidden TEXT NOT NULL DEFAULT ''");
  /* Rows of a profile someone keeps to themselves ("watch:listed", "friends"), comma-separated; and whether they've gone invisible. */
  if (!columns.includes("kept")) db.exec("ALTER TABLE profiles ADD COLUMN kept TEXT NOT NULL DEFAULT ''");
  if (!columns.includes("invisible")) db.exec("ALTER TABLE profiles ADD COLUMN invisible INTEGER NOT NULL DEFAULT 0");
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

/** The apps whose titles can be shared and whose activity shows on a profile. */
export const apps: Record<string, { name: string }> = {
  watch: { name: "Watch" },
  books: { name: "Books" },
};

/** One row of a profile: what someone did in one app (watched, loved, reading…), latest first. */
export type Section = { app: string; appName: string; kind: string; title: string; items: (Item & { href?: string | null; progress?: number | null })[] };

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

const itemFrom = (r: { app: string; item_id: string; title: string; subtitle: string | null; cover: string | null }): Item =>
  ({ app: r.app, itemId: r.item_id, title: r.title, subtitle: r.subtitle ?? null, cover: r.cover ?? null });

/** The rows each app puts on a profile, by kind, so any of them can be kept back before it has anything in it. */
export const rowsOf: Record<string, [kind: string, title: string][]> = {
  watch: [["watched", "Watched"], ["loved", "Loved"], ["liked", "Liked"], ["listed", "Watchlist"]],
  books: [["reading", "Reading now"], ["want", "Want to read"], ["read", "Read"], ["loved", "Loved"], ["liked", "Liked"]],
};

type PrivacyRow = { hidden?: string; kept?: string; invisible?: number };
const privacyRow = (db: DatabaseSync, username: string) =>
  db.prepare("SELECT hidden, kept, invisible FROM profiles WHERE username = ?").get(username.toLowerCase()) as PrivacyRow | undefined;

/** Whether someone has gone invisible: friends see their name and portrait, and no app shows them what they do. */
export const isInvisible = (db: DatabaseSync, username: string) => Number(privacyRow(db, username)?.invisible ?? 0) === 1;

/** The apps whose activity someone keeps off their profile: every one while they're invisible. */
export function hiddenAppsOf(db: DatabaseSync, username: string): string[] {
  const row = privacyRow(db, username);
  if (Number(row?.invisible ?? 0) === 1) return Object.keys(apps).sort();
  return (row?.hidden ?? "").split(",").filter((a) => apps[a]);
}

/** The app rows ("watch:listed") and parts ("friends") someone keeps to themselves, with their apps still shown. */
export function keptOf(db: DatabaseSync, username: string): string[] {
  return (privacyRow(db, username)?.kept ?? "").split(",").filter((k) => k === "friends" || (k.includes(":") && rowsOf[k.split(":")[0]]?.some(([kind]) => kind === k.split(":")[1])));
}

const saveProfile = (db: DatabaseSync, u: string, column: "hidden" | "kept" | "invisible", value: string | number, now: number) =>
  db.prepare(`INSERT INTO profiles (username, bio, updated_at, ${column}) VALUES (?, '', ?, ?) ON CONFLICT (username) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at`).run(u, now, value);

/** Shows or keeps one app's activity off your profile. Answers the apps kept off as you set them (going invisible doesn't change these). */
export function setAppHidden(db: DatabaseSync, username: string, app: string, hidden: boolean, now = Date.now()): string[] {
  if (!apps[app]) throw new FriendsProblem("That app isn't on profiles.");
  const u = username.toLowerCase();
  const was = (privacyRow(db, u)?.hidden ?? "").split(",").filter((a) => apps[a]);
  const next = [...new Set([...was.filter((a) => a !== app), ...(hidden ? [app] : [])])].sort();
  saveProfile(db, u, "hidden", next.join(","), now);
  return next;
}

/** Shows or keeps one row ("watch:listed") or part ("friends") of your profile from friends. */
export function setKept(db: DatabaseSync, username: string, key: string, kept: boolean, now = Date.now()): string[] {
  const [app, kind] = key.split(":");
  if (key !== "friends" && !rowsOf[app]?.some(([k]) => k === kind)) throw new FriendsProblem("That isn't on profiles.");
  const u = username.toLowerCase();
  const next = [...new Set([...keptOf(db, u).filter((k) => k !== key), ...(kept ? [key] : [])])].sort();
  saveProfile(db, u, "kept", next.join(","), now);
  return next;
}

export function setInvisible(db: DatabaseSync, username: string, invisible: boolean, now = Date.now()): boolean {
  saveProfile(db, username.toLowerCase(), "invisible", invisible ? 1 : 0, now);
  return invisible;
}

/** What you let friends see, for your own profile: going invisible, and each app and its rows, and your friends list. */
export function privacyOf(db: DatabaseSync, username: string) {
  const row = privacyRow(db, username);
  const hidden = (row?.hidden ?? "").split(",");
  const kept = keptOf(db, username);
  return {
    invisible: Number(row?.invisible ?? 0) === 1,
    friends: !kept.includes("friends"),
    apps: Object.entries(apps).map(([app, { name }]) => ({
      app, name, shown: !hidden.includes(app),
      rows: (rowsOf[app] ?? []).map(([kind, title]) => ({ kind, title, shown: !kept.includes(`${app}:${kind}`) })),
    })),
  };
}
export type Privacy = ReturnType<typeof privacyOf>;

/** Whether [viewer] sees [username]'s whole profile: their own, or a friend's who isn't invisible. */
export const seesProfile = (db: DatabaseSync, viewer: string, username: string) =>
  viewer.toLowerCase() === username.toLowerCase() || (areFriends(db, viewer, username) && !isInvisible(db, username));

/**
 * Someone's profile as [viewer] sees it. Not friends (or they're invisible): their name and portrait and how you're linked, nothing more.
 * Friends: the bio, what they recommend, their friends, and each app's activity, less the apps and rows they keep to themselves.
 * Their own: everything, with what's kept back still there and `hidden`, `kept` and `privacy` saying what it is.
 * [sections] is only asked for when it will be shown.
 */
export function profileFor<P extends { username: string }>(db: DatabaseSync, viewer: string, person: P, sections: () => Section[]) {
  const v = viewer.toLowerCase(), u = person.username.toLowerCase();
  const you = v === u;
  const link = you ? null : linkOf(db, v, u);
  if (!seesProfile(db, v, u)) return { ...person, you, link, open: false as const };
  const hidden = hiddenAppsOf(db, u);
  const kept = keptOf(db, u);
  const friends = friendsOf(db, u);
  return {
    ...person, you, link, open: true as const,
    bio: bioOf(db, u),
    sections: sections().filter((s) => you || (!hidden.includes(s.app) && !kept.includes(`${s.app}:${s.kind}`))),
    recommendations: onProfile(db, u),
    friends: friends.length,
    /* Who they're friends with, unless they keep it to themselves; never those who've gone invisible, but to themselves. */
    friendList: you || !kept.includes("friends") ? friends.filter((f) => you || f === v || !isInvisible(db, f)) : null,
    ...(you ? { hidden, kept, privacy: privacyOf(db, u) } : {}),
  };
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
