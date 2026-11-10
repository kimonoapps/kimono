/**
 * 共 Watch Together: one timeline, many screens.
 *
 * A party is a film or an episode the household watches at the same moment
 * from wherever they are. Each screen finds its own stream with play (its own
 * quality, sub or dub, subtitles); what's shared is the timeline only: which
 * episode, playing or paused, the position and rate, and the server time they
 * were set. Where anyone should be is then position + (now − at) × rate.
 *
 * - Commands (play, pause, seek, episode, …) come with the number of the last
 *   state the screen saw (seq). A seek or an episode change made against an
 *   older state is refused as stale: someone else moved first. Play and pause
 *   are wishes and always land. Every accepted change raises seq, so screens
 *   ignore anything older than what they hold.
 * - Screens report how they're doing (loading, ready, buffering). Anyone
 *   buffering for more than 1.5 s holds the party: it pauses where it is,
 *   says who it waits for, and starts again together, a moment ahead, when
 *   everyone is ready. A screen that keeps buffering, or drops off, stops
 *   holding the rest up after a while.
 * - A new episode waits for everyone in the party to load it. Someone who
 *   joins late or comes back simply lands where the party is.
 * - Each screen keeps to the timeline itself: small drift is taken out by
 *   nudging the playback rate (0.95–1.05), anything over 2 s by seeking. It
 *   reads the server's clock NTP-style (clockOffset).
 *
 * Pure logic over plain objects (and SQLite for keeping parties), tested in
 * scripts/test-watch.mjs; ./together-live.ts runs it on the server, and the
 * web player uses the same maths.
 */
import type { DatabaseSync } from "node:sqlite";

export type EpisodeRef = { season: number; episode: number };
export type Timeline = {
  titleId: string; season: number; episode: number;
  playing: boolean;
  /** Seconds in at `at`; while playing it moves on from there at `rate`. */
  position: number; rate: number;
  /** Server time (ms) the timeline was set. A start can be set a moment ahead, so everyone starts together. */
  at: number;
};
export type MemberState = "loading" | "ready" | "buffering";
export type Member = {
  /** One screen: a browser tab or an app. The same person on two screens is two members. */
  client: string; username: string;
  state: MemberState;
  /** When `state` began, and when the screen was last heard from (server ms). */
  since: number; seen: number; joined: number;
};
export type Hold = {
  /** Loading: a new episode waits for everyone in the party. Buffering: someone's stream stalled. */
  reason: "loading" | "buffering";
  waitingFor: string[];
  since: number;
  /** Whether to play again once nobody is waited for (a pause during the wait keeps it paused). */
  resume: boolean;
};
export type Countdown = { to: EpisodeRef & { skipped: number }; endsAt: number };
export type ChatLine = { id: string; username: string; text: string; at: number };
export type Party = {
  id: string;
  /** The person who started it, or who took over when they left. */
  host: string;
  /** Only the host can play, pause, seek and change episode. */
  hostOnly: boolean;
  invited: string[];
  timeline: Timeline;
  /** Raised by every change screens see, so they can ignore older news. */
  seq: number;
  /** The seq of the last change to the timeline itself (play, seek, a wait, an episode): what a seek must have seen. */
  moved: number;
  hold: Hold | null;
  countdown: Countdown | null;
  /** Who made the last change to the timeline and what it was, for "Sami paused"; null when the party did it (a wait). */
  by: { username: string; client: string; type: Command["type"] } | null;
  members: Member[];
  chat: ChatLine[];
  createdAt: number; updatedAt: number;
  /** When the last screen went away; the party ends a few minutes after. */
  emptySince: number | null;
  ended: boolean;
};

export const together = {
  /** Buffering this long holds everyone. */
  stallAfter: 1500,
  /** A screen still buffering after this long stops holding the rest. */
  bufferingGivesUpAfter: 20_000,
  /** A new episode waits this long for slow screens. */
  loadingGivesUpAfter: 30_000,
  /** Not heard from (no live channel, no report) for this long: not waited for. */
  goneAfter: 15_000,
  /** Gone this long: off the list. */
  dropAfter: 60_000,
  /** Nobody here for this long: the party ends. */
  endAfter: 5 * 60_000,
  /** Starting again after a wait: this far ahead, so every screen starts on the same frame. */
  lead: 700,
  /** The shared next-episode countdown. */
  countdown: 10_000,
  /** Drift: seek past this; nudge the rate past `nudgeFrom`, until under `nudgeTo`. */
  seekPast: 2, nudgeFrom: 0.15, nudgeTo: 0.04, maxNudge: 0.05,
  chatKept: 50,
} as const;

