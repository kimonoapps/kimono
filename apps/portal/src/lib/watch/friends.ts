/**
 * 友 Friends on Watch: who sees what you watch.
 *
 * Who's friends is Kimono's (lib/friends); here is what Watch does with it:
 * each friend sees what the other is watching right now and how far they are
 * in every show.
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

/** Watch's own tables. Its old `friends` table is only read once, to bring friendships into lib/friends. */
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

/* Friendship itself is Kimono's (lib/friends/model.ts): Watch builds on its friend list. */
export { answerFriend, areFriends, askFriend, friendsOf, linkOf, linksOf, removeFriend, type Link, type LinkState } from "../friends/model";

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

/**
 * What [friends] loved or liked that [me] hasn't rated, for Home's "Your friends liked": the most liked first
 * (a love counts twice), then the latest; a friend's hidden titles and what they didn't like stay out.
 */
export function likedByFriends(db: DatabaseSync, me: string, friends: string[]): string[] {
  const rated = (u: string) => db.prepare("SELECT title_id, rating, rated_at FROM ratings WHERE lower(username) = ?").all(u.toLowerCase()) as { title_id: string; rating: string; rated_at: number | null }[];
  const mine = new Set(rated(me).map((r) => r.title_id));
  const score = new Map<string, { points: number; at: number }>();
  for (const f of friends) {
    const hidden = hiddenOf(db, f);
    for (const r of rated(f)) {
      if ((r.rating !== "up" && r.rating !== "love") || mine.has(r.title_id) || hidden.has(r.title_id)) continue;
      const was = score.get(r.title_id) ?? { points: 0, at: 0 };
      score.set(r.title_id, { points: was.points + (r.rating === "love" ? 2 : 1), at: Math.max(was.at, r.rated_at ?? 0) });
    }
  }
  return [...score.entries()].sort((a, b) => b[1].points - a[1].points || b[1].at - a[1].at).map(([id]) => id);
}

/**
 * What [friends] have been watching since [since], for Home's "Your friends are watching": the titles
 * the most of them are on first, then the latest; a friend's hidden titles stay out.
 */
export function watchedByFriends(db: DatabaseSync, friends: string[], since: number): string[] {
  const score = new Map<string, { people: number; at: number }>();
  for (const f of friends) {
    const hidden = hiddenOf(db, f);
    const rows = db.prepare("SELECT title_id, max(updated_at) AS at FROM progress WHERE lower(username) = ? AND updated_at >= ? GROUP BY title_id").all(f.toLowerCase(), since) as { title_id: string; at: number }[];
    for (const r of rows) {
      if (hidden.has(r.title_id)) continue;
      const was = score.get(r.title_id) ?? { people: 0, at: 0 };
      score.set(r.title_id, { people: was.people + 1, at: Math.max(was.at, r.at) });
    }
  }
  return [...score.entries()].sort((a, b) => b[1].people - a[1].people || b[1].at - a[1].at).map(([id]) => id);
}
