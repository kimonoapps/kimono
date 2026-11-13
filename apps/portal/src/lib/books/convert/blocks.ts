/*
 * 本 A converted book between the stages: a list of blocks. structure.ts
 * makes them from the PDF, restructure.ts lets Claude edit them (move,
 * mark, join, delete furniture, never reword), epub.ts writes them out.
 *
 * Inline text: *italic*, **bold**, \* a star, [^12] a note mark, ¹² a
 * raised mark with no note of its own, {{img:7}} a small picture in a line.
 */

export type VerseLine = { indent: number; text: string };

export type Block =
  | { kind: "h"; level: number; text: string; page: number }
  | { kind: "p"; text: string; page: number }
  | { kind: "verse"; lines: VerseLine[]; page: number }
  | { kind: "note"; id: number; text: string; page: number }
  | { kind: "figure"; image: number; caption: string | null; page: number; role: "picture" | "math" | "page"; alt?: string }
  | { kind: "table"; rows: string[][]; page: number };

/** A part of a page to keep as a picture: a photo, a drawing, a display equation, a scanned page. Points, from the page's top left. */
export type Region = { id: number; page: number; x: number; y: number; w: number; h: number; raster: boolean; role: "picture" | "math" | "page" };

export const plain = (s: string) => s.replace(/\{\{img:\d+\}\}/g, " ").replace(/\\\*/g, "\u0003").replace(/\*/g, "").replace(/\u0003/g, "*").trim();

/** The words a block holds, as the checks count them. */
export function blockText(b: Block): string {
  switch (b.kind) {
    case "h": case "p": case "note": return b.text;
    case "verse": return b.lines.map((l) => l.text).join("\n");
    case "figure": return [b.caption ?? "", b.role === "math" ? "" : b.alt ?? ""].join(" ").trim();
    case "table": return b.rows.map((r) => r.join(" ")).join("\n");
  }
}

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯ｦ-ﾟ]/u;
/**
 * A text's words for comparing two versions of it: lowercased, letters and
 * digits only, marks left out. Chinese, Japanese and Korean have no spaces,
 * so each of their characters counts as a word.
 */
export function words(text: string): string[] {
  return text
    .replace(/\[\^\d+\]:?|\{\{img:\d+\}\}/g, " ")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[-­‐]/g, "")
    .replace(new RegExp(CJK.source, "gu"), " $& ")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}\p{M}]+/gu, ""))
    .filter(Boolean);
}

export const blockWords = (blocks: Block[]) => words(blocks.map(blockText).join("\n"));

/**
 * How much of `base` survives in `out` (kept) and how much of `out` was in
 * `base` (faithful), counting each word as often as it occurs.
 */
