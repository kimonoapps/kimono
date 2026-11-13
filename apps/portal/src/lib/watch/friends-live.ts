import "server-only";

import { randomBytes } from "node:crypto";
import type { WatchConfig } from "./config";
import { cardOf, ensureTitle, finished, fraction, getTitle, getTitles, prefsOf, watchDb, WatchProblem, type Card, type Progress, type Title } from "./index";
import { playingNow, watchKey } from "./flow";
import { answerAsk, cancelAsk, hiddenOf, likedByFriends, watchedByFriends, liveAsks, newAsk, noteWatched, type JoinAsk } from "./friends";
import { changeFriend as changeKimonoFriend, findPeople as findKimonoPeople, friendsOfUser, invisibleToFriends, linkBetween, linksOfUser, type Section } from "../friends";
import { FriendsProblem, type LinkState } from "../friends/model";
import { inviteTo, labelsFor, partyWith, people, type Person } from "./together-live";
import { watchConfig } from "./config";
import { getPlatformSettings } from "../settings";

/*
 * 友 Friends on Watch's server (./friends.ts has the rules): what each friend
 * is watching now and where they are in things, and asks to join. Who's
 * friends is Kimono's (lib/friends); Watch only reads that list.
 */

const cache = globalThis as unknown as { kimonoWatchJoinAsks?: JoinAsk[] };
let asks: JoinAsk[] = (cache.kimonoWatchJoinAsks ??= []);
const keep = (next: JoinAsk[]) => { asks = cache.kimonoWatchJoinAsks = next; };

/** Watching now: a player reported in the last minute and is still on it (a closed or long-paused one isn't). */
const nowWindow = 60_000;

export type Spot = {
  title: Card; season: number; episode: number; label: string | null;
  /** 0–1 through the episode (or film). */
  progress: number; finished: boolean; at: number;
};
export type Now = Spot & { position: number; duration: number; partyId: string | null };
export type FriendView = Person & { now: Now | null; recent: Spot[]; sharing: boolean };
export type AskView = Pick<JoinAsk, "id" | "from" | "to" | "answer" | "partyId" | "at"> & { name: string; picture: string | null; title: string | null; label: string | null };

/** Someone's latest place in each title, most recent first (their name in any spelling). */
function lastRows(username: string, limit: number): Progress[] {
  /* What they watched while invisible isn't shown. */
  const hidden = hiddenOf(watchDb(), username);
  const rows = watchDb().prepare(`SELECT * FROM progress p WHERE lower(username) = ? AND updated_at = (SELECT MAX(updated_at) FROM progress q WHERE q.username = p.username AND q.title_id = p.title_id)
    ORDER BY updated_at DESC LIMIT ?`).all(username.toLowerCase(), limit + hidden.size) as Record<string, unknown>[];
  return rows.filter((r) => !hidden.has(String(r.title_id))).slice(0, limit).map((r) => ({ titleId: String(r.title_id), season: Number(r.season), episode: Number(r.episode), position: Number(r.position), duration: Number(r.duration), updatedAt: Number(r.updated_at) }));
}

function spotOf(viewer: string, p: Progress, origin: string): Spot | null {
  const title = getTitle(watchDb(), p.titleId);
  if (!title) return null;
  const label = p.season || p.episode ? labelsFor(viewer, p.titleId)?.(p.season, p.episode) ?? `S${p.season}:E${p.episode}` : null;
  return { title: cardOf(title, origin), season: p.season, episode: p.episode, label, progress: fraction(p), finished: finished(p), at: p.updatedAt };
}

/** What `username` is playing right now, as `viewer` names it; null when nothing (or they don't share). */
function nowOf(viewer: string, username: string, origin: string, now = Date.now()): Now | null {
  if (invisible(username)) return null;
  const playing = new Set(playingNow(username, now));
  const party = partyWith(username, now);
  const latest = lastRows(username, 3).find((p) => now - p.updatedAt < nowWindow && (playing.has(watchKey(p.titleId, p.season, p.episode)) || party?.timeline.titleId === p.titleId));
  if (!latest) return null;
  const spot = spotOf(viewer, latest, origin);
  return spot && { ...spot, position: latest.position, duration: latest.duration, partyId: party?.timeline.titleId === latest.titleId ? party.id : null };
}

