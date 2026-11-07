import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CodeEvent } from "./events";
import { eventsAfter } from "./model";

/*
 * What people think of Kimono AI's answers, kept as a bank to read back later
 * (an admin exports it, an AI looks for patterns). A thumbs up or down rates
 * one answer: the turn's ask, what it said, the tools it used and the model,
 * kept as they were then, so the bank stands without the chat. A person's
 * name stays with their rating only so they can change it; the export leaves
 * names out. A report sends a whole chat with no name and no link to it.
 */

export type Rating = 1 | -1;

const clip = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, max)}…`;

export type Step = { said?: string; tool?: string; detail?: string; ok?: boolean; sent?: string[]; artifact?: string };
export type Answer = { asked: string; attachments: string[]; steps: Step[]; ok: boolean; error?: string; model?: string; durationMs?: number };

/** One turn as the bank keeps it: from the ask before [doneSeq] to that done. */
function answerAt(db: DatabaseSync, workspaceId: string, doneSeq: number): Answer | null {
  const events = eventsAfter(db, workspaceId, 0, 100_000).filter((e) => e.seq <= doneSeq);
  const done = events.at(-1);
  if (!done || done.seq !== doneSeq || done.event.kind !== "done") return null;
  const start = events.findLastIndex((e) => e.event.kind === "ask" && !e.event.queued);
  return turnOf(events.slice(Math.max(start, 0)).map((e) => e.event));
}

function turnOf(events: CodeEvent[]): Answer {
  const answer: Answer = { asked: "", attachments: [], steps: [], ok: true };
  const tools = new Map<string, Step>();
  for (const event of events) {
    switch (event.kind) {
      case "ask": answer.asked = answer.asked ? `${answer.asked}\n\n${event.text}` : event.text; answer.attachments.push(...event.attachments.map((a) => a.name)); break;
      case "text": answer.steps.push({ said: clip(event.text, 8000) }); break;
      case "tool": { const step: Step = { tool: event.name, detail: clip(event.detail ?? event.label, 600) }; tools.set(event.id, step); answer.steps.push(step); break; }
      case "tool-result": { const step = tools.get(event.id); if (step) step.ok = event.ok; break; }
      case "artifact": answer.steps.push({ artifact: event.name }); break;
      case "sent": answer.steps.push({ sent: event.files.map((f) => f.name) }); break;
      case "done": answer.ok = event.ok; if (event.error) answer.error = event.error; if (event.model) answer.model = event.model; if (event.durationMs) answer.durationMs = event.durationMs; break;
    }
  }
  return answer;
}

/** Rates the answer that ended at [seq], or takes the rating back (rating null). */
export function rate(db: DatabaseSync, workspaceId: string, seq: number, username: string, rating: Rating | null, note = "", now = Date.now()) {
  if (rating === null) {
    db.prepare("DELETE FROM ai_ratings WHERE workspace_id = ? AND seq = ? AND username = ?").run(workspaceId, seq, username);
    return;
  }
  const answer = answerAt(db, workspaceId, seq);
  if (!answer) throw new Error("no answer there");
  db.prepare(`INSERT INTO ai_ratings (workspace_id, seq, username, rating, note, answer, at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (workspace_id, seq, username) DO UPDATE SET rating = excluded.rating, note = excluded.note, at = excluded.at`)
    .run(workspaceId, seq, username, rating, clip(note.trim(), 2000), JSON.stringify(answer), now);
}

/** [username]'s ratings in a chat, by the seq of the answer each rates. */
export function ratingsOf(db: DatabaseSync, workspaceId: string, username: string): Record<number, Rating> {
  const rows = db.prepare("SELECT seq, rating FROM ai_ratings WHERE workspace_id = ? AND username = ?").all(workspaceId, username) as { seq: number; rating: Rating }[];
  return Object.fromEntries(rows.map((r) => [r.seq, r.rating]));
}

/** Sends a whole chat to the bank with no name and nothing that leads back to it. */
export function report(db: DatabaseSync, workspaceId: string, reason: string, now = Date.now()) {
  const events = eventsAfter(db, workspaceId, 0, 100_000).map((e) => e.event);
  const turns: Answer[] = [];
  let current: CodeEvent[] = [];
  for (const event of events) {
    if (event.kind === "ask" && !event.queued && current.some((e) => e.kind === "done")) { turns.push(turnOf(current)); current = []; }
    current.push(event);
  }
  if (current.length) turns.push(turnOf(current));
  db.prepare("INSERT INTO ai_reports (id, reason, chat, at) VALUES (?, ?, ?, ?)").run(randomUUID(), clip(reason.trim(), 4000), JSON.stringify(turns), now);
}

export type BankEntry =
  | { type: "rating"; at: number; rating: Rating; note: string; answer: Answer }
  | { type: "report"; at: number; reason: string; chat: Answer[] };

/** Everything in the bank since [since], oldest first, without anyone's name. */
export function bank(db: DatabaseSync, since = 0): BankEntry[] {
  const ratings = (db.prepare("SELECT rating, note, answer, at FROM ai_ratings WHERE at >= ?").all(since) as { rating: Rating; note: string; answer: string; at: number }[])
    .map((r): BankEntry => ({ type: "rating", at: r.at, rating: r.rating, note: r.note, answer: JSON.parse(r.answer) as Answer }));
  const reports = (db.prepare("SELECT reason, chat, at FROM ai_reports WHERE at >= ?").all(since) as { reason: string; chat: string; at: number }[])
    .map((r): BankEntry => ({ type: "report", at: r.at, reason: r.reason, chat: JSON.parse(r.chat) as Answer[] }));
  return [...ratings, ...reports].sort((a, b) => a.at - b.at);
}