export const reactions = ["❤️", "😂", "😮", "😢", "👏", "🔥"] as const;

/* ───── The maths ───── */

/** Where the timeline is at server time `now`, in seconds. */
export function positionAt(t: Pick<Timeline, "playing" | "position" | "rate" | "at">, now: number): number {
  if (!t.playing) return t.position;
  return t.position + (Math.max(0, now - t.at) / 1000) * t.rate;
}

export type Correction = { seek: number | null; rate: number; correcting: boolean };
/**
 * What a screen playing at `local` does to keep to `expected`: seek when
 * it's more than 2 s out, else ease the rate (never past ±5%) until it's
 * back within 40 ms; under 150 ms it leaves well alone. `correcting` is
 * what the last decision said, for that hysteresis.
 */
export function correction(local: number, expected: number, correcting: boolean, rate = 1): Correction {
  const drift = local - expected;
  if (Math.abs(drift) > together.seekPast) return { seek: expected, rate, correcting: false };
  if (Math.abs(drift) < (correcting ? together.nudgeTo : together.nudgeFrom)) return { seek: null, rate, correcting: false };
  const nudge = Math.max(-together.maxNudge, Math.min(together.maxNudge, drift * 0.2));
  return { seek: null, rate: rate * (1 - nudge), correcting: true };
}

export type ClockSample = { sent: number; received: number; server: number };
/**
 * The server clock less this one, NTP-style: each ping's offset is the
 * server's time less the middle of its round trip. The quickest third of the
 * pings are the ones least skewed by a slow leg; their median is the answer.
 */
export function clockOffset(samples: ClockSample[]): { offset: number; rtt: number } | null {
  const ok = samples.filter((s) => s.received >= s.sent);
  if (!ok.length) return null;
  const sorted = [...ok].sort((a, b) => (a.received - a.sent) - (b.received - b.sent));
  const best = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
  const offsets = best.map((s) => s.server - (s.sent + s.received) / 2).sort((a, b) => a - b);
  const mid = offsets.length >> 1;
  const offset = offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2;
  return { offset, rtt: best[0].received - best[0].sent };
}

/** Whether a state a screen receives is news: anything at or before what it holds is old. */
export const newer = (held: number, incoming: number) => incoming > held;

/* ───── Members ───── */

export const present = (m: Member, now: number) => now - m.seen < together.goneAfter;

/** A screen says how it is: joined if new, its state's start kept unless it changed. */
export function report(party: Party, who: { client: string; username: string }, state: MemberState, now: number): Party {
  const known = party.members.find((m) => m.client === who.client);
  const members = known
    ? party.members.map((m) => (m.client === who.client ? { ...m, state, since: m.state === state ? m.since : now, seen: now } : m))
    : [...party.members, { client: who.client, username: who.username.toLowerCase(), state, since: now, seen: now, joined: now }];
  const next = { ...party, members, emptySince: null };
  /* Who's buffering or back is news to everyone; a report that changes nothing isn't. */
  return !known || known.state !== state || !present(known, now) ? bump(next, {}, now) : next;
}

/** Heard from without a report: the live channel is still open. */
export function seen(party: Party, clients: Iterable<string>, now: number): Party {
  const here = new Set(clients);
  if (!here.size) return party;
  return { ...party, members: party.members.map((m) => (here.has(m.client) ? { ...m, seen: now } : m)) };
}

export function leave(party: Party, client: string, now: number): Party {
  if (!party.members.some((m) => m.client === client)) return party;
  const members = party.members.filter((m) => m.client !== client);
  return bump(handOver({ ...party, members, emptySince: members.some((m) => present(m, now)) ? null : (party.emptySince ?? now) }), {}, now);
}

/** The host left: the person on the screen that's been here longest takes over. */
function handOver(party: Party): Party {
  if (!party.members.length || party.members.some((m) => m.username === party.host)) return party;
  const first = [...party.members].sort((a, b) => a.joined - b.joined)[0];
  return { ...party, host: first.username };
}

/* ───── Commands ───── */

export type Command =
  | { type: "play"; position?: number }
  | { type: "pause"; position?: number }
  | { type: "seek"; position: number }
  | { type: "rate"; rate: number }
  | { type: "episode"; season: number; episode: number }
  | { type: "countdown"; to: EpisodeRef & { skipped: number } }
  | { type: "cancel-countdown" }
  | { type: "skip-wait" }
  | { type: "host-only"; on: boolean };

export type Outcome = { ok: true; party: Party; changed: boolean } | { ok: false; reason: "stale" | "host-only" | "invalid"; party: Party };