/* Gone invisible on their Kimono profile: Watch shows friends nothing of them, as if every switch below were off. */
const quiet = (username: string) => { try { return invisibleToFriends(username); } catch { return false; } };
/* Their own switches (Settings › Friends), as they set them… */
const sharingSet = (username: string) => prefsOf(watchDb(), username.toLowerCase()).shareWatching !== false;
const invisibleSet = (username: string) => prefsOf(watchDb(), username.toLowerCase()).invisible === true;
const sharesTasteSet = (username: string) => prefsOf(watchDb(), username.toLowerCase()).shareTaste !== false;
/* …and what friends get. */
const sharing = (username: string) => sharingSet(username) && !quiet(username);
const invisible = (username: string) => invisibleSet(username) || quiet(username);
/** Whether friends see their list and ratings. */
const sharesTaste = (username: string) => sharesTasteSet(username) && !quiet(username);
type RatingRow = { title_id: string; rating: "down" | "up" | "love"; rated_at: number | null };
const ratingsOf = (username: string) => watchDb().prepare("SELECT title_id, rating, rated_at FROM ratings WHERE lower(username) = ? ORDER BY coalesce(rated_at, 0) DESC").all(username.toLowerCase()) as RatingRow[];

/** A progress report: a title played while invisible is kept from friends (and shown again once played visibly). */
export function noteFriendsWatch(username: string, titleId: string) {
  try { noteWatched(watchDb(), username, titleId, invisible(username)); } catch { /* only what friends see */ }
}

function askView(a: JoinAsk, everyone: Person[], viewer: string): AskView {
  const other = everyone.find((p) => p.username === (a.from === viewer ? a.to : a.from));
  const title = getTitle(watchDb(), a.titleId);
  const label = a.season || a.episode ? labelsFor(viewer, a.titleId)?.(a.season, a.episode) ?? `S${a.season}:E${a.episode}` : null;
  return { id: a.id, from: a.from, to: a.to, answer: a.answer, partyId: a.partyId, at: a.at, name: other?.name ?? (a.from === viewer ? a.to : a.from), picture: other?.picture ?? null, title: title?.name ?? null, label };
}

/** The asks to and from this person still standing. */
export async function asksOf(username: string) {
  const u = username.toLowerCase();
  keep(liveAsks(asks, Date.now()));
  const mine = asks.filter((a) => a.to === u || a.from === u);
  if (!mine.length) return { incoming: [], outgoing: [] };
  const everyone = await people();
  return {
    incoming: mine.filter((a) => a.to === u && a.answer === "waiting").map((a) => askView(a, everyone, u)),
    outgoing: mine.filter((a) => a.from === u).map((a) => askView(a, everyone, u)),
  };
}

/** The Friends page: friends with what they're on now and lately, who asked and who's been asked. Others to ask are found by name (findPeople), never listed. */
export async function friendsPage(username: string, origin: string) {
  const u = username.toLowerCase();
  const everyone = await people();
  const links = linksOfUser(u);
  const person = (x: string): Person => everyone.find((p) => p.username === x) ?? { username: x, name: x, picture: null };
  const now = Date.now();
  const friends: FriendView[] = links.filter((l) => l.state === "friends").map((l) => {
    const p = person(l.username);
    if (!sharing(l.username)) return { ...p, now: null, recent: [], sharing: false };
    const recent = lastRows(l.username, 8).map((r) => spotOf(u, r, origin)).filter((s): s is Spot => s !== null);
    return { ...p, now: nowOf(u, l.username, origin, now), recent, sharing: true };
  });
  /* Watching now first, then whoever watched most lately. */
  friends.sort((a, b) => Number(!!b.now) - Number(!!a.now) || (b.recent[0]?.at ?? 0) - (a.recent[0]?.at ?? 0));
  return {
    sharing: sharingSet(u),
    invisible: invisibleSet(u),
    friends,
    asked: links.filter((l) => l.state === "asked").map((l) => person(l.username)),
    asking: links.filter((l) => l.state === "asking").map((l) => person(l.username)),
    /* No one is listed to ask: they're searched for by name (findPeople). Kept empty for apps from before. */
    people: [] as Person[],
    ...(await asksOf(u)),
  };
}

