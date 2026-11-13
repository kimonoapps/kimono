/*
 * 本 The base conversion: a PDF's positioned text (pdf.ts) into a book's
 * text, by rules. Running heads and page numbers go, lines join into
 * paragraphs, words broken at a line's end join up, bigger type becomes
 * headings, and the small type at a page's foot that starts with a mark
 * becomes footnotes tied to the marks in the text.
 *
 * The text is a small Markdown both this and the LLM pass speak:
 *   # Chapter   ## Section   ### Sub
 *   paragraphs separated by a blank line, *italic*, **bold**, \* a star
 *   a note mark[^12], and its note on its own: [^12]: The note's text.
 * Pure, so scripts/test-books-convert.mjs checks it without poppler.
 */

export type Item = { top: number; left: number; width: number; height: number; size: number; text: string };
export type Page = { number: number; width: number; height: number; items: Item[] };

type Line = { page: number; top: number; bottom: number; left: number; right: number; size: number; text: string; refs: string[] };

const MARK = /^(?:\d{1,3}|[*†‡§¶]{1,3}|\\\*{1,3})$/;
const NOTE_START = /^(\d{1,3}|[*†‡§¶]{1,3}|(?:\\\*){1,3})[.)]?\s+(?=\S)/;
const REF = (m: string) => `\u0001${m}\u0002`;
const plain = (s: string) => s.replace(/\\\*/g, "\u0003").replace(/\*/g, "").replace(/\u0003/g, "*").trim();

/** Items on one baseline become one line; a small mark riding high after a word is a note reference. */
function linesOf(page: Page): Line[] {
  const items = [...page.items].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: Item[][] = [];
  for (const item of items) {
    const row = rows.find((r) => r.some((o) => rise(o, item) > 0.4 * Math.min(o.height, item.height)));
    if (row) row.push(item); else rows.push([item]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.left - b.left);
    const size = weightedSize(row);
    let text = "";
    const refs: string[] = [];
    let end = -Infinity;
    for (const item of row) {
      const t = plain(item.text);
      /* Smaller, and not hanging below the line (a subscript would): poppler doesn't always report the rise itself. */
      const main = row.find((o) => o.size >= size * 0.95) ?? row[0];
      const raised = item.size > 0 && item.size < size * 0.82 && MARK.test(t.replace(/\*/g, "\\*")) && item.top + item.height <= main.top + main.height + 1;
      if (raised && text) { refs.push(t); text = text.replace(/\s+$/, "") + REF(t); end = item.left + item.width; continue; }
      const gap = item.left - end;
      if (text && gap > Math.max(1, size * 0.12) && !/\s$/.test(text) && !/^\s/.test(item.text)) text += " ";
      text += item.text;
      end = item.left + item.width;
    }
    const top = Math.min(...row.map((i) => i.top));
    return {
      page: 0, top, bottom: Math.max(...row.map((i) => i.top + i.height)),
      left: row[0].left, right: Math.max(...row.map((i) => i.left + i.width)), size,
      text: text.replace(/\s+/g, " ").trim(), refs,
    };
  }).filter((l) => l.text).sort((a, b) => a.top - b.top);
}

