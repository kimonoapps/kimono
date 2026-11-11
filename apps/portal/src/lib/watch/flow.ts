/**
 * What each person is streaming right now, and whether the source keeps up.
 *
 * Every relayed stream (./index.ts relay) is counted under its person and
 * what it plays (a title, or one episode of it). Two at once per person: a
 * third play is turned away until one stops, so nobody's account carries the
 * household's bandwidth.
 *
 * The relay reads ahead of the player. When the player is waiting and the
 * relay is waiting on the source nearly all the time, the server side is slow;
 * when the relay has bytes ready and the player doesn't take them, the
 * person's own connection is. Players ask when they stall and say which.
 *
 * A stream counts while a player is heard from on it: a request for the file
 * or an HLS part, or a progress report. An open connection alone doesn't: the
 * packager, or a player that went away without hanging up, can hold one for
 * as long as it likes. A paused player goes quiet and gives its slot back,
 * and a player that's closed says so and gives it back at once.
 *
 * In memory: a restart forgets, which only frees the slots.
 */

export const streamsPerPerson = 2;
/** A stream no player has been heard from on for this long has stopped. Players report progress every 10 seconds while playing. */
const idleMs = 45_000;
/** How far back "is the source keeping up" looks. */
const windowMs = 15_000;
const bucketMs = 1000;

type Flow = {
  started: number;
  open: number;
  /* When a player last asked for this or reported on it. */
  heard: number;
  /* Ends each relay still open on it. */
  cuts: Set<() => void>;
  seen: number;
  /* Reads waiting on the source right now, and since when one has been. */
  waiting: number;
  since: number;
  /* Milliseconds spent waiting on the source, per second of the clock. */
  busy: Map<number, number>;
  /* Bytes handed to the player, per second of the clock. */
  sent: Map<number, number>;
};

/** How long a stream's address works (./token.ts): one made at t runs out at t + this. */
export const streamLifeMs = 6 * 60 * 60 * 1000;

/* When each person last ended their streams: addresses made before then no longer open. */
const ended = ((globalThis as unknown as { kimonoWatchEnded?: Map<string, number> }).kimonoWatchEnded ??= new Map());

const flows = ((globalThis as unknown as { kimonoWatchFlows?: Map<string, Map<string, Flow>> }).kimonoWatchFlows ??= new Map());

/** What a play is counted as: a film, or one episode. */
export const watchKey = (titleId: string, season: number, episode: number) => `${titleId}:${season}:${episode}`;

function flowOf(username: string, what: string, now: number): Flow {
  let mine = flows.get(username);
  if (!mine) flows.set(username, (mine = new Map()));
  let flow = mine.get(what);
  if (!flow) mine.set(what, (flow = { started: now, open: 0, heard: 0, cuts: new Set(), seen: now, waiting: 0, since: 0, busy: new Map(), sent: new Map() }));
  return flow;
}

/** Whether a player is on it: what counts against the two. */
const live = (flow: Flow, now: number) => now - flow.heard < idleMs;
/** Whether the relay is moving bytes for it, player or packager: what the slowness checks look at. */
const moving = (flow: Flow, now: number) => flow.open > 0 || flow.waiting > 0 || now - flow.seen < idleMs;

/** A player asked for part of `what`, or said where it is: it's still watching. Only a stream already counted is kept going. */
export function heard(username: string, what: string, now = Date.now()) {
  const flow = flows.get(username)?.get(what);
  if (flow) flow.heard = Math.max(flow.heard, now);
}

/** A player was closed on `what`: its slot frees now instead of after going quiet. Asking for it again counts it again. */
export function stopped(username: string, what: string) {
  const flow = flows.get(username)?.get(what);
  if (flow) flow.heard = 0;
}

/** A player's request for the file: counts the stream from now. */
export function asked(username: string, what: string, now = Date.now()) {
  flowOf(username, what, now).heard = now;
}

/** Ends everything this person is streaming, wherever it plays: the slots free at once. */
export function endStreams(username: string): number {
  const mine = flows.get(username) ?? new Map<string, Flow>();
  let count = 0;
  for (const flow of mine.values()) {
    if (live(flow, Date.now())) count++;
    for (const cut of [...flow.cuts]) cut();
  }
  flows.delete(username);
  ended.set(username, Date.now());
  return count;
}

/** Whether a stream address running out at `expiresAt` was made before its person ended their streams. */
export function endedBefore(username: string, expiresAt: number): boolean {
  const at = ended.get(username);
  return at !== undefined && expiresAt - streamLifeMs < at;
}

/** What this person is streaming now, besides `except`. */
export function streamsOf(username: string, except?: string, now = Date.now()): string[] {
  const mine = flows.get(username);
  if (!mine) return [];
  const out: string[] = [];
  for (const [what, flow] of mine) {
    if (live(flow, now)) { if (what !== except) out.push(what); }
    else if (!moving(flow, now) && now - flow.seen > 6 * 60 * 60 * 1000) mine.delete(what);
  }
  return out;
}

