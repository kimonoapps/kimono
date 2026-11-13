/*
 * The LLM pass: Claude reads the base conversion a part at a time and fixes
 * its structure (headings, paragraphs, broken words, leftover running heads
 * and page numbers, notes, reading order), never its words. Each part is
 * checked: its words must match the base text's almost exactly, and its note
 * marks must all still be there, or that part keeps the base text.
 *
 * It uses Kimono AI's own Claude token (lib/code/config.ts's model_token, an
 * API key or a `claude setup-token` token), so there's no second secret; with
 * none set, conversions are the base text alone.
 */
import Anthropic from "@anthropic-ai/sdk";
import { noteIds, overlap, words } from "./structure";

export const MODEL = "claude-opus-5-5";

/** Words per request: a chapter or a few, small enough that one answer never runs out of room. */
const PART_WORDS = 6000;
/** At most this many words of a book go through the model (about $5 a book on Opus 5.5); the rest keeps the base text. */
export const BOOK_WORDS = Number(process.env.KIMONO_BOOKS_CONVERT_MAX_WORDS) || 150_000;
/** The checks a part's answer must pass. */
export const KEPT = 0.95, FAITHFUL = 0.985;

const SYSTEM = `You fix the structure of a book's text that was extracted from a PDF, so it can be made into an EPUB. You are a typesetter, not an editor: you never rewrite, summarise, shorten, translate, modernise or correct the author's words. Every word of the book stays, in the same order and spelling, apart from the fixes below.

The text uses a small Markdown:
- "# " a chapter title, "## " a section, "### " a subsection, each on its own line
- paragraphs separated by one blank line
- *italic*, **bold**, and \\* for a literal asterisk
- a note mark like [^12] in the text, and the note itself on its own line: [^12]: The note's text.

Fix only these:
1. Headings: mark each chapter's title with "# " (always #, whatever the book's title page uses), sections with ## and ###; join a title broken over two lines; unmark text that isn't a title.
2. Paragraphs: join a paragraph wrongly split (often at a page break, mid-sentence), and split paragraphs wrongly run together.
3. Broken words: join a word split by a line-end hyphen ("hy- phen" becomes "hyphen"); keep real hyphens ("well-known").
4. Page furniture: delete running heads, running feet and page numbers left in the text.
5. Notes: keep every [^n] mark and every [^n]: note exactly as numbered. If a note's text leaked into the body, move it into its note. Never invent a note.
6. Reading order: if a block is plainly out of place (a caption or column spliced into a sentence), move it to where it belongs.

Answer with the corrected text only: no preface, no comments, no code fences. If nothing needs fixing, return the text unchanged.`;

/* A `claude setup-token` token works with the API as Claude Code: OAuth, and Claude Code's identity first in the system prompt. */
const CLAUDE_CODE = "You are Claude Code, Anthropic's official CLI for Claude.";

export type Restructurer = (text: string, context: { title: string; authors: string[]; part: number; parts: number }) => Promise<string | null>;

export function claudeRestructurer(raw: string, options: { baseURL?: string } = {}): Restructurer {
  const token = raw.trim();
  const oauth = token.startsWith("sk-ant-oat");
  const client = new Anthropic({
    ...(oauth ? { authToken: token, apiKey: null, defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" } } : { apiKey: token }),
    baseURL: options.baseURL ?? "https://api.anthropic.com",
    maxRetries: 3,
    timeout: 10 * 60_000,
  });
  const system: Anthropic.TextBlockParam[] = [
    ...(oauth ? [{ type: "text" as const, text: CLAUDE_CODE }] : []),
    { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
  ];
  return async (text, { title, authors, part, parts }) => {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 64_000,
      /* Restructuring needs care, not deep reasoning. */
      output_config: { effort: "low" },
      system,
      messages: [{
        role: "user",
        content: `Part ${part} of ${parts} of "${title}"${authors.length ? ` by ${authors.join(", ")}` : ""}. A part may start or end mid-chapter; don't add headings that aren't in the text.\n\n${text}`,
      }],
    });
    const message = await stream.finalMessage();
    /* Cut short or declined: the base text stands. */
    if (message.stop_reason !== "end_turn") return null;
    return message.content.flatMap((b) => b.type === "text" ? [b.text] : []).join("").trim() || null;
  };
}

/** Parts of the text for the model, cut between blocks, before a chapter where one is near. */
export function parts(text: string, size = PART_WORDS): string[] {
  const blocks = text.split(/\n{2,}/);
  const out: string[] = [];
  let current: string[] = [], count = 0;
  for (const block of blocks) {
    const n = words(block).length;
    const chapter = block.startsWith("# ");
    if (current.length && (count + n > size || (chapter && count > size * 0.5)) && !/^\[\^\d+\]:/.test(block)) {
      out.push(current.join("\n\n"));
      current = []; count = 0;
    }
    current.push(block);
    count += n;
  }
  if (current.length) out.push(current.join("\n\n"));
  return out;
}

export type Checked = { text: string; accepted: boolean; kept: number; faithful: number; why?: string };

/** The model's answer, if it only restructured; otherwise the base text. */
export function check(base: string, answer: string | null): Checked {
  if (!answer) return { text: base, accepted: false, kept: 0, faithful: 0, why: "no answer" };
  const cleaned = answer.replace(/^```[a-z]*\n?|\n?```$/g, "").trim();
  const { kept, faithful } = overlap(base, cleaned);
  if (kept < KEPT || faithful < FAITHFUL) return { text: base, accepted: false, kept, faithful, why: `words changed (kept ${kept.toFixed(3)}, faithful ${faithful.toFixed(3)})` };
  const a = noteIds(base), b = noteIds(cleaned);
  if (a.refs.join() !== b.refs.join() || a.defs.join() !== b.defs.join()) return { text: base, accepted: false, kept, faithful, why: "notes changed" };
  return { text: cleaned, accepted: true, kept, faithful };
}

export type PassReport = { parts: number; sent: number; accepted: number; words: number; rejected: string[] };

/**
 * Runs the whole text through the model, a few parts at a time, up to the
 * book's cap. `progress` hears each finished part.
 */
export async function restructure(text: string, model: Restructurer, meta: { title: string; authors: string[] }, progress?: (done: number, total: number) => void): Promise<{ text: string; report: PassReport }> {
  const all = parts(text);
  const report: PassReport = { parts: all.length, sent: 0, accepted: 0, words: 0, rejected: [] };
  let budget = BOOK_WORDS;
  const plan = all.map((p) => {
    const n = words(p).length;
    const send = budget >= n;
    if (send) budget -= n;
    return { text: p, send, n };
  });
  const out: string[] = new Array(all.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < plan.length) {
      const i = next++;
      const p = plan[i];
      if (!p.send) { out[i] = p.text; progress?.(++done, plan.length); continue; }
      report.sent++;
      report.words += p.n;
      let answer: string | null = null;
      try { answer = await model(p.text, { ...meta, part: i + 1, parts: plan.length }); } catch (error) {
        report.rejected.push(`part ${i + 1}: ${error instanceof Error ? error.message : error}`);
      }
      const checked = check(p.text, answer);
      if (checked.accepted) report.accepted++;
      else if (answer !== null || !report.rejected.some((r) => r.startsWith(`part ${i + 1}:`))) report.rejected.push(`part ${i + 1}: ${checked.why}`);
      out[i] = checked.text;
      progress?.(++done, plan.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { text: out.join("\n\n"), report };
}