const steer = new Set(["play", "pause", "seek", "rate", "episode", "countdown", "cancel-countdown", "skip-wait"]);
/** Seeks and episode changes made against an older state lose to whoever moved first. */
const needsFresh = new Set(["seek", "rate", "episode", "countdown"]);

/** A change screens see (who's here, invites, the host switch). */
const bump = (party: Party, change: Partial<Party>, now: number): Party => ({ ...party, ...change, seq: party.seq + 1, updatedAt: now });
/** A change to the timeline: a seek made before seeing it is stale. */
const move = (party: Party, change: Partial<Party>, now: number): Party => ({ ...party, by: null, ...change, seq: party.seq + 1, moved: party.seq + 1, updatedAt: now });
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
/** A screen's own position for a pause, if it's near where the party is (it saw that frame); else the party's. */
const near = (asked: unknown, expected: number) => (finite(asked) && asked >= 0 && Math.abs(asked - expected) <= 3 ? asked : expected);

/** Applies one command from `by`, who had seen state `seenSeq`. */
export function command(party: Party, by: { username: string; client?: string }, cmd: Command, seenSeq: number, now: number): Outcome {
  const out = steerWith(party, by, cmd, seenSeq, now);
  if (!out.ok || !out.changed || out.party.moved === party.moved) return out;
  return { ...out, party: { ...out.party, by: { username: by.username.toLowerCase(), client: by.client ?? "", type: cmd.type } } };
}

function steerWith(party: Party, by: { username: string }, cmd: Command, seenSeq: number, now: number): Outcome {
  if (party.ended) return { ok: false, reason: "invalid", party };
  if (steer.has(cmd.type) && party.hostOnly && by.username.toLowerCase() !== party.host) return { ok: false, reason: "host-only", party };
  if (cmd.type === "host-only" && by.username.toLowerCase() !== party.host) return { ok: false, reason: "host-only", party };
  if (needsFresh.has(cmd.type) && seenSeq < party.moved) return { ok: false, reason: "stale", party };
  const t = party.timeline, here = positionAt(t, now);
  switch (cmd.type) {
    case "play": {
      /* Waiting for someone: playing again is already the plan. */
      if (party.hold) return party.hold.resume ? { ok: true, party, changed: false } : { ok: true, party: move(party, { hold: { ...party.hold, resume: true } }, now), changed: true };
      if (t.playing) return { ok: true, party, changed: false };
      return { ok: true, party: move(party, { timeline: { ...t, playing: true, position: near(cmd.position, here), at: now } }, now), changed: true };
    }
    case "pause": {
      if (party.hold) return !party.hold.resume ? { ok: true, party, changed: false } : { ok: true, party: move(party, { hold: { ...party.hold, resume: false } }, now), changed: true };
      if (!t.playing) return { ok: true, party, changed: false };
      return { ok: true, party: move(party, { timeline: { ...t, playing: false, position: near(cmd.position, here), at: now } }, now), changed: true };
    }
    case "seek": {
      if (!finite(cmd.position) || cmd.position < 0) return { ok: false, reason: "invalid", party };
      /* Off the end of the credits: the countdown or the end card take it from there. */
      return { ok: true, party: move(party, { timeline: { ...t, position: cmd.position, at: now }, countdown: null }, now), changed: true };
    }
    case "rate": {
      if (!finite(cmd.rate) || cmd.rate < 0.5 || cmd.rate > 2) return { ok: false, reason: "invalid", party };
      return { ok: true, party: move(party, { timeline: { ...t, position: here, rate: cmd.rate, at: now } }, now), changed: true };
    }
    case "episode": {
      if (!Number.isSafeInteger(cmd.season) || !Number.isSafeInteger(cmd.episode) || cmd.season < 0 || cmd.episode < 0) return { ok: false, reason: "invalid", party };
      return { ok: true, party: startEpisode(party, { season: cmd.season, episode: cmd.episode }, now), changed: true };
    }
    case "countdown": {
      if (party.countdown) return { ok: true, party, changed: false };
      return { ok: true, party: move(party, { countdown: { to: cmd.to, endsAt: now + together.countdown } }, now), changed: true };
    }
    case "cancel-countdown":
      return party.countdown ? { ok: true, party: move(party, { countdown: null }, now), changed: true } : { ok: true, party, changed: false };
    case "skip-wait":
      return party.hold ? { ok: true, party: release(party, now), changed: true } : { ok: true, party, changed: false };
    case "host-only":
      return { ok: true, party: bump(party, { hostOnly: Boolean(cmd.on) }, now), changed: Boolean(cmd.on) !== party.hostOnly };
  }
  return { ok: false, reason: "invalid", party };
}

