/*
 * The LLM pass: Claude reads the base conversion a part at a time and sends
 * back edits to its structure, never its text. It sees numbered blocks and
 * may mark headings, join a paragraph split at a page break, split one run
 * together, delete running heads and page numbers left in, move a block that
 * is out of reading order, turn a stray paragraph into a footnote or a
 * figure's caption, and join a word broken across lines. applyEdits
 * (blocks.ts) applies them and refuses anything that would change a word:
 * Claude can't rewrite, summarise or "correct" the book because it never
 * writes the book's text at all, which also keeps the answer short and cheap.
 * A last check counts the words before and after each part.
 *
 * It uses Kimono AI's own Claude token (lib/code/config.ts's model_token, an
 * API key or a `claude setup-token` token), so there's no second secret; with
 * none set, conversions are the base conversion alone.
 */
import Anthropic from "@anthropic-ai/sdk";
import { applyEdits, blockText, blockWords, EDITS_SCHEMA, letterFaithful, overlap, serialise, words, type Block } from "./blocks";

export const MODEL = "claude-opus-5-5";
/** Opus 5.5's prices, dollars per million tokens: input, output, cache write, cache read. */
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.4 };

/** Words per request. The answer is a short list of edits, so a part can be large. */
const PART_WORDS = 9000;
/** At most this many words of a book go through the model; the rest keeps the base conversion. */
export const BOOK_WORDS = Number(process.env.KIMONO_BOOKS_CONVERT_MAX_WORDS) || 400_000;
/** After the edits, a part must keep this much of its words (deleting running heads costs a little) and add none. */
export const KEPT = 0.93, FAITHFUL = 0.998;

const SYSTEM = `You check the structure of a book that was extracted from a PDF, so it can become a good EPUB. You never see or write the book's text as output: you send back edits to its blocks, and the program applies them.

The part you get is a list of blocks, each with an id, a kind and its page: [b12 p p.4] a paragraph, [b13 h2 p.4] a heading (h1 chapter, h2 section, h3 subsection), [b14 note 3 p.4] footnote 3's text, [b15 figure p.5] a picture (with its caption, if one was found), [b16 equation p.5], [b17 verse p.6] lines of verse, [b18 table p.7]. In text, *x* is italic, **x** bold, [^3] a footnote mark, {{img:4}} a small picture in a line.

Edits you may send (each names a block by its id; fields an edit doesn't use are null):
- heading {block, level 1-3}: the block is a chapter or section title. Chapters are level 1.
- paragraph {block}: the block was marked a heading but isn't one.
- join {block}: the block and the next text block are one paragraph wrongly split (often at a page or column break, mid-sentence).
- split {block, at, as}: a new block starts at the exact text "at" (copied character for character from the block, at the start of a word); "as" is p, h1, h2 or h3. Use it for a title run into the text, or two paragraphs run together.
- delete {block}: the block is page furniture left in: a running head or foot, a page number, a repeated magazine pull quote. Never delete the book's own text.
- move {block, after}: the block is out of reading order (a sidebar, caption or column spliced into the wrong place); put it after block "after".
- note {block, note}: the paragraph is footnote n's text that leaked into the body.
- caption {block, figure}: the paragraph is the caption of that figure.
- word {block, from, to}: a word broken across a line was joined wrongly or not at all: "from" is exactly as in the block, "to" has the same letters with only a hyphen or a space added or removed ("ex- ample" to "example", "ankledeep" to "ankle-deep" when the book means it).
- prose {block}: a verse block is really ordinary prose that was set in short lines.

The book's words are the author's: archaic spelling, dialect, slang, misspellings, invented words, odd punctuation, very long sentences, lists of names, mixed languages and verse are all deliberate. Leave them alone; there is no edit for changing a word and you must not try. When nothing needs fixing, send no edits. Fewer, surer edits are better than many doubtful ones.`;

/* A `claude setup-token` token works with the API as Claude Code: OAuth, and Claude Code's identity first in the system prompt. */
const CLAUDE_CODE = "You are Claude Code, Anthropic's official CLI for Claude.";

export type Usage = { input: number; output: number; cacheWrite: number; cacheRead: number };
export type Answer = { edits: unknown[] | null; usage: Usage };
export type Restructurer = (part: string, context: { title: string; authors: string[]; part: number; parts: number }) => Promise<Answer>;

/**
 * `claudeCode`: send Claude Code's identity even when the token doesn't look
 * like a setup token, for a gateway that swaps in the real credential (a
 * Kimono sandbox's), where the token seen here is only a stand-in.
 */
