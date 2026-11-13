import "server-only";

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apiError } from "../api-v1";
import { portalOrigin } from "../account";
import { listAccounts } from "../directory";
import { picturePaths } from "../pictures";
import { stateDir } from "../state";
import {
  answerFriend, apps, askFriend, bioOf, dropRecommendation, FriendsProblem, friendsOf, importFriends, linkOf, linksOf, markSeen, migrateSocial, onProfile,
  receivedBy, recommend, recommendedTo, removeFriend, sentBy, setBio, shelve, shelvesOf, unseenCount, unshelve,
  type Item, type LinkState, type Recommendation,
} from "./model";

/*
 * 友 Friends on the server (./model.ts has the rules): who's friends, profiles
 * and recommendations, kept in a database of their own so they don't depend on
 * any one app being switched on. Apps add their own sections to a profile
 * (Watch: lib/watch/friends-live.ts) and their own things to recommend.
 */

const cache = globalThis as unknown as { kimonoFriends?: DatabaseSync; kimonoPeople?: { at: number; people: Person[] } };

export function friendsDb(): DatabaseSync {
  if (!cache.kimonoFriends) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const opened = new DatabaseSync(join(stateDir, "friends.db"));
    opened.exec("PRAGMA busy_timeout = 3000");
    migrateSocial(opened);
    bringWatchFriends(opened);
    cache.kimonoFriends = opened;
  }
  return cache.kimonoFriends;
}

/** Friendships used to be Watch's alone; they're brought over once, as they were. */
function bringWatchFriends(db: DatabaseSync) {
  const watchFile = join(stateDir, "watch", "watch.db");
  if (db.prepare("SELECT 1 FROM meta WHERE key = 'watch-friends'").get() || !existsSync(watchFile)) return;
  try {
    const old = new DatabaseSync(watchFile, { readOnly: true });
    try {
      const has = old.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'friends'").get();
      const rows = has ? old.prepare("SELECT a, b, asked_by, state, at FROM friends").all() as Parameters<typeof importFriends>[1] : [];
      const added = importFriends(db, rows, "watch-friends");
      if (added) console.info(`Friends: brought ${added} from Watch.`);
    } finally { old.close(); }
  } catch (error) {
    /* Tried again next start; nothing is lost meanwhile, as Watch's table is only read. */
    console.warn("Friends: Watch's friendships couldn't be read:", error instanceof Error ? error.message : error);
  }
}

export type Person = { username: string; name: string; picture: string | null };

/** Everyone in the household, by name and portrait (initials stand in for none). */
export async function people(fresh = false): Promise<Person[]> {
  if (!fresh && cache.kimonoPeople && Date.now() - cache.kimonoPeople.at < 5 * 60_000) return cache.kimonoPeople.people;
  const [accounts, pictures] = await Promise.all([listAccounts(), picturePaths()]);
  const origin = portalOrigin();
  const list = accounts.map((a) => {
    const picture = pictures[a.username.toLowerCase()];
    return { username: a.username.toLowerCase(), name: a.name || a.username, picture: picture ? `${origin}${picture}` : null };
  });
  cache.kimonoPeople = { at: Date.now(), people: list };
  return list;
}

/** Someone on this Kimono, looked for again when they're new since the list was last read. */
async function findPerson(username: string): Promise<Person | undefined> {
  const u = username.toLowerCase();
  return (await people()).find((p) => p.username === u) ?? (await people(true)).find((p) => p.username === u);
}

/** Someone by username, as they're known; a stand-in when they've left. */
export const personIn = (everyone: Person[], username: string): Person =>
  everyone.find((p) => p.username === username.toLowerCase()) ?? { username: username.toLowerCase(), name: username, picture: null };

/** Runs a friends request, turning refusals into the JSON errors /api/v1 answers with. */
export async function friendly(work: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FriendsProblem) return apiError(error.status, error.message);
    console.warn("Friends request failed:", error instanceof Error ? error.message : error);
    return apiError(500, "That didn't work. Try again in a moment.");
  }
}

/* ───── Friends ───── */

export type FriendPerson = Person & { bio: string };

/** Your friends (with their bios), who asked you, who you asked, and how many recommendations are new. */
export async function friendsList(username: string) {
  const u = username.toLowerCase();
  const db = friendsDb();
  const everyone = await people();
  const links = linksOf(db, u);
  const of = (state: LinkState) => links.filter((l) => l.state === state).map((l) => personIn(everyone, l.username));
  return {
    friends: of("friends").map((p) => ({ ...p, bio: bioOf(db, p.username) })).sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username)),
    asked: of("asked"),
    asking: of("asking"),
    unseen: unseenCount(db, u),
  };
}

/**
 * People to ask to be friends, found by what was typed: at least two letters of their name or username,
 * the closest first, at most 8. Friends and those already asked (either way) aren't among them.
 */
export async function findPeople(username: string, typed: string): Promise<Person[]> {
  const u = username.toLowerCase();
  const q = typed.trim().toLowerCase();
  if (q.length < 2) return [];
  const linked = new Set(linksOf(friendsDb(), u).map((l) => l.username));
  const rank = (p: Person) => {
    const words = [p.username.toLowerCase(), ...(p.name ?? "").toLowerCase().split(/\s+/)];
    return words.some((w) => w === q) ? 0 : words.some((w) => w.startsWith(q)) ? 1 : 2;
  };
  return (await people())
    .filter((p) => p.username !== u && !linked.has(p.username) && (p.username.toLowerCase().includes(q) || (p.name ?? "").toLowerCase().includes(q)))
    .sort((a, b) => rank(a) - rank(b) || (a.name || a.username).localeCompare(b.name || b.username))
    .slice(0, 8);
}