/** A command as it came over the wire, or null when it isn't one. */
export function parseCommand(raw: Record<string, unknown>): Command | null {
  const n = (v: unknown) => (typeof v === "number" ? v : Number.NaN);
  switch (raw.type) {
    case "play": case "pause": return { type: raw.type, ...(finite(raw.position) ? { position: raw.position } : {}) };
    case "seek": return finite(raw.position) ? { type: "seek", position: raw.position } : null;
    case "rate": return finite(raw.rate) ? { type: "rate", rate: raw.rate } : null;
    case "episode": return { type: "episode", season: n(raw.season), episode: n(raw.episode) };
    case "cancel-countdown": case "skip-wait": return { type: raw.type };
    case "host-only": return { type: "host-only", on: raw.on === true };
  }
  return null;
}

/** Everyone moves to an episode: from the top, playing once all who are here have loaded it. */
export function startEpisode(party: Party, to: EpisodeRef, now: number, position = 0): Party {
  const here = party.members.filter((m) => present(m, now));
  return move(party, {
    timeline: { ...party.timeline, season: to.season, episode: to.episode, position, playing: true, at: now },
    members: party.members.map((m) => ({ ...m, state: "loading" as const, since: now })),
    hold: here.length ? { reason: "loading", waitingFor: here.map((m) => m.client), since: now, resume: true } : null,
    countdown: null,
  }, now);
}

/** Nobody left to wait for: play again together a moment from now, or stay paused if someone paused. */
function release(party: Party, now: number): Party {
  const hold = party.hold;
  if (!hold) return party;
  const t = party.timeline;
  return move(party, {
    hold: null,
    timeline: hold.resume ? { ...t, playing: true, at: now + together.lead } : { ...t, playing: false, at: now },
  }, now);
}

/**
 * The party's own clock, run every half second and after each report:
 * who's still here, whether to hold for someone or stop waiting, the
 * countdown running out, and the end once everyone has gone.
 */
export function tick(party: Party, now: number): { party: Party; changed: boolean } {
  if (party.ended) return { party, changed: false };
  const before = party.seq;
  let p = party;

  /* Long gone: off the list, the host handed on. */
  const kept = p.members.filter((m) => now - m.seen < together.dropAfter);
  if (kept.length !== p.members.length) p = bump(handOver({ ...p, members: kept }), {}, now);

  if (!p.members.some((m) => present(m, now))) {
    const emptySince = p.emptySince ?? now;
    if (now - emptySince >= together.endAfter) return { party: bump(p, { ended: true, emptySince }, now), changed: true };
    if (p.emptySince === null) p = { ...p, emptySince };
    return { party: p, changed: p.seq !== before };
  }
  if (p.emptySince !== null) p = { ...p, emptySince: null };

  if (p.countdown && now >= p.countdown.endsAt) p = startEpisode(p, p.countdown.to, now);
  const here = p.members.filter((m) => present(m, now));

  if (p.hold) {
    const hold = p.hold;
    /* The one who stalled until they're ready, and anyone else who stalls meanwhile; not a late joiner still loading. */
    const holding = (m: Member) => (hold.reason === "loading" ? hold.waitingFor.includes(m.client) && m.state !== "ready" : m.state === "buffering" || (hold.waitingFor.includes(m.client) && m.state !== "ready"));
    const all = here.filter(holding);
    /* Giving up on someone only helps when someone else is ready and waiting; with nobody ready, everyone waits. */
    const someoneReady = here.some((m) => !all.includes(m) && m.state === "ready");
    const waiting = (someoneReady ? all.filter((m) => now - (hold.reason === "loading" ? hold.since : m.since) < (hold.reason === "loading" ? together.loadingGivesUpAfter : together.bufferingGivesUpAfter)) : all).map((m) => m.client);
    if (!waiting.length) p = release(p, now);
    else if (waiting.join() !== hold.waitingFor.join()) p = bump(p, { hold: { ...hold, waitingFor: waiting } }, now);
  } else if (p.timeline.playing && now >= p.timeline.at) {
    const stalled = here.filter((m) => m.state === "buffering" && now - m.since >= together.stallAfter && now - m.since < together.bufferingGivesUpAfter);
    if (stalled.length) {
      const t = p.timeline;
      /* Back to where the one who stalled was, more or less: the stall started stallAfter ago. */
      const at = Math.max(0, positionAt(t, now) - together.stallAfter / 1000);
      p = move(p, {
        timeline: { ...t, playing: false, position: Math.max(Math.min(at, positionAt(t, now)), t.position), at: now },
        hold: { reason: "buffering", waitingFor: stalled.map((m) => m.client), since: now, resume: true },
      }, now);
    }
  }
  return { party: p, changed: p.seq !== before };
}