/** People to ask to be friends, found by name (lib/friends). */
export const findPeople = (username: string, typed: string) => findKimonoPeople(username, typed);

/** Friends' places in one title, for its page: where each is, and who's on it now. */
export async function friendsOn(username: string, titleId: string, origin: string) {
  const u = username.toLowerCase();
  const db = watchDb();
  const list = friendsOfUser(u).filter(sharing);
  if (!list.length) return [];
  const everyone = await people();
  const now = Date.now();
  return list.flatMap((f) => {
    if (hiddenOf(db, f).has(titleId)) return [];
    const row = (db.prepare("SELECT * FROM progress WHERE lower(username) = ? AND title_id = ? ORDER BY updated_at DESC LIMIT 1").get(f, titleId)) as Record<string, unknown> | undefined;
    if (!row) return [];
    const p: Progress = { titleId, season: Number(row.season), episode: Number(row.episode), position: Number(row.position), duration: Number(row.duration), updatedAt: Number(row.updated_at) };
    const spot = spotOf(u, p, origin);
    if (!spot) return [];
    const who = everyone.find((x) => x.username === f) ?? { username: f, name: f, picture: null };
    const live = nowOf(u, f, origin, now);
    return [{ ...who, season: p.season, episode: p.episode, label: spot.label, progress: spot.progress, finished: spot.finished, at: spot.at, now: live?.title.id === titleId }];
  }).sort((a, b) => Number(b.now) - Number(a.now) || b.at - a.at);
}

/** `{ type: "ask" | "yes" | "no" | "remove", username }`: friendship changes, Kimono's (lib/friends). Answers the link now. */
export async function changeFriend(username: string, raw: Record<string, unknown>): Promise<{ state: LinkState | null }> {
  try { return await changeKimonoFriend(username, raw); } catch (error) {
    if (error instanceof FriendsProblem) throw new WatchProblem(error.message, error.status);
    throw error;
  }
}

/** Asks a friend who's watching something whether you can join them. */
export async function askToJoin(cfg: WatchConfig, username: string, raw: Record<string, unknown>) {
  const u = username.toLowerCase();
  const to = String(raw.to ?? "").toLowerCase();
  if (linkBetween(u, to) !== "friends" || !sharing(to)) throw new WatchProblem("You can only ask friends.", 403);
  const live = nowOf(u, to, "", Date.now());
  if (!live) throw new WatchProblem("They've stopped watching.", 409);
  await ensureTitle(cfg, live.title.id);
  const made = newAsk(asks, { id: `j${randomBytes(9).toString("base64url")}`, from: u, to, titleId: live.title.id, season: live.season, episode: live.episode, at: Date.now() }, Date.now());
  keep(made.asks);
  if (!made.ask) throw new WatchProblem("They said not now. Try again in a bit.", 429);
  return { ask: askView(made.ask, await people(), u) };
}

/** `{ yes, partyId? }` from the one asked (partyId: the party they've just started or are in), or `{ cancel: true }` from the asker. */
export async function answerJoin(username: string, id: string, raw: Record<string, unknown>) {
  const u = username.toLowerCase();
  const now = Date.now();
  if (raw.cancel === true) { keep(cancelAsk(asks, id, u)); return { ok: true }; }
  const yes = raw.yes === true;
  const partyId = typeof raw.partyId === "string" ? raw.partyId : null;
  const ask = liveAsks(asks, now).find((a) => a.id === id && a.to === u);
  if (!ask) throw new WatchProblem("They stopped asking.", 404);
  if (yes && (!partyId || !inviteTo(partyId, u, [ask.from]))) throw new WatchProblem("That party has ended.", 409);
  const out = answerAsk(asks, id, u, yes, partyId, now);
  keep(out.asks);
  if (!out.ask) throw new WatchProblem("They stopped asking.", 404);
  return { ok: true, ask: askView(out.ask, await people(), u) };
}

