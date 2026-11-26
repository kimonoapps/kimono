import "server-only";

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apiError } from "../api-v1";
import { portalOrigin } from "../account";
import { listAccounts } from "../directory";
import { picturePaths } from "../pictures";
import { dropBanner, writeBanner } from "../banners";
import { stateDir } from "../state";
import {
  answerFriend, apps, askFriend, setLook, setBannerFile, keptOf, hiddenAppsOf, bioOf, dropRecommendation, FriendsProblem, friendsOf, importFriends, linkOf, linksOf, markSeen, migrateSocial, onProfile,
  isInvisible, isOffProfile, audienceOf, friendsOnlyOf, setAudience, offProfileList, offProfileOf, privacyOf, profileFor, putBackOnProfile, takeOffProfile, receivedBy, recommend, recommendedTo, removeFriend, seesProfile, sentBy, setAppHidden, setBio, setInvisible, setKept, unseenCount, setVisibility, visibilityOf, decideSharing, decidedOf, sharingAsks, type Visibility,
  type LinkState, type Recommendation, type Section,
} from "./model";
import { friendsActivity, type Activity } from "./activity";

/*
 * 友 Friends on the server (./model.ts has the rules): who's friends, profiles
 * and recommendations, kept in a database of their own so they don't depend on
 * any one app being switched on. Apps add their own sections to a profile
 * (Watch: lib/watch/friends-live.ts) and their own things to recommend.
 */

const cache = globalThis as unknown as { kimonoFriends?: DatabaseSync; kimonoPeople?: { at: number; people: Person[] } };