/* ───── Making one, and what screens see ───── */

export function newParty(id: string, host: { username: string; client: string }, timeline: Omit<Timeline, "at" | "rate" | "playing">, invited: string[], now: number): Party {
  const username = host.username.toLowerCase();
  return {
    id, host: username, hostOnly: false,
    invited: [...new Set(invited.map((u) => u.toLowerCase()).filter((u) => u && u !== username))].slice(0, 20),
    timeline: { ...timeline, playing: true, rate: 1, at: now },
    seq: 1, moved: 1,
    hold: { reason: "loading", waitingFor: [host.client], since: now, resume: true },
    countdown: null, by: null,
    members: [{ client: host.client, username, state: "loading", since: now, seen: now, joined: now }],
    chat: [], createdAt: now, updatedAt: now, emptySince: null, ended: false,
  };
}

export function invite(party: Party, usernames: string[], now: number): Party {
  const add = usernames.map((u) => u.toLowerCase()).filter((u) => u && u !== party.host && !party.invited.includes(u));
  if (!add.length) return party;
  return bump(party, { invited: [...party.invited, ...add].slice(0, 20) }, now);
}

export function decline(party: Party, username: string, now: number): Party {
  const u = username.toLowerCase();
  return party.invited.includes(u) ? bump(party, { invited: party.invited.filter((x) => x !== u) }, now) : party;
}

export function addChat(party: Party, username: string, text: string, id: string, now: number): { party: Party; line: ChatLine } | null {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!clean) return null;
  const line = { id, username: username.toLowerCase(), text: clean, at: now };
  return { party: { ...party, chat: [...party.chat, line].slice(-together.chatKept), updatedAt: now }, line };
}

export type PartyView = {
  id: string; host: string; hostOnly: boolean; invited: string[]; seq: number; moved: number;
  timeline: Timeline; hold: Hold | null; countdown: Countdown | null; by: Party["by"];
  members: { client: string; username: string; state: MemberState; present: boolean }[];
  ended: boolean;
  /** The server's clock when this was sent (ms). */
  now: number;
};
/** What screens are sent: the state, without the chat (sent on its own) and the bookkeeping. */
export function viewOf(party: Party, now: number): PartyView {
  return {
    id: party.id, host: party.host, hostOnly: party.hostOnly, invited: party.invited, seq: party.seq, moved: party.moved,
    timeline: party.timeline, hold: party.hold, countdown: party.countdown, by: party.by ?? null,
    members: party.members.map((m) => ({ client: m.client, username: m.username, state: m.state, present: present(m, now) })),
    ended: party.ended, now,
  };
}

export const cleanClient = (raw: unknown) => (typeof raw === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(raw) ? raw : null);
export const cleanPartyId = (raw: unknown) => (typeof raw === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(raw) ? raw : null);

/* ───── Kept in Watch's database, so a restart loses nothing ───── */

export function migrateTogether(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS parties (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL, ended INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS parties_open ON parties (ended, updated_at DESC);`);
}

export function saveParty(db: DatabaseSync, party: Party) {
  db.prepare("INSERT INTO parties (id, body, updated_at, ended) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, ended = excluded.ended")
    .run(party.id, JSON.stringify(party), party.updatedAt, party.ended ? 1 : 0);
}

export function loadParty(db: DatabaseSync, id: string): Party | null {
  const row = db.prepare("SELECT body FROM parties WHERE id = ?").get(id) as { body: string } | undefined;
  return row ? (JSON.parse(row.body) as Party) : null;
}

/** Parties still going that someone started, is in, or was asked to. */
export function partiesFor(db: DatabaseSync, username: string, now: number): Party[] {
  const u = username.toLowerCase();
  const rows = db.prepare("SELECT body FROM parties WHERE ended = 0 AND updated_at > ? ORDER BY updated_at DESC LIMIT 50").all(now - 12 * 60 * 60 * 1000) as { body: string }[];
  return rows.map((r) => JSON.parse(r.body) as Party).filter((p) => p.host === u || p.invited.includes(u) || p.members.some((m) => m.username === u));
}

/** Parties nobody has touched in half a day are over, whatever they say. */
export function endForgotten(db: DatabaseSync, now: number) {
  db.prepare("UPDATE parties SET ended = 1 WHERE ended = 0 AND updated_at < ?").run(now - 12 * 60 * 60 * 1000);
  db.prepare("DELETE FROM parties WHERE ended = 1 AND updated_at < ?").run(now - 7 * 24 * 60 * 60 * 1000);
}
