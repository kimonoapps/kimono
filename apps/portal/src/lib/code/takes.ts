import type { DatabaseSync } from "node:sqlite";
import { CodeProblem, newId } from "./model";
import { remember } from "./memory";

/*
 * Two takes on one answer (docs/kimono-ai.md, "Two takes"): now and then Kimono AI
 * answers twice, side by side, and the person keeps one. What they keep is how it
 * answers them from then on. Each pair tests one trade-off, its kind; a kind comes
 * back to a person every few days (again), picked or not, and only where the trade-off is real.
 */

export const takeKinds = ["depth", "voice", "length"] as const;
export type TakeKind = (typeof takeKinds)[number];

/** What each kind's two takes are kept as, first take then second. */
export const picks = {
  depth: ["quick", "considered"],
  voice: ["silent", "voiced"],
  length: ["short", "full"],
} as const satisfies Record<TakeKind, readonly [string, string]>;
export type Pick<K extends TakeKind = TakeKind> = (typeof picks)[K][number];

/** The memory a kept take becomes, which the person sees on their Memory page and the agent reads every turn. */
const memories: Record<TakeKind, readonly [string, string]> = {
  depth: ["Likes explanations that start straight away over ones that take longer to think through.", "Likes explanations thought through first, even when they take longer to start."],
  voice: ["Likes animations that explain something to be silent, without narration.", "Likes animations that explain something to be narrated aloud."],
  length: ["Likes explanations short: the heart of it in a few sentences.", "Likes fuller explanations, with the reasoning and an example."],
};

/** Words added to each take's message (never the system prompt, so the chat's cached prompt holds). */
const notes: Record<TakeKind, readonly [string, string]> = {
  depth: ["", ""],
  voice: ["(For this answer: if you make an animation, keep it silent, with no narration.)", "(For this answer: narrate the animation with one kimono-say call.)"],
  length: ["(For this answer: keep it short, the heart of it in a few sentences.)", "(For this answer: give a fuller explanation, with the reasoning and an example.)"],
};
/* The second take writes beside the first: its artifacts must never take the first one's files. */
const apart = "(If you make an artifact for this answer, end its name with -b, like heart-b.)";

/** A words-only question that a short and a full answer would both suit. */
const explainWords = /\b(explain|why (do|does|is|are|did)|what (is|are) (a|an|the)?\b|tell me about|difference between)\b/i;

type Asked = {
  /** What models.ts weighed the message as. */
  weight: "quick" | "show" | "work" | "opus" | "building";
  prompt: string;
  /** The model the person picked: two takes only on Auto. */
  choice?: unknown;
  attachments: number;
  byOwner: boolean;
  /** The app the person sent it from can show two takes side by side. */
  canShow: boolean;
  /** An edited message, or messages that waited while it worked: never. */
  rewound?: boolean;
  queued?: boolean;
  /** Kinds already tried with this person. */
  tried: ReadonlySet<TakeKind>;
};

/** Which trade-off to put to the person for this message, if any: rarely, and never on a quick one. */
export function takeKindFor(input: Asked): TakeKind | null {
  const auto = input.choice === undefined || input.choice === "auto";
  if (!auto || !input.byOwner || !input.canShow || input.rewound || input.queued || input.attachments > 0) return null;
  const prompt = input.prompt.trim();
  if (!prompt || prompt.startsWith("/")) return null;
  if (input.weight === "show") {
    if (!input.tried.has("depth")) return "depth";
    if (!input.tried.has("voice")) return "voice";
    return null;
  }
  if (input.weight === "work" && prompt.length <= 280 && explainWords.test(prompt) && !input.tried.has("length")) return "length";
  return null;
}

/** How each take of a kind runs: whether the second thinks (depth), and the words added to each take's message. */
export function takePlan(kind: TakeKind): { thinking?: [boolean, boolean]; notes: [string, string] } {
  const [a, b] = notes[kind];
  return { ...(kind === "depth" ? { thinking: [false, true] as [boolean, boolean] } : {}), notes: [a, [b, apart].filter(Boolean).join("\n")] };
}

/** A message with a take's words after it. */
export const withNote = (prompt: string, note: string) => note ? `${prompt}\n\n${note}` : prompt;

/* ── kept in code.db ── */

/** How long before a kind is tried with the same person again: more picks, to learn from, without asking often. */
export const again = 3 * 24 * 60 * 60 * 1000;

/** The kinds tried with a person lately, which wait before they come back. */
export function triedKinds(db: DatabaseSync, username: string, now = Date.now()): Set<TakeKind> {
  const rows = db.prepare("SELECT DISTINCT kind FROM ai_takes WHERE username = ? AND at > ?").all(username.toLowerCase(), now - again) as { kind: TakeKind }[];
  return new Set(rows.map((r) => r.kind));
}

/** What a person kept, by kind, while the memory that says so is still theirs. */
export function leaningsOf(db: DatabaseSync, username: string): Partial<{ [K in TakeKind]: Pick<K> }> {
  const rows = db.prepare("SELECT l.kind, l.pick FROM ai_leanings l JOIN memories m ON m.id = l.memory_id WHERE l.username = ?").all(username.toLowerCase()) as { kind: TakeKind; pick: string }[];
  return Object.fromEntries(rows.filter((r) => (picks[r.kind] as readonly string[] | undefined)?.includes(r.pick)).map((r) => [r.kind, r.pick]));
}

