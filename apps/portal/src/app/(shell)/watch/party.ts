/*
 * 共 Watch Together in the browser: the line to a party on the server
 * (lib/watch/together.ts has the rules, and the same maths runs here). It
 * reads the server's clock, listens for the party's state over SSE (and
 * reconnects by itself, taking the state again), and sends what this screen
 * does one at a time, each with the newest state it has seen.
 */
import { clockOffset, newer, positionAt, type ChatLine, type ClockSample, type MemberState, type PartyView } from "@/lib/watch/together";
export { correction, positionAt } from "@/lib/watch/together";
import type { Card } from "./api";

export type { ChatLine, PartyView };
export type Reaction = { id: number; username: string; client: string; emoji: string };
export type Invite = { id: string; host: string; hostName: string; invited: boolean; title: Card | null; season: number; episode: number; watching: string[]; seq: number };
export type Person = { username: string; name: string; picture: string | null };
export const reactionSet = ["❤️", "😂", "😮", "😢", "👏", "🔥"];

type Answer = { ok: boolean; state?: PartyView; reason?: string; error?: string; next?: unknown };
type Handlers = {
  state: (state: PartyView) => void;
  chat: (lines: ChatLine[]) => void;
  react: (reaction: Reaction) => void;
  ended: () => void;
  /** Whether the live channel is up, for a quiet "Reconnecting…". */
  online: (on: boolean) => void;
};

const api = (path: string) => `/api/v1/watch/together${path}`;
async function post<T = Answer>(path: string, body: unknown, keepalive = false): Promise<{ status: number; body: T }> {
  const response = await fetch(api(path), { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body), keepalive });
  return { status: response.status, body: await response.json().catch(() => ({})) as T };
}

export const together = {
  list: () => fetch(api(""), { credentials: "same-origin" }).then((r) => (r.ok ? r.json() as Promise<{ parties: Invite[]; people: Person[] }> : Promise.reject(new Error("Watch isn't answering.")))),
  create: (body: { titleId: string; season?: number; episode?: number; position?: number; client: string; invite: string[] }) =>
    post<{ state: PartyView; error?: string }>("", body).then((r) => (r.status < 300 ? r.body.state : Promise.reject(new Error(r.body.error || "That didn't work.")))),
  peek: (id: string) => fetch(api(`/${encodeURIComponent(id)}`), { credentials: "same-origin" }).then((r) => (r.ok ? r.json() as Promise<{ state: PartyView; chat: ChatLine[]; title: { id: string; name: string } | null }> : Promise.reject(new Error(r.status === 404 ? "This watch party has ended." : "Watch isn't answering.")))),
  decline: (id: string) => post(`/${encodeURIComponent(id)}`, { type: "decline" }).catch(() => null),
};

/** This tab, in a party: one per tab, so the same person on two screens counts twice. */
export function screenId() {
  try {
    const known = sessionStorage.getItem("kw.screen");
    if (known) return known;
    const made = `web-${crypto.randomUUID().slice(0, 18)}`;
    sessionStorage.setItem("kw.screen", made);
    return made;
  } catch { return `web-${Math.random().toString(36).slice(2, 14)}`; }
}

export class PartyLink {
  readonly client = screenId();
  state: PartyView | null = null;
  private offset = 0;
  private samples: ClockSample[] = [];
  private source: EventSource | null = null;
  private heardAt = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private status: MemberState = "loading";
  private closed = false;
  private reactionId = 0;

  constructor(readonly id: string, private on: Handlers) {
    void this.syncClock(6);
    void this.send({ type: "status", state: "loading" });
    this.connect();
    /* The clock now and then; how this screen is every few seconds, so it counts as here even if the live channel drops. */
    this.timers.push(setInterval(() => void this.syncClock(1), 20_000));
    this.timers.push(setInterval(() => void this.send({ type: "status", state: this.status }), 5000));
    /* Nothing heard for 25 s (pings come every 10): the channel is dead even if the browser hasn't noticed. */
    this.timers.push(setInterval(() => { if (!this.closed && Date.now() - this.heardAt > 25_000) this.connect(); }, 5000));
  }

  /** The server's clock, in ms. */
  now() { return Date.now() + this.offset; }
  /** Where the party is now, in seconds. */
  position() { return this.state ? positionAt(this.state.timeline, this.now()) : 0; }