const rise = (a: Item, b: Item) => Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
function weightedSize(items: { size: number; text: string }[]) {
  const by = new Map<number, number>();
  for (const i of items) by.set(Math.round(i.size * 2) / 2, (by.get(Math.round(i.size * 2) / 2) ?? 0) + i.text.length);
  return [...by].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

/** Running heads and folios read the same on every page once numbers are set aside. */
const shape = (s: string) => plain(s).toLowerCase().replace(/\u0001.*?\u0002/g, "").replace(/\b[ivxlcdm]+\b|\d+/g, "#").replace(/[^\p{L}#]+/gu, " ").trim();
const FOLIO = /^(?:page\s+)?(?:\d{1,4}|[ivxlcdm]{1,7})(?:\s+of\s+\d+)?$/i;

export type Structured = { text: string; words: number; notes: number; headings: number };

export function structure(pages: Page[]): Structured {
  const perPage = pages.map((p) => linesOf(p).map((l) => ({ ...l, page: p.number })));

  /* Running heads, feet and page numbers: in the top or bottom band, and the same shape on a quarter of the pages or more. */
  const band = (l: Line, p: Page) => l.top < p.height * 0.1 || l.bottom > p.height * 0.9;
  const seen = new Map<string, Set<number>>();
  perPage.forEach((lines, i) => {
    for (const l of lines) if (band(l, pages[i])) {
      const s = shape(l.text);
      if (s) (seen.get(s) ?? seen.set(s, new Set()).get(s)!).add(i);
    }
  });
  const repeated = (s: string) => (seen.get(s)?.size ?? 0) >= Math.max(2, Math.ceil(pages.length * 0.25));
  const kept = perPage.map((lines, i) => lines.filter((l) => !(band(l, pages[i]) && (FOLIO.test(plain(l.text).replace(/[—–-]/g, "").trim()) || (pages.length > 2 && repeated(shape(l.text)))))));

  const body = weightedSize(kept.flat().map((l) => ({ size: l.size, text: l.text })));

  /* Footnotes: the run of smaller type at a page's foot, starting with a mark. */
  let nextNote = 1;
  const notes: { id: number; text: string; page: number }[] = [];
  const ids = new Map<string, number>(); // `${page}:${mark}` → note id
  const content = kept.map((lines, i) => {
    const page = pages[i];
    let start = lines.length;
    while (start > 0 && lines[start - 1].size > 0 && lines[start - 1].size <= body * 0.88 && lines[start - 1].top > page.height * 0.5) start--;
    const foot = lines.slice(start);
    if (!foot.length) return lines;
    const opens = (l: Line) => NOTE_START.test(l.text) || (l.refs.length > 0 && l.text.startsWith("\u0001"));
    if (!opens(foot[0])) return lines;
    let current: { id: number; text: string; page: number } | null = null;
    for (const l of foot) {
      if (opens(l)) {
        const mark = l.text.startsWith("\u0001") ? l.refs[0] : plain(NOTE_START.exec(l.text)![1]);
        const text = l.text.startsWith("\u0001") ? l.text.replace(/^\u0001.*?\u0002\s*/, "") : l.text.replace(NOTE_START, "");
        current = { id: nextNote++, text, page: page.number };
        ids.set(`${page.number}:${mark}`, current.id);
        notes.push(current);
      } else if (current) current.text = join(current.text, l.text);
    }
    return lines.slice(0, start);
  });

  /* Headings: type clearly bigger than the body's, in at most three sizes. */
  const big = content.flat().filter((l) => l.size >= body * 1.2 && plain(l.text).length <= 150);
  const rounded = (l: Line) => Math.round(l.size * 2) / 2;
  /* Sizes used only on the first pages (a title page's) don't outrank the chapters': the biggest is the book's title, the rest are its lines. */
  const front = Math.min(2, Math.floor(pages.length / 3));
  const onlyFront = new Set([...new Set(big.map(rounded))].filter((size) => big.every((l) => rounded(l) !== size || l.page <= front)));
  const headingSizes = [...new Set(big.map(rounded))].filter((size) => !onlyFront.has(size)).sort((a, b) => b - a);
  const titleSize = Math.max(...onlyFront);
  const level = (l: Line) => {
    if (l.size < body * 1.2 || plain(l.text).length > 150) return 0;
    if (onlyFront.has(rounded(l))) return rounded(l) === titleSize ? 1 : 0;
    return Math.min(headingSizes.indexOf(rounded(l)) + 1, 3);
  };

  /* The usual distance from one line to the next, for telling a paragraph's end from a line's. */
  const steps: number[] = [];
  for (const lines of content) for (let j = 1; j < lines.length; j++) {
    const d = lines[j].top - lines[j - 1].top;
    if (d > 0 && !level(lines[j]) && !level(lines[j - 1])) steps.push(d);
  }
  steps.sort((a, b) => a - b);
  const step = steps[Math.floor(steps.length / 2)] || body * 1.3;

  const blocks: string[] = [];
  const pendingNotes: { id: number; text: string }[] = [];
  let para = "";
  let heading: { level: number; text: string } | null = null;
  const refsDone = new Set<number>();
  const flushPara = () => {
    if (para) blocks.push(escapeBlock(para));
    para = "";
    for (let k = 0; k < pendingNotes.length;) {
      if (refsDone.has(pendingNotes[k].id)) { const n = pendingNotes.splice(k, 1)[0]; blocks.push(`[^${n.id}]: ${n.text}`); } else k++;
    }
  };
  const flushHeading = () => {
    /* A heading set in bold or italic throughout is just a heading. */
    if (heading) blocks.push(`${"#".repeat(heading.level)} ${heading.text.replace(/^(\*{1,2})(?!\*)(.+?)\1$/, "$2")}`);
    heading = null;
  };

  content.forEach((lines, i) => {
    const page = pages[i];
    const margin = Math.min(...lines.filter((l) => !level(l)).map((l) => l.left));
    const right = Math.max(...lines.filter((l) => !level(l)).map((l) => l.right));
    lines.forEach((l, j) => {
      const text = l.text.replace(/\u0001(.*?)\u0002/g, (m, mark: string) => {
        const id = ids.get(`${page.number}:${mark}`);
        if (!id) return mark;
        refsDone.add(id);
        return `[^${id}]`;
      });
      const lv = level(l);
      if (lv) {
        flushPara();
        if (heading && heading.level === lv && j > 0 && l.top - lines[j - 1].bottom < l.size * 1.2) heading.text = join(heading.text, text);
        else { flushHeading(); heading = { level: lv, text }; }
        return;
      }
      flushHeading();
      const prev = j > 0 ? lines[j - 1] : null;
      const startsNew = !para
        || (prev && !level(prev) && l.top - prev.top > step * 1.45)
        || (Number.isFinite(margin) && l.left > margin + body * 0.8 && l.right <= right + body)
        || (prev && !level(prev) && prev.right < right - body * 4 && /[.!?:…"”’)]$/.test(plain(prev.text)))
        || (!prev && /[.!?…"”’)]$/.test(plain(para)) && /^[\p{Lu}"“‘(]/u.test(plain(text)));
      if (startsNew) { flushPara(); para = text; } else para = join(para, text);
    });
    for (const n of notes.filter((n) => n.page === page.number)) pendingNotes.push({ id: n.id, text: n.text.replace(/\u0001(.*?)\u0002/g, "$1") });
  });
  flushHeading();
  flushPara();
  for (const n of pendingNotes) blocks.push(`[^${n.id}]: ${n.text}`);

  const text = blocks.join("\n\n");
  return { text, words: words(text).length, notes: notes.length, headings: blocks.filter((b) => b.startsWith("#")).length };
}

/** A line onto what came before: a word broken at the line's end joins up, a real hyphen stays. */
export function join(before: string, after: string): string {
  if (!before) return after;
  const m = /([\p{L}])[-\u00ad\u2010]$/u.exec(before);
  if (m) {
    if (/^[\p{Ll}]/u.test(after)) return before.slice(0, -1) + after;
    return before + after;
  }
  return `${before} ${after}`;
}

/* A paragraph that happens to start like a heading or a note isn't one. */
const escapeBlock = (s: string) => s.replace(/^(#{1,6}\s)/, "\\$1").replace(/^(\[\^\d+\]:)/, "\\$1");

/** A text's words for comparing two versions of it: lowercased, letters and digits only, marks and note numbers left out. */
export function words(text: string): string[] {
  return text
    .replace(/\[\^\d+\]:?/g, " ")
    .toLowerCase()
    .replace(/[-\u00ad\u2010]/g, "")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter(Boolean);
}

/**
 * How much of `base` survives in `out` (kept) and how much of `out` was in
 * `base` (faithful), counting each word as often as it occurs. The LLM pass
 * may only move and mark text, so both stay near 1.
 */
export function overlap(base: string, out: string): { kept: number; faithful: number } {
  const a = words(base), b = words(out);
  const count = new Map<string, number>();
  for (const w of a) count.set(w, (count.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of b) {
    const n = count.get(w) ?? 0;
    if (n > 0) { shared++; count.set(w, n - 1); }
  }
  return { kept: a.length ? shared / a.length : 1, faithful: b.length ? shared / b.length : 1 };
}

/** Note numbers marked in a text, and those defined. */
export function noteIds(text: string): { refs: string[]; defs: string[] } {
  const defs = [...text.matchAll(/^\[\^(\d+)\]:/gm)].map((m) => m[1]);
  const refs = [...text.replace(/^\[\^\d+\]:/gm, "").matchAll(/\[\^(\d+)\]/g)].map((m) => m[1]);
  return { refs: [...new Set(refs)].sort(), defs: [...new Set(defs)].sort() };
}
