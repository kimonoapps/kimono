/**
 * 友 Friends on Watch: who sees what you watch.
 *
 * Anyone in the household can ask anyone else; once the other says yes,
 * each sees what the other is watching right now and how far they are in
 * every show. Asking someone who already asked you makes you friends.
 * Nobody sees anything of someone who turned off "Show friends what I watch".
 * Invisible is for now: friends don't see you watching or can ask to join,
 * and what you watch meanwhile stays hidden until you watch it visibly again.
 *
 * Asking to join: a friend watching something on their own (or in a party)
 * can be asked "can I join?". Their player shows it; a yes moves them into a
 * party (a new one from where they are, or the one they're in) with the one
 * who asked invited, and the asker's screen follows. Asks live a couple of
 * minutes, in memory: a restart only forgets the ones still waiting.
 *
 * Pure logic over SQLite and plain objects, tested in scripts/test-watch.mjs;
 * ./friends-live.ts serves it.
 */
import type { DatabaseSync } from "node:sqlite";

export function migrateFriends(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS friends (a TEXT NOT NULL, b TEXT NOT NULL, asked_by TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (a, b));
    CREATE INDEX IF NOT EXISTS friends_b ON friends (b);
    CREATE TABLE IF NOT EXISTS friends_hidden (username TEXT NOT NULL, title_id TEXT NOT NULL, PRIMARY KEY (username, title_id));`);
}

/* ───── Invisible ───── */

/** A title played while invisible stays hidden from friends; played again while visible, it shows again. */
export function noteWatched(db: DatabaseSync, username: string, titleId: string, invisible: boolean) {
  const u = username.toLowerCase();
  if (invisible) db.prepare("INSERT OR IGNORE INTO friends_hidden (username, title_id) VALUES (?, ?)").run(u, titleId);
  else db.prepare("DELETE FROM friends_hidden WHERE username = ? AND title_id = ?").run(u, titleId);
}

export function hiddenOf(db: DatabaseSync, username: string): Set<string> {
  return new Set((db.prepare("SELECT title_id FROM friends_hidden WHERE username = ?").all(username.toLowerCase()) as { title_id: string }[]).map((r) => r.title_id));
}

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
  return linksOf(db, me).find((l) => l.username === them.toLowerCase())?.state ?? null;
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

/** Says yes or no to someone who asked. No (or taking an ask back, or unfriending) forgets the link. */
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
}

/* ───── Asking to join ───── */

export type JoinAsk = {
  id: string;
  from: string; to: string;
  /** What `to` was watching when asked. */
  titleId: string; season: number; episode: number;
  at: number;
  answer: "waiting" | "yes" | "no";
  /** The party to go to, on a yes. */
  partyId: string | null;
  answeredAt: number | null;
};

export const joinAsks = {
  /** Unanswered this long, it's let go (the asker sees "no answer"). */
  waitFor: 2 * 60_000,
  /** An answer stays this long for the asker to pick up. */
  keepAnswer: 60_000,
  /** One ask from a person to a person at a time; a new one after a no waits this long. */
  againAfter: 30_000,
};

/** The asks still worth keeping. */
export function liveAsks(asks: JoinAsk[], now: number): JoinAsk[] {
  return asks.filter((a) => (a.answer === "waiting" ? now - a.at < joinAsks.waitFor : now - (a.answeredAt ?? a.at) < joinAsks.keepAnswer));
}

/** A new ask, or the one already waiting; null when they just said no. */
export function newAsk(asks: JoinAsk[], ask: Omit<JoinAsk, "answer" | "partyId" | "answeredAt">, now: number): { asks: JoinAsk[]; ask: JoinAsk | null } {
  const kept = liveAsks(asks, now);
  const same = kept.filter((a) => a.from === ask.from && a.to === ask.to);
  const waiting = same.find((a) => a.answer === "waiting");
  if (waiting) return { asks: kept, ask: waiting };
  if (same.some((a) => a.answer === "no" && now - (a.answeredAt ?? 0) < joinAsks.againAfter)) return { asks: kept, ask: null };
  const made: JoinAsk = { ...ask, answer: "waiting", partyId: null, answeredAt: null };
  return { asks: [...kept.filter((a) => !(a.from === ask.from && a.to === ask.to)), made], ask: made };
}

/** `to` answers: yes with the party to go to, or no. Only a waiting ask to them can be answered. */
export function answerAsk(asks: JoinAsk[], id: string, by: string, yes: boolean, partyId: string | null, now: number): { asks: JoinAsk[]; ask: JoinAsk | null } {
  const kept = liveAsks(asks, now);
  const ask = kept.find((a) => a.id === id && a.to === by.toLowerCase() && a.answer === "waiting");
  if (!ask || (yes && !partyId)) return { asks: kept, ask: null };
  const done: JoinAsk = { ...ask, answer: yes ? "yes" : "no", partyId: yes ? partyId : null, answeredAt: now };
  return { asks: kept.map((a) => (a.id === id ? done : a)), ask: done };
}

/** The asker takes it back. */
export const cancelAsk = (asks: JoinAsk[], id: string, by: string) => asks.filter((a) => !(a.id === id && a.from === by.toLowerCase()));