/** `{ type: "ask" | "yes" | "no" | "remove", username }`: friendship changes. Answers the link now. */
export async function changeFriend(username: string, raw: Record<string, unknown>): Promise<{ state: LinkState | null }> {
  const u = username.toLowerCase();
  const them = String(raw.username ?? "").toLowerCase();
  if (!them || them === u) throw new FriendsProblem("Pick someone else.");
  if (!(await findPerson(them))) throw new FriendsProblem("They aren't on this Kimono.", 404);
  const db = friendsDb();
  switch (raw.type) {
    case "ask": return { state: askFriend(db, u, them) };
    case "yes": return { state: answerFriend(db, u, them, true) };
    case "no": return { state: answerFriend(db, u, them, false) };
    case "remove": removeFriend(db, u, them); return { state: null };
    default: throw new FriendsProblem("That isn't something friends do.");
  }
}

export const friendsOfUser = (username: string) => friendsOf(friendsDb(), username);
export const linkBetween = (me: string, them: string) => linkOf(friendsDb(), me, them);
export const linksOfUser = (username: string) => linksOf(friendsDb(), username);

/* ───── Profiles ───── */

/** A section an app adds to someone's profile: titles under a heading. */
export type ProfileItem = Item & { href?: string | null };
export type Section = { app: string; appName: string; shelf: string; title: string; items: ProfileItem[]; editable: boolean };

/** Sections an app works out itself (Watch from what's watched), for `viewer` looking at `username`. */
type SectionSource = (viewer: string, username: string, origin: string) => Promise<Section[]>;
const sources: SectionSource[] = [];
let sourcesLoaded: Promise<void> | null = null;
/* Loaded on first use, so a profile never waits on an app that isn't there. */
function loadSources() {
  return (sourcesLoaded ??= import("../watch/friends-live").then((m) => { sources.push(m.watchSections); }, () => {}));
}

export type RecommendationView = Omit<Recommendation, "from" | "to"> & { from: Person; to: Person | null; appName: string };
const viewOf = (r: Recommendation, everyone: Person[]): RecommendationView =>
  ({ ...r, from: personIn(everyone, r.from), to: r.to ? personIn(everyone, r.to) : null, appName: apps[r.app]?.name ?? r.app });

/**
 * Someone's profile as `viewer` sees it. Their name and portrait, and whether you're friends, for anyone;
 * the bio, the apps' sections and what they recommend only for friends (and themselves).
 */
export async function profileOf(viewer: string, username: string, origin: string) {
  const v = viewer.toLowerCase(), u = username.toLowerCase();
  const person = await findPerson(u);
  if (!person) throw new FriendsProblem("They aren't on this Kimono.", 404);
  const everyone = await people();
  const db = friendsDb();
  const you = v === u;
  const link = you ? null : linkOf(db, v, u);
  const open = you || link === "friends";
  if (!open) return { ...person, you, link, open, bio: "", sections: [] as Section[], recommendations: [] as RecommendationView[], friends: 0 };
  await loadSources();
  const appSections = (await Promise.all(sources.map((s) => s(v, u, origin).catch(() => [] as Section[])))).flat();
  const kept = shelvesOf(db, u);
  const shelfSections: Section[] = Object.entries(apps).flatMap(([app, a]) => Object.entries(a.shelves).map(([shelf, title]) =>
    ({ app, appName: a.name, shelf, title, items: kept[app]?.[shelf] ?? [], editable: you })))
    .filter((s) => s.items.length);
  return {
    ...person, you, link, open,
    bio: bioOf(db, u),
    sections: [...appSections, ...shelfSections],
    recommendations: onProfile(db, u).map((r) => viewOf(r, everyone)),
    friends: friendsOf(db, u).length,
  };
}

export const saveBio = (username: string, bio: unknown) => setBio(friendsDb(), username, bio);
export const addToShelf = (username: string, shelf: string, raw: Record<string, unknown>) => shelve(friendsDb(), username, shelf, raw);
export const removeFromShelf = (username: string, app: string, shelf: string, itemId: string) => unshelve(friendsDb(), username, app, shelf, itemId);

/* ───── Recommendations ───── */

/** `{ to: [usernames] (none: on your profile), app, itemId, title, subtitle?, cover?, note? }`. */
export async function sendRecommendation(username: string, raw: Record<string, unknown>) {
  const to = Array.isArray(raw.to) ? raw.to.map(String) : typeof raw.to === "string" && raw.to ? [raw.to] : [];
  const made = recommend(friendsDb(), username, to, raw, () => `r${randomBytes(9).toString("base64url")}`);
  const everyone = await people();
  return { recommendations: made.map((r) => viewOf(r, everyone)) };
}

/** What friends sent you (marked seen as it's read), what you sent, and what's on your profile. */
export async function recommendationsFor(username: string, app?: string) {
  const db = friendsDb();
  const everyone = await people();
  const received = receivedBy(db, username, app).map((r) => viewOf(r, everyone));
  markSeen(db, username);
  return {
    received,
    sent: sentBy(db, username).filter((r) => !app || r.app === app).map((r) => viewOf(r, everyone)),
    profile: onProfile(db, username).filter((r) => !app || r.app === app).map((r) => viewOf(r, everyone)),
  };
}

/** Who recommended you one title, with their notes (for its page). */
export async function recommendedToUser(username: string, app: string, itemId: string) {
  const everyone = await people();
  return recommendedTo(friendsDb(), username, app, itemId).map((r) => ({ ...personIn(everyone, r.from), id: r.id, note: r.note, at: r.at }));
}

export function dropRecommendationOf(username: string, id: string) {
  if (!dropRecommendation(friendsDb(), username, id)) throw new FriendsProblem("That recommendation is gone.", 404);
  return { ok: true };
}