/* ───── Taste: friends' lists and ratings ───── */

/**
 * A friend's taste, for their page: what they loved, liked and didn't like (latest first) and their list.
 * Only a friend's, and only while they share it (Settings › Friends); titles they hid from friends stay out.
 */
export async function friendTaste(username: string, them: string, origin: string) {
  const u = username.toLowerCase(), f = them.toLowerCase();
  const db = watchDb();
  if (!friendsOfUser(u).includes(f)) throw new WatchProblem("You aren't friends.", 404);
  const who = (await people()).find((p) => p.username === f) ?? { username: f, name: f, picture: null };
  if (!sharesTaste(f)) return { ...who, sharing: false, loved: [] as Card[], liked: [] as Card[], disliked: [] as Card[], list: [] as Card[] };
  const hidden = hiddenOf(db, f);
  const cards = (ids: string[]) => getTitles(db, ids.filter((id) => !hidden.has(id)).slice(0, 60)).map((t: Title) => cardOf(t, origin));
  const rated = ratingsOf(f);
  const of = (r: RatingRow["rating"]) => cards(rated.filter((x) => x.rating === r).map((x) => x.title_id));
  const list = (db.prepare("SELECT title_id FROM list WHERE lower(username) = ? ORDER BY added_at DESC").all(f) as { title_id: string }[]).map((r) => r.title_id);
  return { ...who, sharing: true, loved: of("love"), liked: of("up"), disliked: of("down"), list: cards(list) };
}

/** What friends thought of one title, for its page: each friend sharing their taste who rated it or has it on their list. */
export async function friendsRated(username: string, titleId: string) {
  const u = username.toLowerCase();
  const db = watchDb();
  const list = friendsOfUser(u).filter(sharesTaste).filter((f) => !hiddenOf(db, f).has(titleId));
  if (!list.length) return [];
  const everyone = await people();
  const order = { love: 0, up: 1, down: 2 } as const;
  return list.flatMap((f) => {
    const rating = (db.prepare("SELECT rating FROM ratings WHERE lower(username) = ? AND title_id = ?").get(f, titleId) as { rating?: RatingRow["rating"] } | undefined)?.rating ?? null;
    const listed = Boolean(db.prepare("SELECT 1 FROM list WHERE lower(username) = ? AND title_id = ?").get(f, titleId));
    if (!rating && !listed) return [];
    const who = everyone.find((x) => x.username === f) ?? { username: f, name: f, picture: null };
    return [{ ...who, rating, listed }];
  }).sort((a, b) => (a.rating ? order[a.rating] : 3) - (b.rating ? order[b.rating] : 3));
}

/**
 * Home's "Your friends liked" row: what friends sharing their taste loved or liked, the most liked
 * (a love counts twice) and the latest first; what this person rated already or hid stays out. Null with nothing to show.
 */
export async function friendsLikedRow(username: string, origin: string, shelf?: Title["shelf"]) {
  const u = username.toLowerCase();
  const db = watchDb();
  if (prefsOf(db, u).friendsOnHome === false) return null;
  const friends = friendsOfUser(u).filter(sharesTaste);
  if (!friends.length) return null;
  const ids = likedByFriends(db, u, friends).slice(0, 40);
  const items = getTitles(db, ids).filter((t) => !shelf || t.shelf === shelf).slice(0, 20).map((t) => cardOf(t, origin));
  return items.length ? { id: "friends-liked", title: "Your friends liked", kind: "cards", items } : null;
}

/**
 * Home's "Your friends are watching" row: what friends sharing what they watch have been on in the
 * last two weeks, the titles the most of them are on first, then the latest. Null with nothing to show.
 */
