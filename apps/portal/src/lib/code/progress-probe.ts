import { progressCardOf, type CodeEvent } from "./events";

type ProgressEvent = Extract<CodeEvent, { kind: "progress" }>;

/** Where kimono-progress keeps the card's state, from the workspace's root (infra/sandbox/bin/kimono-progress). */
export const progressFile = ".kimono/progress.json";

/**
 * Follows a long job's card by reading its state from the sandbox every couple of seconds, so the card moves
 * with the job itself, not with the agent's checks or the clock. One card at a time: a new start takes over.
 *
 * The card in the file is matched to the start Kimono saw by its words, and a job already followed is never
 * taken again (`claimed` lives as long as the workspace), so a card left from earlier isn't mistaken for it.
 * A job the sandbox watches by itself (--run, --probe) is followed after the turn ends too, until it's over.
 */
export class ProgressProbe {
  private card?: { id: string; label: string; job?: string; watched?: boolean; last?: ProgressEvent; began: number; misses: number };
  private timer?: ReturnType<typeof setTimeout>;
  private turnOver = false;

  constructor(
    private read: () => Promise<string | undefined>,
    private record: (event: ProgressEvent) => void,
    private claimed: Set<string>,
    private options: { every?: number; findFor?: number; longest?: number; now?: () => number } = {},
  ) {}

  private get every() { return this.options.every ?? 2000; }
  private now() { return (this.options.now ?? Date.now)(); }

  /** A kimono-progress start was seen, as tool call `id`: follow its card. */
  start(id: string, label: string) {
    this.stop();
    this.card = { id, label, began: this.now(), misses: 0 };
    this.schedule(0);
  }

  /** The turn ended: one last look, and only a job the sandbox watches is followed on. */
  async turnEnded() {
    this.turnOver = true;
    if (!this.card) return;
    clearTimeout(this.timer);
    await this.tick(false);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.card = undefined;
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(true), ms);
  }

  /** One look at the card. Returns once it has recorded what changed. */
  async tick(again = false): Promise<void> {
    const card = this.card;
    if (!card) return;
    let text: string | undefined;
    try { text = await this.read(); } catch { text = undefined; }
    if (this.card !== card) return;
    const found = text === undefined ? undefined : progressCardOf(text);
    if (!found) card.misses++;
    else if (!card.job) {
      /* Its own card: the words it started with, and no job taken before. */
      if (found.label === card.label.slice(0, 80) && !this.claimed.has(found.job)) {
        card.job = found.job;
        this.claimed.add(found.job);
        if (this.claimed.size > 200) this.claimed.delete(this.claimed.values().next().value!);
      }
    } else if (found.job !== card.job) {
      /* Another start took the card over; that one is followed when Kimono sees it. */
      return this.stop();
    }
    if (card.job && found?.job === card.job) {
      card.misses = 0;
      card.watched = found.watched;
      const event: ProgressEvent = {
        kind: "progress", id: card.id, state: found.state,
        ...(found.status ? { status: found.status } : {}),
        ...(found.percent !== undefined ? { percent: Math.round(found.percent * 10) / 10 } : {}),
        ...(found.left !== undefined ? { left: Math.round(found.left) } : {}),
        ...(found.watched ? { watched: true } : {}),
      };
      if (changed(card.last, event)) { card.last = event; this.record(event); }
      if (found.state !== "running") return this.stop();
    }
    const longest = this.options.longest ?? 3 * 3600_000;
    const findFor = this.options.findFor ?? 60_000;
    const lost = !card.job && this.now() - card.began > findFor;
    const over = this.turnOver && !card.watched;
    if (lost || over || card.misses >= 15 || this.now() - card.began > longest) return this.stop();
    if (again || this.turnOver) this.schedule(this.every);
  }
}

/** Worth telling: a new state or words, a percent that moved a point, time left that moved five seconds. */
function changed(last: ProgressEvent | undefined, next: ProgressEvent): boolean {
  if (!last) return true;
  if (last.state !== next.state || last.status !== next.status || last.watched !== next.watched) return true;
  if ((last.percent === undefined) !== (next.percent === undefined)) return true;
  if (last.percent !== undefined && next.percent !== undefined && (Math.abs(last.percent - next.percent) >= 1 || (next.percent === 100 && last.percent !== 100))) return true;
  if ((last.left === undefined) !== (next.left === undefined)) return true;
  return last.left !== undefined && next.left !== undefined && Math.abs(last.left - next.left) >= 5;
}