let migrated = false;
export function friendsDb(): DatabaseSync {
  /* A hot reload keeps the connection but brings new code: bring the schema along. */
  if (cache.kimonoFriends && !migrated) { migrateSocial(cache.kimonoFriends); migrated = true; }
  if (!cache.kimonoFriends) {
    migrated = true;
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

/** Forgets the household's names and portraits, so a rename or a new picture shows at once. */
export function forgetPeople() { cache.kimonoPeople = undefined; }

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

export type { Section };

/** An app's rows on someone's profile, worked out from its own data, for `viewer` looking at `username`. */
type SectionSource = (viewer: string, username: string, origin: string) => Promise<Section[]>;
/* Loaded on first use, so a profile never waits on an app that isn't there; an app that fails shows nothing. */
const sourceLoaders: (() => Promise<SectionSource>)[] = [
  () => import("../watch/friends-live").then((m) => m.watchSections),
  () => import("./books-section").then((m) => m.booksSections),
  () => import("../music/social").then((m) => m.musicSections),
];

export type RecommendationView = Omit<Recommendation, "from" | "to"> & { from: Person; to: Person | null; appName: string };
const viewOf = (r: Recommendation, everyone: Person[]): RecommendationView =>
  ({ ...r, from: personIn(everyone, r.from), to: r.to ? personIn(everyone, r.to) : null, appName: apps[r.app]?.name ?? r.app });

/**
 * Someone's profile as `viewer` sees it (model.ts profileFor): private until you're friends, so anyone else
 * gets only their name, portrait and how you're linked. Apps' activity is only worked out when it will be shown.
 */
export async function profileOf(viewer: string, username: string, origin: string) {
  const person = await findPerson(username);
  if (!person) throw new FriendsProblem("They aren't on this Kimono.", 404);
  const db = friendsDb();
  const loaded = seesProfile(db, viewer, person.username)
    ? (await Promise.all(sourceLoaders.map((load) => load().then((source) => source(viewer.toLowerCase(), person.username, origin)).catch(() => [] as Section[])))).flat()
    : [];
  /* What they took off their profile stays off until they put it back. */
  const off = offProfileOf(db, person.username);
  const sections = loaded.map((s) => ({ ...s, items: s.items.filter((i) => !isOffProfile(off, `${s.app}:${s.kind}`, i.itemId)) })).filter((s) => s.items.length > 0);
  /* One taken off before its name was kept gets it from the row it came off. */
  if (viewer.toLowerCase() === person.username.toLowerCase()) for (const o of offProfileList(db, person.username).filter((o) => !o.named)) {
    const found = loaded.find((s) => s.app === o.app && s.kind === o.kind)?.items.find((i) => i.itemId === o.itemId);
    if (found) takeOffProfile(db, person.username, `${o.app}:${o.kind}`, o.itemId, found, o.at);
  }
  const profile = profileFor(db, viewer, person, () => sections);
  if (!profile.open) return profile;
  const everyone = await people();
  /* Badges are for friends too: a Kimono Reader shows even when their Books rows don't. */
  const kimonoRead = await import("./books-section").then((m) => m.kimonoReadOf(person.username)).catch(() => null);
  /* Music's and Books' widgets, each part only as far as they share it (their own profile shows it all). */
  const you = profile.you;
  const only = audienceOf(db, viewer, person.username) === "stranger" ? friendsOnlyOf(db, person.username) : [];
  const kept = new Set([...keptOf(db, person.username), ...only]);
  const hiddenApps = [...hiddenAppsOf(db, person.username), ...only];
  const shares = (app: string, kind: string) => you || (!hiddenApps.includes(app) && !kept.has(`${app}:${kind}`));
  const songs = (profile.widgets ?? []).filter((w) => w.kind === "song" && w.config?.key).map((w) => w.config!.key!);
  const fullMusic = shares("music", "playing") || shares("music", "stats")
    ? await import("../music/social").then((m) => m.musicExtras(person.username, songs)).catch(() => null) : null;
  const music = fullMusic ? {
    ...fullMusic,
    listening: shares("music", "playing") ? fullMusic.listening : null,
    ...(shares("music", "stats") ? {} : { plays: 0, minutes: 0, artists: [], counts: {}, onRepeat: null }),
  } : null;
  const fullBooks = shares("books", "read") || shares("books", "reviews") ? await import("./books-section").then((m) => m.booksExtras(person.username)).catch(() => null) : null;
  const books = fullBooks ? { ...fullBooks, ...(shares("books", "reviews") ? {} : { reviews: [] }), ...(shares("books", "read") ? {} : { read: [] }) } : null;
  /* Ratings of what they watched are their own row to share: kept, the marks come off. */
  if (!shares("watch", "rated")) profile.sections = profile.sections.map((s) => (s.app === "watch" ? { ...s, items: s.items.map((i) => ({ ...i, rating: null })) } : s));
  const friendList = profile.friendList?.map((f) => personIn(everyone, f)).sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username)) ?? null;
  return { ...profile, friendList, recommendations: await withCovers(profile.recommendations.map((r) => viewOf(r, everyone))), kimonoRead, music, books };
}

export const saveBio = (username: string, bio: unknown) => setBio(friendsDb(), username, bio);
/** Your pronouns, colour and links: `{ pronouns?, color?, links? }`. */
export const saveLook = (username: string, raw: Record<string, unknown>) => setLook(friendsDb(), username, raw);
/** Puts a cropped banner up (or, with null, takes it down); the one it replaces is deleted. Answers the profile's look. */
export async function saveBanner(username: string, upload: Uint8Array | null) {
  const file = upload ? await writeBanner(upload) : null;
  await dropBanner(setBannerFile(friendsDb(), username, file));
  return setLook(friendsDb(), username, {});
}
export const showApp = (username: string, app: string, shown: boolean) => setAppHidden(friendsDb(), username, app, !shown);

/**
 * What friends see of you: `{ invisible }`, `{ app, shown }` (an app's activity), or `{ keep: "watch:listed" | "friends", shown }`
 * (one row, or your friends list). Answers it all as it is now.
 */