export async function friendsWatchingRow(username: string, origin: string, shelf?: Title["shelf"], now = Date.now()) {
  const u = username.toLowerCase();
  const db = watchDb();
  if (prefsOf(db, u).friendsOnHome === false) return null;
  const friends = friendsOfUser(u).filter(sharing);
  if (!friends.length) return null;
  const ids = watchedByFriends(db, friends, now - 14 * 24 * 3600_000).slice(0, 40);
  const items = getTitles(db, ids).filter((t) => !shelf || t.shelf === shelf).slice(0, 20).map((t) => cardOf(t, origin));
  return items.length ? { id: "friends-watching", title: "Your friends are watching", kind: "cards", items } : null;
}

/* ───── On a Kimono profile ───── */

/**
 * Watch's rows on someone's Kimono profile (lib/friends, which shows them only to friends): what they've watched,
 * loved and liked, and My list. Watch's own settings still hold: what's watched only while they share it
 * (Settings › Friends), ratings and the list only while they share their taste, never what they watched invisibly.
 * Their own profile shows the same, so they see what friends see. Nothing when Watch is off.
 */
export async function watchSections(viewer: string, username: string, origin: string): Promise<Section[]> {
  void viewer;
  if (!watchConfig(await getPlatformSettings()).enabled) return [];
  const u = username.toLowerCase();
  const db = watchDb();
  const hidden = hiddenOf(db, u);
  const item = (t: Title) => ({ app: "watch", itemId: t.id, title: t.name, subtitle: t.year ? String(t.year) : null, cover: cardOf(t, origin).poster, href: `/watch?t=${encodeURIComponent(t.id)}` });
  /* `at`: when each was rated or listed, so a title taken off the profile comes back once that changes. */
  const row = (kind: string, title: string, ids: string[], at: Map<string, number | null> = new Map()): Section =>
    ({ app: "watch", appName: "Watch", kind, title, items: getTitles(db, ids.filter((id) => !hidden.has(id)).slice(0, 24)).map((t) => ({ ...item(t), at: at.get(t.id) ?? null })) });
  const rows: Section[] = [];
  /* Going invisible on Kimono is the profile's to apply (lib/friends profileFor), so their own profile still shows it all. */
  if (sharingSet(u)) rows.push(row("watched", "Watched", lastRows(u, 24).map((p) => p.titleId)));
  if (sharesTasteSet(u)) {
    const rated = ratingsOf(u);
    const ratedAt = new Map(rated.map((r) => [r.title_id, r.rated_at ?? null]));
    rows.push(row("loved", "Loved", rated.filter((r) => r.rating === "love").map((r) => r.title_id), ratedAt));
    rows.push(row("liked", "Liked", rated.filter((r) => r.rating === "up").map((r) => r.title_id), ratedAt));
    const list = db.prepare("SELECT title_id, added_at FROM list WHERE lower(username) = ? ORDER BY added_at DESC").all(u) as { title_id: string; added_at: number | null }[];
    rows.push(row("listed", "Watchlist", list.map((r) => r.title_id), new Map(list.map((r) => [r.title_id, r.added_at]))));
  }
  return rows.filter((r) => r.items.length > 0);
}

/* ───── On Kimono's Home ───── */

/**
 * What friends are on in Watch, for Kimono Home's friends feed (lib/friends activityOf): what each is watching
 * now and has watched lately, from the Friends page, with Watch's own switches for lib/friends to apply again.
 * Null when Watch is off.
 */
export async function watchActivity(viewer: string, origin: string) {
  if (!watchConfig(await getPlatformSettings()).enabled) return null;
  const page = await friendsPage(viewer, origin);
  const item = (username: string, kind: "watching" | "watched", s: Spot) => ({
    kind, app: "watch", from: username, itemId: s.title.id, title: s.title.name, subtitle: s.title.year ? String(s.title.year) : null,
    cover: s.title.poster, href: `/watch?t=${encodeURIComponent(s.title.id)}`, at: s.at, progress: s.progress, label: s.label,
  });
  const items = page.friends.flatMap((f) => [
    ...(f.now ? [item(f.username, "watching", f.now)] : []),
    ...f.recent.filter((s) => s.title.id !== f.now?.title.id).map((s) => item(f.username, "watched", s)),
  ]);
  return { items, share: { sharing, hidden: (username: string) => hiddenOf(watchDb(), username) } };
}