  private async syncClock(times: number) {
    for (let i = 0; i < times && !this.closed; i++) {
      const sent = Date.now();
      try {
        const { now } = await fetch(api("/clock"), { cache: "no-store" }).then((r) => r.json() as Promise<{ now: number }>);
        this.samples = [...this.samples, { sent, received: Date.now(), server: now }].slice(-15);
        this.offset = clockOffset(this.samples)?.offset ?? this.offset;
      } catch { /* the next one will do */ }
      if (i < times - 1) await new Promise((done) => setTimeout(done, 120));
    }
  }

  private connect() {
    this.source?.close();
    if (this.closed) return;
    this.heardAt = Date.now();
    const source = new EventSource(api(`/${encodeURIComponent(this.id)}?client=${encodeURIComponent(this.client)}`));
    this.source = source;
    const heard = () => { this.heardAt = Date.now(); };
    source.addEventListener("open", () => { heard(); this.on.online(true); void this.send({ type: "status", state: this.status }); });
    source.addEventListener("state", (e) => { heard(); this.take(JSON.parse((e as MessageEvent).data) as PartyView); });
    source.addEventListener("chat", (e) => { heard(); this.on.chat((JSON.parse((e as MessageEvent).data) as { lines: ChatLine[] }).lines); });
    source.addEventListener("react", (e) => { heard(); const r = JSON.parse((e as MessageEvent).data) as Omit<Reaction, "id">; this.on.react({ ...r, id: ++this.reactionId }); });
    source.addEventListener("ping", heard);
    source.addEventListener("ended", () => { this.close(); this.on.ended(); });
    source.addEventListener("error", () => {
      this.on.online(false);
      /* The browser retries by itself unless the answer was a refusal; then this does, a little later. */
      if (source.readyState === EventSource.CLOSED) setTimeout(() => { if (this.source === source) this.connect(); }, 2000);
    });
  }

  /** The state from a first look, until the live channel speaks. */
  seed(state: PartyView) { this.take(state); }

  /** A state is taken only if it's newer than the one held. */
  private take(state: PartyView | undefined, force = false) {
    if (!state || (!force && this.state && !newer(this.state.seq, state.seq))) return;
    this.state = state;
    this.on.state(state);
  }

  /** One at a time, each with the newest state seen. Answers with what the server said. */
  send(body: Record<string, unknown>, keepalive = false): Promise<Answer | null> {
    const run = this.queue.then(async () => {
      if (this.closed && body.type !== "leave") return null;
      try {
        const answer = await post(`/${encodeURIComponent(this.id)}`, { ...body, client: this.client, seq: this.state?.seq ?? 0 }, keepalive);
        if (answer.status === 404) { this.close(); this.on.ended(); return null; }
        /* Refused: whatever this screen assumed meanwhile gives way to what the server holds. */
        if (answer.body.ok === false && answer.body.state) this.take(answer.body.state, true);
        else this.take(answer.body.state);
        return answer.body;
      } catch { return null; }
    });
    this.queue = run.catch(() => null);
    return run;
  }

  /** How this screen is; sent when it changes. */
  report(state: MemberState) {
    if (state === this.status) return;
    this.status = state;
    void this.send({ type: "status", state });
  }

  /**
   * A command. A seek that lost to someone else's comes back stale and the
   * screen follows what won; a pause or play is a wish and always lands.
   */
  command(type: "play" | "pause" | "seek" | "episode" | "next" | "cancel-countdown" | "skip-wait" | "rate" | "host-only", extra: Record<string, unknown> = {}) {
    return this.send({ type, ...extra });
  }

  /** What this screen just did, assumed until the server answers, so the picture doesn't flick back. */
  assume(change: Partial<PartyView["timeline"]>) {
    if (!this.state) return;
    this.state = { ...this.state, timeline: { ...this.state.timeline, ...change } };
    this.on.state(this.state);
  }

  react(emoji: string) { return this.send({ type: "react", emoji }); }
  chat(text: string) { return this.send({ type: "chat", text }); }
  invite(usernames: string[]) { return this.send({ type: "invite", usernames }); }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.source?.close();
    for (const t of this.timers) clearInterval(t);
  }

  /** Leaving on purpose: the others stop counting this screen at once. */
  leave() {
    void this.send({ type: "leave" }, true);
    this.close();
  }
}