export function changePrivacy(username: string, body: Record<string, unknown>) {
  const db = friendsDb();
  const shown = body.shown !== false;
  if (typeof body.visibility === "string") setVisibility(db, username, body.visibility as Visibility);
  else if (typeof body.share === "string") decideSharing(db, username, body.share, Array.isArray(body.on) ? body.on.map(String) : []);
  else if (typeof body.invisible === "boolean") setInvisible(db, username, body.invisible);
  else if (typeof body.audience === "string" && ["me", "friends", "everyone"].includes(String(body.to))) setAudience(db, username, body.audience, body.to as "me" | "friends" | "everyone");
  else if (typeof body.keep === "string") setKept(db, username, body.keep, !shown);
  else if (typeof body.app === "string") setAppHidden(db, username, body.app, !shown);
  else throw new FriendsProblem("Pick what friends see.");
  return { privacy: privacyOf(db, username), hidden: hiddenAppsOf(db, username) };
}

const profileRows: Record<string, string[]> = { watch: ["watching", "watched", "listed"], books: ["reading", "want", "read"], music: ["playing", "loved", "playlists"] };

/**
 * Whether an app should ask what to share, the first time it's opened: only once you have a friend to share
 * with, and only until you answer. With the choices, each starting where it should.
 */
export function sharingAsk(username: string, app: string) {
  const db = friendsDb();
  const asks = sharingAsks[app];
  if (!asks) return { ask: false, asks: [] };
  const ask = !decidedOf(db, username).includes(app) && friendsOf(db, username).length > 0;
  return { ask, asks: asks.map(({ key, says, on }) => ({ key, says, on })) };
}
const rowOf = (raw: Record<string, unknown>) => {
  const app = String(raw.app ?? ""), kind = String(raw.kind ?? ""), id = String(raw.itemId ?? "");
  if (!id) throw new FriendsProblem("Pick a title.");
  if (!profileRows[app]) throw new FriendsProblem("That app isn't on profiles.");
  if (!profileRows[app].includes(kind)) throw new FriendsProblem("That isn't on profiles.");
  return { app, kind, id };
};

/**
 * Takes one title off one row of your own profile, for good (until you put it back): your progress, ratings and
 * lists stay as they are in the app. `{ app, kind, itemId, title?, subtitle?, cover? }`.
 */
export async function removeFromRow(username: string, raw: Record<string, unknown>) {
  const { app, kind, id } = rowOf(raw);
  takeOffProfile(friendsDb(), username, `${app}:${kind}`, id, raw);
  /* A watched title also leaves what Watch shows friends. */
  if (app === "watch" && (kind === "watched" || kind === "watching")) await watchedSeen(username, id, false);
  return { ok: true, off: offProfileList(friendsDb(), username) };
}

/** Puts a title you took off back on your profile. */
export async function putBackOnRow(username: string, raw: Record<string, unknown>) {
  const { app, kind, id } = rowOf(raw);
  putBackOnProfile(friendsDb(), username, `${app}:${kind}`, id);
  if (app === "watch" && (kind === "watched" || kind === "watching")) await watchedSeen(username, id, true);
  return { ok: true, off: offProfileList(friendsDb(), username) };
}

const watchedSeen = async (username: string, id: string, seen: boolean) => {
  const [{ watchDb }, { noteWatched }] = await Promise.all([import("../watch"), import("../watch/friends")]);
  noteWatched(watchDb(), username, id, !seen);
};

/** Whether someone has gone invisible to friends (Kimono's switch, on their profile): apps keep what they do from friends while it's on. */
/** Whether anyone with its address sees someone's profile. */
export const isPublicProfile = (username: string) => visibilityOf(friendsDb(), username) === "public";
export const invisibleToFriends = (username: string) => isInvisible(friendsDb(), username);

/* ───── Recommendations ───── */

/** `{ to: [usernames] (none: on your profile), app, itemId, title, subtitle?, cover?, note? }`. */
export async function sendRecommendation(username: string, raw: Record<string, unknown>) {
  const to = Array.isArray(raw.to) ? raw.to.map(String) : typeof raw.to === "string" && raw.to ? [raw.to] : [];
  const made = recommend(friendsDb(), username, to, raw, () => `r${randomBytes(9).toString("base64url")}`);
  const everyone = await people();
  return { recommendations: made.map((r) => viewOf(r, everyone)) };
}

