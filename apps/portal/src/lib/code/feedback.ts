import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { artifactOf } from "./artifacts";
import type { Attachment, CodeEvent } from "./events";
import { forgetKept, keeper } from "./kept-files";
import { eventsAfter, thinkingUpTo, toolCallsOf, type StoredEvent } from "./model";

/*
 * What people think of Kimono AI's answers, kept as a bank to read back later
 * (an admin exports it, an AI looks for patterns). A thumbs up or down rates
 * one answer and keeps the chat up to it: every earlier turn, then the rated
 * one (its ask, what it thought, what it said, the tools it used and what they
 * gave back, and the model), as they were then, so the bank stands without the chat. A person's
 * name stays with their rating only so they can change it; the export leaves
 * names out. A report sends a whole chat with no name and no link to it.
 */

export type Rating = 1 | -1;

/** Which Kimono this is: the release tag the image was built from, or "dev". */
export const kimonoVersion = () => process.env.KIMONO_VERSION?.trim() || "dev";

const clip = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, max)}…`;

export type Step = { said?: string; thought?: string; tool?: string; detail?: string; ok?: boolean; output?: string; sent?: string[]; /** What was sent, kept beside the bank (kept-files.ts) to open again; kept since these began. */ files?: Attachment[]; artifact?: string; /** The artifact's page as it stood when kept (kept since these began; older entries have the name alone). */ page?: { title: string; content: string } };
export type Answer = { asked: string; attachments: string[]; /** What was attached, kept like a step's files. */ attached?: Attachment[]; steps: Step[]; ok: boolean; error?: string; model?: string; durationMs?: number };

/** The chat up to the answer that ended at [doneSeq]: that answer, and every turn before it. */
function answerAt(db: DatabaseSync, workspaceId: string, doneSeq: number): { answer: Answer; before: Answer[] } | null {
  const events = eventsAfter(db, workspaceId, 0, 100_000).filter((e) => e.seq <= doneSeq);
  const done = events.at(-1);
  if (!done || done.seq !== doneSeq || done.event.kind !== "done") return null;
  const turns = turnsOf(withThinking(db, workspaceId, events, doneSeq));
  const answer = turns.pop();
  return answer ? { answer, before: turns } : null;
}

/** A thought, between the events of a turn: what it was thinking before what came next. */
type Thought = { kind: "thought"; text: string };

/** The chat's events with what it thought placed among them, where it thought it. */
function withThinking(db: DatabaseSync, workspaceId: string, events: StoredEvent[], upTo: number): (CodeEvent | Thought)[] {
  const thoughts = thinkingUpTo(db, workspaceId, upTo);
  /* The timeline shortens a tool's command and output; the bank keeps them as they were, where it has them. */
  const calls = toolCallsOf(db, workspaceId);
  const full = (event: CodeEvent): CodeEvent => {
    const call = "id" in event && typeof event.id === "string" ? calls.get(event.id) : undefined;
    if (!call) return event;
    if (event.kind === "tool" && call.input) return { ...event, detail: call.input };
    if (event.kind === "tool-result" && call.output !== null) return { ...event, output: call.output };
    return event;
  };
  return events.flatMap((e) => [full(e.event), ...(thoughts.get(e.seq) ?? []).map((text): Thought => ({ kind: "thought", text }))]);
}

/** A run of events as turns, each from an ask to the next ask after a done. */
function turnsOf(events: (CodeEvent | Thought)[]): Answer[] {
  const turns: Answer[] = [];
  let current: (CodeEvent | Thought)[] = [];
  for (const event of events) {
    if (event.kind === "ask" && !event.queued && current.some((e) => e.kind === "done")) { turns.push(turnOf(current)); current = []; }
    current.push(event);
  }
  if (current.length) turns.push(turnOf(current));
  return turns;
}

function turnOf(events: (CodeEvent | Thought)[]): Answer {
  const answer: Answer = { asked: "", attachments: [], steps: [], ok: true };
  const tools = new Map<string, Step>();
  for (const event of events) {
    switch (event.kind) {
      case "ask": answer.asked = answer.asked ? `${answer.asked}\n\n${event.text}` : event.text; answer.attachments.push(...event.attachments.map((a) => a.name)); if (event.attachments.length) answer.attached = [...answer.attached ?? [], ...event.attachments]; break;
      case "text": answer.steps.push({ said: event.text }); break;
      case "thought": answer.steps.push({ thought: event.text }); break;
      case "tool": { const step: Step = { tool: event.name, detail: event.detail ?? event.label }; tools.set(event.id, step); answer.steps.push(step); break; }
      case "tool-result": { const step = tools.get(event.id); if (step) { step.ok = event.ok; if (event.output?.trim()) step.output = event.output; } break; }
      case "artifact": answer.steps.push({ artifact: event.name }); break;
      case "sent": answer.steps.push({ sent: event.files.map((f) => f.name), files: event.files }); break;
      case "done": answer.ok = event.ok; if (event.error) answer.error = event.error; if (event.model) answer.model = event.model; if (event.durationMs) answer.durationMs = event.durationMs; break;
    }
  }
  return answer;
}

type StoredAnswer = Answer & { before?: Answer[]; /** Its files are kept (kept-files.ts): set on every rating since that began, and on older ones once tried. */ filesKept?: boolean };

/** Keeps the files [answers] name beside the bank, pointing each at its kept copy; one the chat no longer has is left as a name alone. */
function keepFiles(workspaceId: string, answers: Answer[]): Answer[] {
  const keep = keeper(workspaceId);
  const kept = (files: Attachment[] | undefined) => { const found = (files ?? []).flatMap((f) => keep(f) ?? []); return found.length ? found : undefined; };
  for (const answer of answers) {
    answer.attached = kept(answer.attached);
    for (const step of answer.steps) if (step.files) step.files = kept(step.files);
  }
  return answers;
}

/** Every file [answers] keep. */
const keptOf = (answers: Answer[]) => answers.flatMap((a) => [...a.attached ?? [], ...a.steps.flatMap((s) => s.files ?? [])]);

/** The answers a stored rating holds, if there is one. */
function storedRating(db: DatabaseSync, workspaceId: string, seq: number, username: string): Answer[] {
  const row = db.prepare("SELECT answer FROM ai_ratings WHERE workspace_id = ? AND seq = ? AND username = ?").get(workspaceId, seq, username) as { answer: string } | undefined;
  if (!row) return [];
  const { before = [], ...answer } = JSON.parse(row.answer) as StoredAnswer;
  return [...before, answer];
}

/** Each artifact in [answers] with its page as it is now, so the bank opens it without the chat. */
function withPages(db: DatabaseSync, workspaceId: string, answers: Answer[]): Answer[] {
  const pages = new Map<string, Step["page"] | null>();
  for (const answer of answers) for (const step of answer.steps) {
    if (!step.artifact) continue;
    if (!pages.has(step.artifact)) { const found = artifactOf(db, workspaceId, step.artifact); pages.set(step.artifact, found ? { title: found.title, content: clip(found.content, 1_000_000) } : null); }
    const page = pages.get(step.artifact);
    if (page) step.page = page;
  }
  return answers;
}

/** Which Kimono and which sandbox a thumb or report was given on. The sandbox is the node's version and the image it makes sandboxes from, when it answered. */
export type Versions = { kimono: string; sandbox: string | null };

/** Rates the answer that ended at [seq], or takes the rating back (rating null). */
export function rate(db: DatabaseSync, workspaceId: string, seq: number, username: string, rating: Rating | null, note = "", now = Date.now(), versions: Versions = { kimono: kimonoVersion(), sandbox: null }) {
  const was = keptOf(storedRating(db, workspaceId, seq, username));
  if (rating === null) {
    forgetKept(was);
    db.prepare("DELETE FROM ai_ratings WHERE workspace_id = ? AND seq = ? AND username = ?").run(workspaceId, seq, username);
    return;
  }
  const rated = answerAt(db, workspaceId, seq);
  if (!rated) throw new Error("no answer there");
  /* The rated answer with the chat before it alongside; ratings kept before this hold the answer alone. */
  keepFiles(workspaceId, withPages(db, workspaceId, [...rated.before, rated.answer]));
  const kept: StoredAnswer = { ...rated.answer, before: rated.before, filesKept: true };
  db.prepare(`INSERT INTO ai_ratings (workspace_id, seq, username, rating, note, answer, at, version, sandbox_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (workspace_id, seq, username) DO UPDATE SET rating = excluded.rating, note = excluded.note, answer = excluded.answer, at = excluded.at, version = excluded.version, sandbox_version = excluded.sandbox_version`)
    .run(workspaceId, seq, username, rating, clip(note.trim(), 2000), JSON.stringify(kept), now, versions.kimono, versions.sandbox);
  forgetKept(was);
}

/**
 * Ratings kept before a thumb carried the chat up to its answer get the turns
 * before it, read from the chat as it is now. The rated answer stays as it
 * was kept. A rating whose answer the chat no longer has (a message before it
 * was changed) is marked with no earlier turns, so it isn't tried again.
 * Returns how many ratings it filled in.
 */
export function backfillRatings(db: DatabaseSync): number {
  const rows = db.prepare("SELECT workspace_id, seq, username, answer FROM ai_ratings WHERE json_extract(answer, '$.before') IS NULL")
    .all() as { workspace_id: string; seq: number; username: string; answer: string }[];
  if (!rows.length) return 0;
  const save = db.prepare("UPDATE ai_ratings SET answer = ? WHERE workspace_id = ? AND seq = ? AND username = ?");
  let filled = 0;
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const before = answerAt(db, row.workspace_id, row.seq)?.before ?? [];
      if (before.length) filled++;
      const kept: StoredAnswer = { ...(JSON.parse(row.answer) as Answer), before };
      save.run(JSON.stringify(kept), row.workspace_id, row.seq, row.username);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return filled;
}

/**
 * Ratings kept before their files were get them now, from the chat as it is,
 * where it still has the turn and the file: what was attached to a turn whose
 * ask reads the same, and what was sent, in order, by the same names. Each is
 * tried once. Reports can't be: nothing leads back to their chat.
 */
export function backfillRatingFiles(db: DatabaseSync): number {
  const rows = db.prepare("SELECT workspace_id, seq, username, answer FROM ai_ratings WHERE json_extract(answer, '$.filesKept') IS NULL")
    .all() as { workspace_id: string; seq: number; username: string; answer: string }[];
  const save = db.prepare("UPDATE ai_ratings SET answer = ? WHERE workspace_id = ? AND seq = ? AND username = ?");
  let filled = 0;
  for (const row of rows) {
    const { before = [], ...answer } = JSON.parse(row.answer) as StoredAnswer;
    const stored = [...before, answer];
    const now = answerAt(db, row.workspace_id, row.seq);
    if (now && keptOf([...now.before, now.answer]).length) {
      const turns = keepFiles(row.workspace_id, [...now.before, now.answer]);
      stored.forEach((was, i) => {
        const turn = turns[i];
        if (!turn || turn.asked !== was.asked) return;
        if (turn.attached) was.attached = turn.attached;
        const sent = turn.steps.filter((step) => step.files);
        let next = 0;
        for (const step of was.steps) {
          if (!step.sent) continue;
          const found = sent.slice(next).findIndex((s) => s.sent?.join("\n") === step.sent!.join("\n"));
          if (found < 0) continue;
          step.files = sent[next + found].files;
          next += found + 1;
        }
      });
      if (keptOf(stored).length) filled++;
      else forgetKept(keptOf(turns));
    }
    const kept: StoredAnswer = { ...stored.at(-1)!, before: stored.slice(0, -1), filesKept: true };
    save.run(JSON.stringify(kept), row.workspace_id, row.seq, row.username);
  }
  return filled;
}

/** [username]'s ratings in a chat, by the seq of the answer each rates. */
export function ratingsOf(db: DatabaseSync, workspaceId: string, username: string): Record<number, Rating> {
  const rows = db.prepare("SELECT seq, rating FROM ai_ratings WHERE workspace_id = ? AND username = ?").all(workspaceId, username) as { seq: number; rating: Rating }[];
  return Object.fromEntries(rows.map((r) => [r.seq, r.rating]));
}

/** An administrator's reply to a thumb, as the person sees it: a thank-you, and their note if they wrote one. */
export type Reply = { note: string; at: number };

/** [username]'s replied-to ratings in a chat, by the seq of the answer each rates. */
export function repliesOf(db: DatabaseSync, workspaceId: string, username: string): Record<number, Reply> {
  const rows = db.prepare("SELECT seq, reply_note, reply_at FROM ai_ratings WHERE workspace_id = ? AND username = ? AND reply_at IS NOT NULL").all(workspaceId, username) as { seq: number; reply_note: string | null; reply_at: number }[];
  return Object.fromEntries(rows.map((r) => [r.seq, { note: r.reply_note ?? "", at: r.reply_at }]));
}

/** Replies to the thumb [ref] names ("r<n>"), or changes the reply. Reports have no one to reply to. */
export function replyTo(db: DatabaseSync, ref: string, by: string, note: string, now = Date.now()): Reply | null {
  if (!/^r\d+$/.test(ref)) return null;
  const kept = clip(note.trim(), 2000);
  const changed = db.prepare("UPDATE ai_ratings SET reply_at = ?, reply_note = ?, reply_by = ? WHERE rowid = ?").run(now, kept, by, Number(ref.slice(1)));
  return changed.changes ? { note: kept, at: now } : null;
}

/** Sends a whole chat to the bank with no name and nothing that leads back to it. */
export function report(db: DatabaseSync, workspaceId: string, reason: string, now = Date.now(), versions: Versions = { kimono: kimonoVersion(), sandbox: null }) {
  const events = eventsAfter(db, workspaceId, 0, 100_000);
  const turns = keepFiles(workspaceId, withPages(db, workspaceId, turnsOf(withThinking(db, workspaceId, events, events.at(-1)?.seq ?? 0))));
  db.prepare("INSERT INTO ai_reports (id, reason, chat, at, version, sandbox_version) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), clip(reason.trim(), 4000), JSON.stringify(turns), now, versions.kimono, versions.sandbox);
}

export type BankEntry =
  | { type: "rating"; at: number; version: string | null; sandboxVersion: string | null; rating: Rating; note: string; answer: Answer; before: Answer[]; /** Admin's page only: where to open it, and the reply given. */ ref?: string; reply?: Reply }
  | { type: "report"; at: number; version: string | null; sandboxVersion: string | null; reason: string; chat: Answer[]; ref?: string };

type RatingRow = { ref: number; workspace_id: string; seq: number; rating: Rating; note: string; answer: string; at: number; version: string | null; sandbox_version: string | null; reply_at: number | null; reply_note: string | null };
type ReportRow = { id: string; reason: string; chat: string; at: number; version: string | null; sandbox_version: string | null };
const ratingCols = "rowid AS ref, workspace_id, seq, rating, note, answer, at, version, sandbox_version, reply_at, reply_note";
const reportCols = "id, reason, chat, at, version, sandbox_version";

function ratingEntry(r: RatingRow, refs: boolean): BankEntry {
  const { before = [], ...answer } = JSON.parse(r.answer) as StoredAnswer;
  return { type: "rating", at: r.at, version: r.version, sandboxVersion: r.sandbox_version, rating: r.rating, note: r.note, answer, before, ...(refs ? { ref: `r${r.ref}`, ...(r.reply_at ? { reply: { note: r.reply_note ?? "", at: r.reply_at } } : {}) } : {}) };
}
function reportEntry(r: ReportRow, refs: boolean): BankEntry {
  return { type: "report", at: r.at, version: r.version, sandboxVersion: r.sandbox_version, reason: r.reason, chat: JSON.parse(r.chat) as Answer[], ...(refs ? { ref: `p${r.id}` } : {}) };
}

/** Everything in the bank since [since], oldest first, without anyone's name. [refs] gives each the ref Admin opens it by; the export leaves them out. */
export function bank(db: DatabaseSync, since = 0, refs = false): BankEntry[] {
  const ratings = (db.prepare(`SELECT ${ratingCols} FROM ai_ratings WHERE at >= ?`).all(since) as RatingRow[]).map((r) => ratingEntry(r, refs));
  const reports = (db.prepare(`SELECT ${reportCols} FROM ai_reports WHERE at >= ?`).all(since) as ReportRow[]).map((r) => reportEntry(r, refs));
  return [...ratings, ...reports].sort((a, b) => a.at - b.at);
}

/** One entry by its ref, as it was kept. */
export function bankEntry(db: DatabaseSync, ref: string): BankEntry | null {
  if (/^r\d+$/.test(ref)) {
    const row = db.prepare(`SELECT ${ratingCols} FROM ai_ratings WHERE rowid = ?`).get(Number(ref.slice(1))) as RatingRow | undefined;
    return row ? ratingEntry(row, true) : null;
  }
  if (/^p[\w-]+$/.test(ref)) {
    const row = db.prepare(`SELECT ${reportCols} FROM ai_reports WHERE id = ?`).get(ref.slice(1)) as ReportRow | undefined;
    return row ? reportEntry(row, true) : null;
  }
  return null;
}
