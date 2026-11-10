import "server-only";

import { randomBytes } from "node:crypto";
import { portalOrigin } from "../account";
import { listAccounts } from "../directory";
import { picturePaths } from "../pictures";
import type { WatchConfig } from "./config";
import { cardOf, ensureTitle, getTitle, namer, nextUp, prefsOf, watchDb, WatchProblem } from "./index";
import {
  addChat, cleanClient, command, decline, endForgotten, invite, labelView, leave, loadParty, newParty, parseCommand, partiesFor, reactions, report, saveParty, seen, tick, viewOf,
  type ChatLine, type MemberState, type Party, type PartyView,
} from "./together";

/*
 * 共 Watch Together on the server (./together.ts has the rules). While anyone
 * is in a party the Portal holds it here, runs its clock every half second,
 * and sends each change to every screen listening; it is written to Watch's
 * database as it changes, so a restart picks up where it was and screens
 * simply reconnect.
 */

export type LiveEvent =
  | { type: "state"; state: PartyView }
  | { type: "chat"; lines: ChatLine[] }
  | { type: "react"; username: string; client: string; emoji: string; at: number }
  | { type: "ended" };

type Listener = { client: string; username: string; send: (event: LiveEvent) => void };
type Room = { party: Party; listeners: Set<Listener>; savedAt: number; reacted: Map<string, number[]> };

/* Kept across hot reloads in development, as the database connection is. */
const cache = globalThis as unknown as { kimonoWatchParties?: Map<string, Room>; kimonoWatchPartyClock?: ReturnType<typeof setInterval>; kimonoWatchPeople?: { at: number; people: Person[] } };
const rooms: Map<string, Room> = (cache.kimonoWatchParties ??= new Map());

export type Person = { username: string; name: string; picture: string | null };

/** Everyone in the household, by name and portrait, for inviting and for showing who's here. */
export async function people(): Promise<Person[]> {
  if (cache.kimonoWatchPeople && Date.now() - cache.kimonoWatchPeople.at < 5 * 60_000) return cache.kimonoWatchPeople.people;
  const [accounts, pictures] = await Promise.all([listAccounts(), picturePaths()]);
  const origin = portalOrigin();
  const list = accounts.map((a) => {
    const picture = pictures[a.username.toLowerCase()];
    return { username: a.username.toLowerCase(), name: a.name || a.username, picture: picture ? `${origin}${picture}` : null };
  });
  cache.kimonoWatchPeople = { at: Date.now(), people: list };
  return list;
}

function roomOf(id: string): Room | null {
  const known = rooms.get(id);
  if (known) return known;
  const party = loadParty(watchDb(), id);
  if (!party || party.ended) return null;
  const room: Room = { party, listeners: new Set(), savedAt: Date.now(), reacted: new Map() };
  rooms.set(id, room);
  runClock();
  return room;
}

function must(id: string): Room {
  const room = roomOf(id);
  if (!room) throw new WatchProblem("This watch party has ended.", 404);
  return room;
}

function tell(room: Room, event: LiveEvent) { for (const l of room.listeners) l.send(event); }

/* How each person names a show's episodes (their layout setting), kept a minute per person and title. */
const namers = new Map<string, { at: number; label: ((season: number, episode: number) => string) | null }>();
function labelsFor(username: string, titleId: string) {
  const key = `${username.toLowerCase()}|${titleId}`;
  const known = namers.get(key);
  if (known && Date.now() - known.at < 60_000) return known.label;
  let label: ((season: number, episode: number) => string) | null = null;
  try {
    const db = watchDb();
    const title = getTitle(db, titleId);
    if (title && title.kind === "series") label = namer(db, title, prefsOf(db, username.toLowerCase())).label;
  } catch { /* unnamed is still right, just less friendly */ }
  if (namers.size > 500) namers.clear();
  namers.set(key, { at: Date.now(), label });
  return label;
}
/** The party as this person sees it: episodes named their way. */
const viewFor = (party: Party, username: string, now = Date.now()) => labelView(viewOf(party, now), labelsFor(username, party.timeline.titleId));

/** Takes the party's new state: kept, and sent to everyone when it's news. */
function commit(room: Room, next: Party, now = Date.now()) {
  const before = room.party;
  room.party = next;
  if (next.seq !== before.seq || now - room.savedAt > 10_000) { saveParty(watchDb(), next); room.savedAt = now; }
  if (next.seq !== before.seq) for (const l of room.listeners) l.send({ type: "state", state: viewFor(next, l.username, now) });
  if (next.ended) { tell(room, { type: "ended" }); rooms.delete(next.id); }
}