export function claudeRestructurer(raw: string, options: { baseURL?: string; claudeCode?: boolean } = {}): Restructurer {
  const token = raw.trim();
  const oauth = token.startsWith("sk-ant-oat");
  const client = new Anthropic({
    ...(oauth ? { authToken: token, apiKey: null, defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" } } : { apiKey: token }),
    baseURL: options.baseURL ?? "https://api.anthropic.com",
    maxRetries: 4,
    timeout: 15 * 60_000,
  });
  const system: Anthropic.TextBlockParam[] = [
    ...(oauth || options.claudeCode ? [{ type: "text" as const, text: CLAUDE_CODE }] : []),
    { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
  ];
  return async (part, { title, authors, part: n, parts }) => {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32_000,
      /* Judging structure needs care, not deep reasoning. */
      output_config: { effort: "low", format: { type: "json_schema", schema: EDITS_SCHEMA as unknown as Record<string, unknown> } },
      system,
      messages: [{ role: "user", content: `Part ${n} of ${parts} of "${title}"${authors.length ? ` by ${authors.join(", ")}` : ""}. A part may start or end mid-chapter.\n\n${part}` }],
    });
    const message = await stream.finalMessage();
    const u = message.usage;
    const usage = { input: u.input_tokens, output: u.output_tokens, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 };
    /* Cut short or declined: the base conversion stands. */
    if (message.stop_reason !== "end_turn") return { edits: null, usage };
    const text = message.content.flatMap((b) => b.type === "text" ? [b.text] : []).join("");
    try {
      const parsed = JSON.parse(text) as { edits?: unknown };
      return { edits: Array.isArray(parsed.edits) ? parsed.edits : null, usage };
    } catch { return { edits: null, usage }; }
  };
}

export const cost = (u: Usage) => (u.input * PRICE.input + u.output * PRICE.output + u.cacheWrite * PRICE.cacheWrite + u.cacheRead * PRICE.cacheRead) / 1e6;

/** Parts of the book for the model: cut between blocks, before a chapter where one is near, a note never parted from its mark. */
export function parts(blocks: Block[], size = PART_WORDS): Block[][] {
  const out: Block[][] = [];
  let current: Block[] = [], count = 0;
  for (const b of blocks) {
    const n = words(blockText(b)).length;
    const chapter = b.kind === "h" && b.level === 1;
    if (current.length && b.kind !== "note" && (count + n > size || (chapter && count > size * 0.5))) {
      out.push(current);
      current = []; count = 0;
    }
    current.push(b);
    count += n;
  }
  if (current.length) out.push(current);
  return out;
}

export type PassReport = { parts: number; sent: number; accepted: number; edits: number; refused: number; words: number; usage: Usage; dollars: number; rejected: string[]; editsByKind: Record<string, number>; refusals: Record<string, number>; refusedSamples: unknown[] };

/**
 * Runs the book through the model, four parts at a time, up to the book's
 * cap. `progress` hears each finished part.
 */
export async function restructure(blocks: Block[], model: Restructurer, meta: { title: string; authors: string[] }, progress?: (done: number, total: number) => void): Promise<{ blocks: Block[]; report: PassReport }> {
  const all = parts(blocks);
  const report: PassReport = { parts: all.length, sent: 0, accepted: 0, edits: 0, refused: 0, words: 0, usage: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, dollars: 0, rejected: [], editsByKind: {}, refusals: {}, refusedSamples: [] };
  let budget = BOOK_WORDS;
  let first = 1;
  const plan = all.map((p) => {
    const n = blockWords(p).length;
    const send = budget >= n;
    if (send) budget -= n;
    const ids = p.map((_, i) => first + i);
    first += p.length;
    return { blocks: p, ids, send, n };
  });
  const out: Block[][] = new Array(all.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < plan.length) {
      const i = next++;
      const p = plan[i];
      out[i] = p.blocks;
      if (!p.send) { progress?.(++done, plan.length); continue; }
      report.sent++;
      report.words += p.n;
      let edits: unknown[] | null = null;
      try {
        const answer = await model(serialise(p.blocks, p.ids), { ...meta, part: i + 1, parts: plan.length });
        for (const k of Object.keys(report.usage) as (keyof Usage)[]) report.usage[k] += answer.usage[k];
        edits = answer.edits;
        if (!edits) report.rejected.push(`part ${i + 1}: no usable answer`);
      } catch (error) {
        report.rejected.push(`part ${i + 1}: ${error instanceof Error ? error.message : error}`);
      }
      if (edits) {
        const applied = applyEdits(p.blocks, p.ids, edits);
        report.edits += applied.applied;
        report.refused += applied.refused.length;
        for (const e of edits) { const op = String((e as { op?: unknown }).op); report.editsByKind[op] = (report.editsByKind[op] ?? 0) + 1; }
        for (const r of applied.refused) {
          report.refusals[r.why] = (report.refusals[r.why] ?? 0) + 1;
          if (report.refusedSamples.length < 12) report.refusedSamples.push({ ...(r.edit as object), why: r.why });
        }
        const before = blockWords(p.blocks), after = blockWords(applied.blocks);
        const { kept } = overlap(before, after);
        const faithful = letterFaithful(before, after);
        if (kept >= KEPT && faithful >= FAITHFUL) { out[i] = applied.blocks; report.accepted++; }
        else report.rejected.push(`part ${i + 1}: words changed (kept ${kept.toFixed(3)}, faithful ${faithful.toFixed(3)})`);
      }
      progress?.(++done, plan.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  report.dollars = Math.round(cost(report.usage) * 100) / 100;
  return { blocks: out.flat(), report };
}