/** Whether starting `what` would be one stream too many for someone allowed `limit`. Something already playing always carries on. */
export function tooMany(username: string, what: string, now = Date.now(), limit = streamsPerPerson): boolean {
  const flow = flows.get(username)?.get(what);
  if (flow && live(flow, now)) return false;
  return streamsOf(username, what, now).length >= limit;
}

const counts = ["no", "one", "two", "three", "four", "five", "six"];
/** What a player says when it's turned away. Players spot it by its start: "You're already watching". */
export const tooManyNote = (limit = streamsPerPerson) => `You're already watching on ${counts[limit] ?? limit} screens. Stop one to watch here.`;

function add(map: Map<number, number>, from: number, to: number) {
  for (let t = from; t < to;) {
    const bucket = Math.floor(t / bucketMs);
    const end = Math.min(to, (bucket + 1) * bucketMs);
    map.set(bucket, (map.get(bucket) ?? 0) + end - t);
    t = end;
  }
  const oldest = Math.floor((to - windowMs * 2) / bucketMs);
  for (const key of map.keys()) if (key < oldest) map.delete(key);
}

/** The relay starts waiting on the source (opening it, or a read). Returns the call that marks the wait over. */
export function waitOn(username: string, what: string, clock: () => number = Date.now): () => void {
  const flow = flowOf(username, what, clock());
  if (flow.waiting++ === 0) flow.since = clock();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const now = clock();
    flow.seen = now;
    if (--flow.waiting === 0) add(flow.busy, flow.since, now);
  };
}

/**
 * The source's bytes, passed on to the player with a few megabytes read ahead,
 * counted while it's open and timed while it waits on the source.
 */
export function tracked(body: ReadableStream<Uint8Array>, username: string, what: string, clock: () => number = Date.now): ReadableStream<Uint8Array> {
  const flow = flowOf(username, what, clock());
  flow.open++;
  flow.seen = clock();
  let closed = false;
  const reader = body.getReader();
  let cut: (() => void) | null = null;
  const close = () => { if (closed) return; closed = true; flow.open--; flow.seen = clock(); if (cut) flow.cuts.delete(cut); };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      cut = () => { close(); try { controller.error(new Error("ended")); } catch { /* already over */ } reader.cancel().catch(() => {}); };
      flow.cuts.add(cut);
    },
    async pull(controller) {
      const over = waitOn(username, what, clock);
      try {
        const { value, done } = await reader.read();
        over();
        if (done) { close(); controller.close(); return; }
        const now = clock();
        flow.seen = now;
        flow.sent.set(Math.floor(now / bucketMs), (flow.sent.get(Math.floor(now / bucketMs)) ?? 0) + value.byteLength);
        controller.enqueue(value);
      } catch (error) {
        over(); close(); controller.error(error);
      }
    },
    cancel(reason) { close(); return reader.cancel(reason).catch(() => {}); },
  }, new ByteLengthQueuingStrategy({ highWaterMark: 4 * 1024 * 1024 }));
}

/** Who's to blame for a stall: "server" when the source can't keep up, "connection" when it can, null when nothing's been streaming. */
export function verdict(username: string, what: string, now = Date.now()): { slow: "server" | "connection" | null; busy: number; mbps: number } {
  const flow = flows.get(username)?.get(what);
  if (!flow || !moving(flow, now)) return { slow: null, busy: 0, mbps: 0 };
  /* A stream only seconds old is judged on those seconds. */
  const span = Math.max(2000, Math.min(windowMs, now - flow.started));
  const from = now - span;
  let busy = 0, bytes = 0;
  for (const [bucket, ms] of flow.busy) if (bucket * bucketMs >= from) busy += ms;
  for (const [bucket, n] of flow.sent) if (bucket * bucketMs >= from) bytes += n;
  /* A wait still going on counts too: a source that hasn't answered in seconds is the slow one. */
  if (flow.waiting > 0) busy += now - Math.max(flow.since, from);
  const share = Math.min(1, busy / span);
  const mbps = Math.round((bytes * 8) / (span / 1000) / 1e5) / 10;
  return { slow: share >= 0.7 ? "server" : "connection", busy: Math.round(share * 100) / 100, mbps };
}

/** How long a play counts as starting: its opening burst and the seeks that follow resuming. */
const startingMs = 90_000;

/**
 * Whether anyone's playback needs the source's full speed now: a play still
 * starting, or one whose source isn't keeping up. The server's own reads
 * (skip markers) wait while it does, so they never take Usenet or debrid
 * bandwidth from someone watching.
 */
export function playbackNeedsSource(now = Date.now()): boolean {
  for (const [username, mine] of flows) {
    for (const [what, flow] of mine) {
      if (!moving(flow, now)) continue;
      if (now - flow.started < startingMs) return true;
      if (verdict(username, what, now).slow === "server") return true;
    }
  }
  return false;
}

export const forgetFlows = () => { flows.clear(); ended.clear(); };