/* ───── The clock ───── */

function runClock() {
  if (cache.kimonoWatchPartyClock) return;
  cache.kimonoWatchPartyClock = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      try {
        const heard = seen(room.party, [...room.listeners].map((l) => l.client), now);
        commit(room, tick(heard, now).party, now);
        if (!room.listeners.size && room.party.emptySince !== null && now - room.party.emptySince > 60_000) {
          /* Nobody listening: written down, and let go from memory; the end comes from the database's sweep or a return. */
          saveParty(watchDb(), room.party);
          rooms.delete(room.party.id);
        }
      } catch (error) {
        console.warn("Watch Together: a party's clock failed:", error instanceof Error ? error.message : error);
      }
    }
    if (!rooms.size && cache.kimonoWatchPartyClock) { clearInterval(cache.kimonoWatchPartyClock); cache.kimonoWatchPartyClock = undefined; }
  }, 500);
  cache.kimonoWatchPartyClock.unref?.();
}
/* Over a hot reload, the old interval would run old code: start again with this. */
if (cache.kimonoWatchPartyClock) { clearInterval(cache.kimonoWatchPartyClock); cache.kimonoWatchPartyClock = undefined; if (rooms.size) runClock(); }

/* ───── What the routes call ───── */

const newId = () => `p${randomBytes(9).toString("base64url")}`;

/**
 * Starts a party: `{ titleId, season?, episode?, position?, client, invite?: [username] }`.
 * The one who starts it hosts, and it waits for their screen to load.
 */
export async function createParty(cfg: WatchConfig, username: string, raw: Record<string, unknown>) {
  const client = cleanClient(raw.client);
  if (!client) throw new WatchProblem("Say which screen this is.", 400);
  const title = await ensureTitle(cfg, String(raw.titleId ?? ""));
  const series = title.kind === "series";
  const position = Number(raw.position);
  const household = new Set((await people()).map((p) => p.username));
  const invited = (Array.isArray(raw.invite) ? raw.invite : []).filter((u): u is string => typeof u === "string" && household.has(u.toLowerCase()));
  const db = watchDb();
  endForgotten(db, Date.now());
  const party = newParty(newId(), { username, client }, {
    titleId: title.id, season: series ? Number(raw.season) || 1 : 0, episode: series ? Number(raw.episode) || 1 : 0,
    position: Number.isFinite(position) && position > 0 ? position : 0,
  }, invited, Date.now());
  saveParty(db, party);
  const room: Room = { party, listeners: new Set(), savedAt: Date.now(), reacted: new Map() };
  rooms.set(party.id, room);
  runClock();
  return { state: viewFor(party, username) };
}

/** The parties someone hosts, is in, or is asked to, with what's on; and the household to invite. */
export async function partiesOf(username: string, origin: string) {
  const now = Date.now(), db = watchDb();
  const u = username.toLowerCase();
  const everyone = await people();
  const nameOf = (x: string) => everyone.find((p) => p.username === x)?.name ?? x;
  const parties = partiesFor(db, u, now).map((stored) => {
    const p: Party = rooms.get(stored.id)?.party ?? stored;
    const title = getTitle(db, p.timeline.titleId);
    return {
      id: p.id, host: p.host, hostName: nameOf(p.host),
      invited: p.invited.includes(u) && !p.members.some((m) => m.username === u),
      title: title ? cardOf(title, origin) : null,
      season: p.timeline.season, episode: p.timeline.episode,
      label: p.timeline.season || p.timeline.episode ? labelsFor(u, p.timeline.titleId)?.(p.timeline.season, p.timeline.episode) ?? null : null,
      watching: [...new Set(p.members.filter((m) => now - m.seen < 15_000).map((m) => m.username))],
      seq: p.seq,
    };
  }).filter((p) => p.watching.length > 0 || p.host === u);
  return { parties, people: everyone };
}

/** The party now, and its chat: what a screen starts from. */
export function partyNow(id: string, username: string) {
  const room = must(id);
  const title = getTitle(watchDb(), room.party.timeline.titleId);
  return { state: viewFor(room.party, username), chat: room.party.chat, title: title ? { id: title.id, name: title.name } : null };
}

/**
 * Listens to a party: its state and chat now, then every change, reaction
 * and line of chat as it comes. The screen counts as here while it listens.
 */