/**
 * A title sent without a picture (a film with no poster yet, say) gets one from its app now:
 * Watch's poster, else its wide art. Anything still without one is drawn by its app's own fallback.
 */
async function withCovers<T extends { app: string; itemId: string; cover: string | null }>(items: T[]): Promise<T[]> {
  if (!items.some((i) => !i.cover && i.app === "watch")) return items;
  const watch = await Promise.all([import("../watch/index"), import("../watch/model"), import("../watch/images")]).catch(() => null);
  if (!watch) return items;
  const [{ watchDb }, { getTitle }, { imageUrl }] = watch;
  return items.map((i) => {
    if (i.cover || i.app !== "watch") return i;
    const t = getTitle(watchDb(), i.itemId);
    return { ...i, cover: t ? imageUrl("", t.poster, "w500") ?? imageUrl("", t.backdrop, "w780") : null };
  });
}

/** What friends sent you (marked seen as it's read), what you sent, and what's on your profile. */
export async function recommendationsFor(username: string, app?: string) {
  const db = friendsDb();
  const everyone = await people();
  const received = await withCovers(receivedBy(db, username, app).map((r) => viewOf(r, everyone)));
  markSeen(db, username);
  return {
    received,
    sent: await withCovers(sentBy(db, username).filter((r) => !app || r.app === app).map((r) => viewOf(r, everyone))),
    profile: await withCovers(onProfile(db, username).filter((r) => !app || r.app === app).map((r) => viewOf(r, everyone))),
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

/* ───── On Home ───── */

export type ActivityView = Omit<Activity, "from"> & { from: Person; appName: string };

const recommendationHref = (r: Recommendation) =>
  r.app === "watch" ? `/watch?t=${encodeURIComponent(r.itemId)}` : r.app === "books" ? `/books?b=${encodeURIComponent(r.itemId)}`
    : r.app === "music" && /^dz:\d+$/.test(r.itemId) ? `/music/song/${r.itemId.slice(3)}`
    : r.app === "music" && /^yt:[A-Za-z0-9_-]{11}$/.test(r.itemId) ? `/music/song/yt-${r.itemId.slice(3)}` : null;

/**
 * What friends are up to, for Home (./activity.ts keeps it to what each lets friends see): watching now and
 * lately, reading and read, and what they sent you, the latest first, a few each, from the last month.
 * An app that's off or fails adds nothing.
 */
export async function activityOf(username: string, origin: string, limit = 8): Promise<{ items: ActivityView[] }> {
  const u = username.toLowerCase();
  const db = friendsDb();
  if (!friendsOf(db, u).length) return { items: [] };
  const [watch, books, music] = await Promise.all([
    import("../watch/friends-live").then((m) => m.watchActivity(u, origin)).catch(() => null),
    import("@/lib/books").then(async (m) => (await m.booksSettings()).enabled ? m.friendsReading(u, 24) : []).catch(() => []),
    import("../music/social").then((m) => m.musicActivity(u)).catch(() => []),
  ]);
  const items: Activity[] = [
    ...(watch?.items ?? []),
    ...music,
    ...books.map((b) => ({
      kind: b.state === "read" ? "read" as const : "reading" as const, app: "books", from: b.username,
      itemId: b.book.key, title: b.book.title, subtitle: b.book.authors[0] ?? null, cover: b.book.cover,
      href: `/books?b=${encodeURIComponent(b.book.key)}`, at: Date.parse(b.updatedAt), progress: b.state === "reading" ? b.fraction : null,
    })),
    ...receivedBy(db, u).map((r) => ({
      kind: "recommended" as const, app: r.app, from: r.from, itemId: r.itemId, title: r.title, subtitle: r.subtitle, cover: r.cover,
      href: recommendationHref(r), at: r.at, note: r.note,
    })),
  ];
  const shown = friendsActivity(db, u, items, watch?.share ?? null, { limit, since: Date.now() - 30 * 24 * 3600_000 });
  const everyone = await people();
  return { items: shown.map((a) => ({ ...a, from: personIn(everyone, a.from), appName: apps[a.app]?.name ?? a.app })) };
}