export function overlap(base: string[], out: string[]): { kept: number; faithful: number } {
  const count = new Map<string, number>();
  for (const w of base) count.set(w, (count.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of out) {
    const n = count.get(w) ?? 0;
    if (n > 0) { shared++; count.set(w, n - 1); }
  }
  return { kept: base.length ? shared / base.length : 1, faithful: out.length ? shared / out.length : 1 };
}

const isCjk = (ch: string) => CJK.test(ch);
/** A line onto what came before: a word broken at the line's end joins up, a real hyphen stays, and CJK joins with no space. */
export function join(before: string, after: string): string {
  if (!before) return after;
  if (!after) return before;
  if (/[\p{L}][-­‐]$/u.test(before)) {
    if (/^[\p{Ll}]/u.test(after)) return before.slice(0, -1) + after;
    return before + after;
  }
  if (isCjk(before.at(-1)!) && isCjk(after[0])) return before + after;
  return `${before} ${after}`;
}

/* ── How Claude sees a part of the book, and the edits it may send back ── */

/** One block per line group, each with its id: `[b12 p]`, `[b13 h2]`, `[b14 note 3]`, `[b15 figure]`, `[b16 verse]`, `[b17 table]`. */
export function serialise(blocks: Block[], ids: number[]): string {
  return blocks.map((b, i) => {
    const id = `b${ids[i]}`;
    switch (b.kind) {
      case "h": return `[${id} h${b.level} p.${b.page}] ${b.text}`;
      case "p": return `[${id} p p.${b.page}] ${b.text}`;
      case "note": return `[${id} note ${b.id} p.${b.page}] ${b.text}`;
      case "figure": return `[${id} ${b.role === "math" ? "equation" : "figure"} p.${b.page}]${b.caption ? ` caption: ${b.caption}` : ""}`;
      case "verse": return `[${id} verse p.${b.page}]\n${b.lines.map((l) => `${"  ".repeat(l.indent)}${l.text}`).join("\n")}`;
      case "table": return `[${id} table p.${b.page}]\n${b.rows.map((r) => r.join(" | ")).join("\n")}`;
    }
  }).join("\n\n");
}

export type Edit =
  | { op: "heading"; block: string; level: number }
  | { op: "paragraph"; block: string }
  | { op: "join"; block: string }
  | { op: "split"; block: string; at: string; as: "p" | "h1" | "h2" | "h3" }
  | { op: "delete"; block: string }
  | { op: "move"; block: string; after: string }
  | { op: "note"; block: string; note: number }
  | { op: "caption"; block: string; figure: string }
  | { op: "word"; block: string; from: string; to: string }
  | { op: "prose"; block: string };

/** The shape Claude answers in (structured outputs). Every field is present; the ones an edit doesn't use are null. */
export const EDITS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["edits"],
  properties: {
    edits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op", "block", "level", "at", "as", "after", "note", "figure", "from", "to"],
        properties: {
          op: { type: "string", enum: ["heading", "paragraph", "join", "split", "delete", "move", "note", "caption", "word", "prose"] },
          block: { type: "string" },
          level: { type: ["integer", "null"] },
          at: { type: ["string", "null"] },
          as: { anyOf: [{ type: "string", enum: ["p", "h1", "h2", "h3"] }, { type: "null" }] },
          after: { type: ["string", "null"] },
          note: { type: ["integer", "null"] },
          figure: { type: ["string", "null"] },
          from: { type: ["string", "null"] },
          to: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

const letters = (s: string) => s.normalize("NFKC").replace(/[\s\-­‐]+/g, "");
const WORD_LIMIT_DELETE = 25;

export type Applied = { blocks: Block[]; applied: number; refused: { edit: unknown; why: string }[] };

/**
 * Applies Claude's edits to a part, refusing any that would change the
 * book's words: a deletion longer than a running head that isn't repeated
 * elsewhere, a "word" fix that isn't the same letters with a hyphen or space
 * taken out or put in, a split at text that isn't there.
 */
export function applyEdits(blocks: Block[], ids: number[], raw: unknown[]): Applied {
  type Slot = { id: string; block: Block | null };
  let slots: Slot[] = blocks.map((b, i) => ({ id: `b${ids[i]}`, block: structuredClone(b) }));
  const refused: Applied["refused"] = [];
  let applied = 0;
  const find = (id: unknown) => slots.find((s) => s.id === id && s.block);
  const all = blockWords(blocks).join(" ");
  const edits = raw.filter((e): e is Edit & Record<string, unknown> => !!e && typeof e === "object" && typeof (e as { op?: unknown }).op === "string");
  /* Deletions and notes first (so a join can reach across a removed running head), then the rest in order, moves last. */
  const rank = (e: Edit) => e.op === "delete" || e.op === "note" || e.op === "caption" ? 0 : e.op === "move" ? 2 : 1;
  const ordered = [...edits].sort((a, b) => rank(a) - rank(b));
  let nextSplit = 1;
  for (const e of ordered) {
    const slot = find(e.block);
    const no = (why: string) => refused.push({ edit: e, why });
    if (!slot) { no("no such block"); continue; }
    const b = slot.block!;
    switch (e.op) {
      case "heading": {
        if (b.kind !== "p" && b.kind !== "h") { no("not text"); break; }
        if (words(b.text).length > 30) { no("too long for a heading"); break; }
        /* A heading set in bold or italic throughout is just a heading. */
        slot.block = { kind: "h", level: Math.min(Math.max(Number(e.level) || 1, 1), 3), text: b.text.replace(/^(\*{1,2})(?!\*)(.+?)\1$/, "$2"), page: b.page };
        applied++; break;
      }
      case "paragraph": {
        if (b.kind !== "h") { no("not a heading"); break; }
        slot.block = { kind: "p", text: b.text, page: b.page };
        applied++; break;
      }
      case "delete": {
        const w = words(blockText(b));
        const text = w.join(" ");
        const repeated = text.length > 0 && all.indexOf(text) !== all.lastIndexOf(text);
        if (b.kind === "figure" || b.kind === "table") { no("pictures and tables stay"); break; }
        if (w.length > WORD_LIMIT_DELETE && !repeated) { no("too long to be page furniture"); break; }
        slot.block = null;
        applied++; break;
      }
      case "note": {
        const target = slots.find((s) => s.block?.kind === "note" && s.block.id === e.note);
        if (b.kind !== "p") { no("only a paragraph can be a note's text"); break; }
        const refs = slots.some((s) => s.block && s.block.kind !== "note" && blockText(s.block).includes(`[^${e.note}]`));
        if (!refs) { no("no such note mark"); break; }
        if (target && target.block?.kind === "note") target.block.text = join(target.block.text, b.text);
        else { slot.block = { kind: "note", id: Number(e.note), text: b.text, page: b.page }; applied++; break; }
        slot.block = null;
        applied++; break;
      }
      case "caption": {
        const fig = find(e.figure);
        if (!fig || fig.block?.kind !== "figure" || b.kind !== "p") { no("not a figure and a paragraph"); break; }
        if (words(b.text).length > 80) { no("too long for a caption"); break; }
        fig.block.caption = fig.block.caption ? `${fig.block.caption} ${b.text}` : b.text;
        slot.block = null;
        applied++; break;
      }
      case "join": {
        const at = slots.indexOf(slot);
        const next = slots.slice(at + 1).find((s) => s.block);
        if (!next || !("text" in b) || !next.block || !("text" in next.block) || b.kind === "note" || next.block.kind === "note") { no("nothing to join"); break; }
        if (b.kind !== next.block.kind) { no("different kinds"); break; }
        b.text = join(b.text, next.block.text);
        next.block = null;
        applied++; break;
      }
      case "split": {
        if (b.kind !== "p" && b.kind !== "h") { no("not text"); break; }
        const at = typeof e.at === "string" ? b.text.indexOf(e.at) : -1;
        if (at <= 0 || !/\s$/.test(b.text.slice(0, at)) || !e.at) { no("not at a word in the block"); break; }
        const head = b.text.slice(0, at).trimEnd(), tail = b.text.slice(at);
        const as = e.as ?? "p";
        b.text = head;
        const made: Block = as === "p" ? { kind: "p", text: tail, page: b.page } : { kind: "h", level: Number(as[1]), text: tail, page: b.page };
        slots.splice(slots.indexOf(slot) + 1, 0, { id: `${slot.id}s${nextSplit++}`, block: made });
        applied++; break;
      }
      case "word": {
        if (!("text" in b) || typeof e.from !== "string" || typeof e.to !== "string" || !e.from) { no("not a word fix"); break; }
        if (letters(e.from) !== letters(e.to)) { no("changes letters"); break; }
        const i = b.text.indexOf(e.from);
        if (i < 0) { no("not in the block"); break; }
        b.text = b.text.slice(0, i) + e.to + b.text.slice(i + e.from.length);
        applied++; break;
      }
      case "prose": {
        if (b.kind !== "verse") { no("not verse"); break; }
        slot.block = { kind: "p", text: b.lines.map((l) => l.text).reduce((a, l) => join(a, l), ""), page: b.page };
        applied++; break;
      }
      case "move": {
        const target = find(e.after);
        if (!target || target === slot) { no("no such place"); break; }
        slots = slots.filter((s) => s !== slot);
        slots.splice(slots.indexOf(target) + 1, 0, slot);
        applied++; break;
      }
      default: no("unknown edit");
    }
  }
  return { blocks: slots.flatMap((s) => s.block ? [s.block] : []), applied, refused };
}