export function listen(id: string, client: string, username: string, send: (event: LiveEvent) => void): (() => void) | null {
  const room = roomOf(id);
  if (!room) return null;
  const listener: Listener = { client, username, send };
  room.listeners.add(listener);
  send({ type: "state", state: viewFor(room.party, username) });
  send({ type: "chat", lines: room.party.chat });
  return () => { room.listeners.delete(listener); };
}

const states = new Set<MemberState>(["loading", "ready", "buffering"]);

/**
 * Something a screen does: `{ client, seq, type, … }`. Its state (`status`),
 * a command (play, pause, seek, rate, episode, next, cancel-countdown,
 * skip-wait, host-only), `leave`, `react`, `chat`, `invite`, `decline`.
 */
export async function act(cfg: WatchConfig, id: string, username: string, raw: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = Date.now();
  const room = must(id);
  const u = username.toLowerCase();
  const client = cleanClient(raw.client);
  const type = String(raw.type ?? "");
  const answer = (status = 200, extra: Record<string, unknown> = {}) => ({ status, body: { ok: status < 300, ...extra, state: viewFor(room.party, u) } });

  if (type === "decline") { commit(room, decline(room.party, u, now)); return answer(); }
  if (type === "invite") {
    const household = new Set((await people()).map((p) => p.username));
    const asked = (Array.isArray(raw.usernames) ? raw.usernames : []).filter((x): x is string => typeof x === "string" && household.has(x.toLowerCase()));
    commit(room, invite(room.party, asked, Date.now()));
    return answer();
  }
  if (!client) return { status: 400, body: { ok: false, error: "Say which screen this is." } };
  if (type === "status") {
    const state = raw.state as MemberState;
    if (!states.has(state)) return { status: 400, body: { ok: false, error: "That isn't a state." } };
    const reported = report(room.party, { client, username: u }, state, now);
    commit(room, tick(reported, now).party, now);
    return answer();
  }
  if (type === "leave") { commit(room, leave(room.party, client, now)); return answer(); }

  /* The rest are for the screens in the party. */
  if (!room.party.members.some((m) => m.client === client)) return { status: 409, body: { ok: false, reason: "not-joined", error: "Join the party first." } };
  if (type === "react") {
    const emoji = String(raw.emoji ?? "");
    if (!(reactions as readonly string[]).includes(emoji)) return { status: 400, body: { ok: false, error: "That isn't one of the reactions." } };
    /* A handful a second at most, so a held key doesn't flood everyone. */
    const recent = (room.reacted.get(client) ?? []).filter((t) => now - t < 1000);
    if (recent.length >= 4) return answer(429);
    room.reacted.set(client, [...recent, now]);
    tell(room, { type: "react", username: u, client, emoji, at: now });
    return { status: 200, body: { ok: true } };
  }
  if (type === "chat") {
    const added = addChat(room.party, u, String(raw.text ?? ""), randomBytes(6).toString("base64url"), now);
    if (!added) return { status: 400, body: { ok: false, error: "Say something first." } };
    commit(room, added.party, now);
    saveParty(watchDb(), room.party);
    tell(room, { type: "chat", lines: [added.line] });
    return { status: 200, body: { ok: true, line: added.line } };
  }

  const seq = Number(raw.seq);
  const seenSeq = Number.isSafeInteger(seq) ? seq : 0;
  if (type === "next") {
    /* The shared countdown to what comes next, worked out here from the host's settings. */
    const { titleId, season, episode } = room.party.timeline;
    const to = await nextUp(cfg, room.party.host, titleId, { season, episode }).catch(() => null);
    if (!to) return answer(200, { next: null });
    const out = command(room.party, { username: u, client }, { type: "countdown", to }, seenSeq, Date.now());
    if (out.ok) commit(room, out.party);
    const label = labelsFor(u, titleId)?.(to.season, to.episode);
    return out.ok ? answer(200, { next: label ? { ...to, label } : to }) : answer(out.reason === "host-only" ? 403 : 409, { reason: out.reason });
  }
  const cmd = parseCommand(raw);
  if (!cmd) return { status: 400, body: { ok: false, error: "That isn't something a party does." } };
  const out = command(room.party, { username: u, client }, cmd, seenSeq, now);
  if (!out.ok) return answer(out.reason === "host-only" ? 403 : out.reason === "stale" ? 409 : 400, { reason: out.reason });
  commit(room, tick(out.party, now).party, now);
  return answer();
}