/** A pair begins: where the session was before the ask, for the second take to carry on from too. */
export function startTakes(db: DatabaseSync, input: { workspace: string; turn: string; username: string; kind: TakeKind; session: string | null; at: string | null }, now = Date.now()): string {
  const id = newId();
  db.prepare("INSERT INTO ai_takes (id, workspace_id, turn_id, username, kind, before_session, before_at, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, input.workspace, input.turn, input.username.toLowerCase(), input.kind, input.session, input.at, now);
  return id;
}

/** Where take [n] left the session. */
export function noteTake(db: DatabaseSync, id: string, n: 0 | 1, session: string | null, at: string | null) {
  db.prepare(n === 0 ? "UPDATE ai_takes SET a_session = ?, a_at = ? WHERE id = ?" : "UPDATE ai_takes SET b_session = ?, b_at = ? WHERE id = ?").run(session, at, id);
}

/** A pair that didn't come off (a take failed, was stopped, or was skipped): it doesn't count as tried. */
export function dropTakes(db: DatabaseSync, id: string) {
  db.prepare("DELETE FROM ai_takes WHERE id = ?").run(id);
}

export type TakeRow = { id: string; workspace: string; turn: string; username: string; kind: TakeKind; before: { session: string | null; at: string | null }; a: { session: string | null; at: string | null }; b: { session: string | null; at: string | null }; picked: 0 | 1 | null };

export function takeOf(db: DatabaseSync, id: string): TakeRow | null {
  const r = db.prepare("SELECT * FROM ai_takes WHERE id = ?").get(id) as Record<string, string | number | null> | undefined;
  if (!r) return null;
  return {
    id: String(r.id), workspace: String(r.workspace_id), turn: String(r.turn_id), username: String(r.username), kind: r.kind as TakeKind,
    before: { session: r.before_session as string | null, at: r.before_at as string | null },
    a: { session: r.a_session as string | null, at: r.a_at as string | null },
    b: { session: r.b_session as string | null, at: r.b_at as string | null },
    picked: r.picked === 0 || r.picked === 1 ? r.picked : null,
  };
}

/**
 * The person keeps take [n]: it becomes how it answers them (a memory they can see and forget), and the
 * chat carries on from it. Only the person it was put to, only once, only while it's the chat's latest answer.
 */
export function keepTake(db: DatabaseSync, input: { id: string; workspace: string; username: string; n: unknown; latestTurn: string | null; running: boolean }, now = Date.now()) {
  const take = takeOf(db, input.id);
  if (!take || take.workspace !== input.workspace) throw new CodeProblem("Those answers aren't here.", 404);
  if (take.username !== input.username.toLowerCase()) throw new CodeProblem("Only the person it asked can choose.", 403);
  if (input.n !== 0 && input.n !== 1) throw new CodeProblem("Choose the first or the second.");
  const n: 0 | 1 = input.n === 0 ? 0 : 1;
  if (take.picked !== null) throw new CodeProblem("You chose one already.", 409);
  if (input.running || input.latestTurn !== take.turn) throw new CodeProblem("The chat has moved on since.", 409);
  const kept = n === 0 ? take.a : take.b;
  if (!kept.at || !take.b.at) throw new CodeProblem("Those answers aren't both here.", 409);
  const pick = picks[take.kind][n];
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE ai_takes SET picked = ? WHERE id = ?").run(n, take.id);
    /* What it keeps replaces what it kept before for the kind (a person's own memories stay theirs). */
    const old = db.prepare("SELECT memory_id FROM ai_leanings WHERE username = ? AND kind = ?").get(take.username, take.kind) as { memory_id: string | null } | undefined;
    if (old?.memory_id) db.prepare("DELETE FROM memories WHERE id = ? AND username = ? AND source = 'ai'").run(old.memory_id, take.username);
    const memory = remember(db, take.username, memories[take.kind][n], "ai", now);
    const memoryId = memory?.id ?? (db.prepare("SELECT id FROM memories WHERE username = ? AND lower(text) = lower(?)").get(take.username, memories[take.kind][n]) as { id: string } | undefined)?.id ?? null;
    db.prepare("INSERT INTO ai_leanings (username, kind, pick, memory_id, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (username, kind) DO UPDATE SET pick = excluded.pick, memory_id = excluded.memory_id, at = excluded.at")
      .run(take.username, take.kind, pick, memoryId, now);
    /* The second take ran in a session of its own: keeping the first, the chat (and an edit after it) carries on in the first's. */
    if (n === 0) {
      db.prepare("UPDATE turns SET session = ?, resume_at = ? WHERE id = ?").run(kept.session, kept.at, take.turn);
      db.prepare("UPDATE workspaces SET session = ? WHERE id = ?").run(kept.session, take.workspace);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { n, pick, kind: take.kind, remembered: memories[take.kind][n] };
}

/** The last message of the turn before this one, where a second take carries the session on from. */
export function lastTurnEnd(db: DatabaseSync, workspace: string, turn: string): { session: string | null; at: string | null } | null {
  const row = db.prepare("SELECT session, resume_at FROM turns WHERE workspace_id = ? AND id != ? ORDER BY started_at DESC, rowid DESC LIMIT 1").get(workspace, turn) as { session: string | null; resume_at: string | null } | undefined;
  return row ? { session: row.session, at: row.resume_at } : null;
}
