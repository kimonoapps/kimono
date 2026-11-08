import type { DatabaseSync } from "node:sqlite";
import { CodeProblem, newId } from "./model";

/*
 * What Kimono AI keeps about each person (docs/kimono-ai.md, "Memory and
 * instructions"): their own instructions, and memories: short facts it keeps
 * across chats, which they add themselves or it adds with kimono-remember.
 * Both go to the node with every turn and join the system prompt.
 */

/** title: a page's own name; a memory the agent kept has none. */
export type Memory = { id: string; title?: string; text: string; source: "person" | "ai"; createdAt: number };
export type Profile = { instructions: string; memories: Memory[] };

export const maxInstructions = 20_000;
/* A person's own memory can be a page of its own; one the agent keeps is a sentence. */
export const maxMemory = 8000;
export const maxAiMemory = 500;
/* What goes to the agent each turn, all together, at most: the newest memories first when it's full. */
const maxContext = 40_000;

/* A page's words as written: line breaks kept, runs of blank lines made one, nothing trailing. */
const pageText = (raw: unknown) => String(raw ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const lineText = (raw: unknown) => String(raw ?? "").replace(/\s+/g, " ").trim();
const maxTitle = 120;
const titleOf = (raw: unknown) => { const title = lineText(raw); if (title.length > maxTitle) throw new CodeProblem(`Keep a title to ${maxTitle} characters.`); return title || null; };
export const maxMemories = 200;

export function profileOf(db: DatabaseSync, username: string): Profile {
  const row = db.prepare("SELECT instructions FROM profiles WHERE username = ?").get(username) as { instructions?: string } | undefined;
  const memories = (db.prepare("SELECT id, title, text, source, created_at FROM memories WHERE username = ? ORDER BY created_at DESC").all(username) as { id: string; title: string | null; text: string; source: "person" | "ai"; created_at: number }[])
    .map((m) => ({ id: m.id, ...(m.title ? { title: m.title } : {}), text: m.text, source: m.source, createdAt: m.created_at }));
  return { instructions: row?.instructions ?? "", memories };
}

export function setInstructions(db: DatabaseSync, username: string, raw: unknown, now = Date.now()) {
  const instructions = pageText(raw);
  if (instructions.length > maxInstructions) throw new CodeProblem(`Keep instructions to ${maxInstructions} characters.`);
  db.prepare(`INSERT INTO profiles (username, instructions, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (username) DO UPDATE SET instructions = excluded.instructions, updated_at = excluded.updated_at`).run(username, instructions, now);
}

/** Keeps one memory. The same thing twice is kept once; past the limit, the oldest of its own go first. */
export function remember(db: DatabaseSync, username: string, raw: unknown, source: "person" | "ai", now = Date.now(), rawTitle?: unknown): Memory | null {
  const title = source === "person" ? titleOf(rawTitle) : null;
  const text = source === "ai" ? lineText(raw) : pageText(raw);
  if (!text) throw new CodeProblem("Say what to remember.");
  const most = source === "ai" ? maxAiMemory : maxMemory;
  if (text.length > most) throw new CodeProblem(`Keep a memory to ${most} characters.`);
  const same = db.prepare("SELECT id FROM memories WHERE username = ? AND lower(text) = lower(?)").get(username, text) as { id: string } | undefined;
  if (same) return null;
  const memory: Memory = { id: newId(), ...(title ? { title } : {}), text, source, createdAt: now };
  db.prepare("INSERT INTO memories (id, username, title, text, source, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(memory.id, username, title, text, source, now);
  const extra = (db.prepare("SELECT count(*) AS n FROM memories WHERE username = ?").get(username) as { n: number }).n - maxMemories;
  if (extra > 0) db.prepare("DELETE FROM memories WHERE id IN (SELECT id FROM memories WHERE username = ? ORDER BY created_at ASC LIMIT ?)").run(username, extra);
  return memory;
}

/** New words for one of the person's own memories. */
export function changeMemory(db: DatabaseSync, username: string, id: string, raw: unknown, rawTitle?: unknown): Memory {
  const text = pageText(raw);
  if (!text) throw new CodeProblem("Say what to remember.");
  if (text.length > maxMemory) throw new CodeProblem(`Keep a memory to ${maxMemory} characters.`);
  /* The agent changes words only; a title is the person's, and stays unless they send one. */
  const changed = rawTitle === undefined
    ? db.prepare("UPDATE memories SET text = ? WHERE id = ? AND username = ?").run(text, id, username).changes
    : db.prepare("UPDATE memories SET text = ?, title = ? WHERE id = ? AND username = ?").run(text, titleOf(rawTitle), id, username).changes;
  if (!changed) throw new CodeProblem("That memory isn't here.", 404);
  return profileOf(db, username).memories.find((m) => m.id === id)!;
}

export function forget(db: DatabaseSync, username: string, id: string) {
  if (!db.prepare("DELETE FROM memories WHERE id = ? AND username = ?").run(id, username).changes) throw new CodeProblem("That memory isn't here.", 404);
}

/** What joins the system prompt for this person's turns. Empty parts are left out; the helper is always explained. */
export function contextFor(db: DatabaseSync, username: string): string {
  const { instructions, memories } = profileOf(db, username);
  const parts: string[] = [];
  if (instructions) parts.push(`The person's own instructions for you (follow them unless they ask otherwise in the chat):\n${instructions}`);
  if (memories.length) {
    /* Newest first until the room is used, then shown oldest first; a page's lines stay under its bullet. */
    let room = maxContext - instructions.length;
    const kept: Memory[] = [];
    for (const m of memories) { if (m.text.length + 20 > room) break; room -= m.text.length + 20; kept.push(m); }
    if (kept.length) parts.push(`What you remember about them from earlier chats (each with its ID):\n${kept.reverse().map((m) => `- [${m.id}] ${m.title ? `${m.title}: ` : ""}${m.text.replace(/\n/g, "\n  ")}`).join("\n")}`);
  }
  parts.push("To remember something for every future chat (a preference, a fact about them or their household, or something they ask you to keep), run `kimono-remember \"<one sentence>\"`. When one is out of date or they ask, change it with `kimono-remember --change <ID> \"<new sentence>\"` or drop it with `kimono-remember --forget <ID>`. The moment they say how they want to be helped or taught (hints rather than answers, keep it short, simple English, quiz me one question at a time, don't write it for me), keep it in that same turn, before you reply: don't wait to be told twice, and don't keep it only for this chat. Only what will matter later, never secrets such as passwords; they can see, edit and delete what you keep.");
  return parts.join("\n\n");
}
