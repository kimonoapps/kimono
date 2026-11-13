import "server-only";

import { randomBytes } from "node:crypto";
import type { WatchConfig } from "./config";
import { cardOf, ensureTitle, finished, fraction, getTitle, prefsOf, watchDb, WatchProblem, type Card, type Progress } from "./index";
import { playingNow, watchKey } from "./flow";
import {
  answerAsk, answerFriend, askFriend, cancelAsk, friendsOf, hiddenOf, linkOf, linksOf, liveAsks, newAsk, noteWatched, removeFriend,
  type JoinAsk, type LinkState,
} from "./friends";
import { inviteTo, labelsFor, partyWith, people, type Person } from "./together-live";

/*
 * 友 Friends on the server (./friends.ts has the rules): who's friends, what
 * each is watching now and where they are in things, and asks to join.
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

const sharing = (username: string) => prefsOf(watchDb(), username.toLowerCase()).shareWatching !== false;
const invisible = (username: string) => prefsOf(watchDb(), username.toLowerCase()).invisible === true;

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

/** The Friends page: friends with what they're on now and lately, who asked, who's been asked, and everyone else to ask. */
export async function friendsPage(username: string, origin: string) {
  const u = username.toLowerCase();
  const db = watchDb();
  const everyone = await people();
  const links = linksOf(db, u);
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
  const linked = new Set(links.map((l) => l.username));
  return {
    sharing: sharing(u),
    invisible: invisible(u),
    friends,
    asked: links.filter((l) => l.state === "asked").map((l) => person(l.username)),
    asking: links.filter((l) => l.state === "asking").map((l) => person(l.username)),
    people: everyone.filter((p) => p.username !== u && !linked.has(p.username)),
    ...(await asksOf(u)),
  };
}

/** Friends' places in one title, for its page: where each is, and who's on it now. */
export async function friendsOn(username: string, titleId: string, origin: string) {
  const u = username.toLowerCase();
  const db = watchDb();
  const list = friendsOf(db, u).filter(sharing);
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

/** `{ type: "ask" | "yes" | "no" | "remove", username }`: friendship changes. Answers the link now. */
export async function changeFriend(username: string, raw: Record<string, unknown>): Promise<{ state: LinkState | null }> {
  const u = username.toLowerCase();
  const them = String(raw.username ?? "").toLowerCase();
  if (!them || them === u) throw new WatchProblem("Pick someone else.", 400);
  if (!(await people()).some((p) => p.username === them)) throw new WatchProblem("They aren't on this Kimono.", 404);
  const db = watchDb();
  switch (raw.type) {
    case "ask": return { state: askFriend(db, u, them) };
    case "yes": return { state: answerFriend(db, u, them, true) };
    case "no": return { state: answerFriend(db, u, them, false) };
    case "remove": removeFriend(db, u, them); return { state: null };
    default: throw new WatchProblem("That isn't something friends do.", 400);
  }
}

/** Asks a friend who's watching something whether you can join them. */
export async function askToJoin(cfg: WatchConfig, username: string, raw: Record<string, unknown>) {
  const u = username.toLowerCase();
  const to = String(raw.to ?? "").toLowerCase();
  const db = watchDb();
  if (linkOf(db, u, to) !== "friends" || !sharing(to)) throw new WatchProblem("You can only ask friends.", 403);
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
