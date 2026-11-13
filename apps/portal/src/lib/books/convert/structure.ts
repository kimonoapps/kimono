/*
 * 本 The base conversion: a PDF's positioned text (pdf.ts) and its figures
 * (figures.ts) into the book's blocks (blocks.ts), by rules.
 *
 * Each page is cut into its reading order first (recursive X-Y cuts: a
 * column gutter splits left from right, right from left in Arabic and
 * Hebrew; a wide gap splits top from bottom). Then, in order: running heads
 * and page numbers go; small type at a column's foot that starts with a
 * mark becomes footnotes tied to the marks in the text; bigger type becomes
 * headings; runs of short lines stay verse, line for line; aligned columns
 * of short cells become tables; lines of mathematics become pictures; a
 * figure takes the caption beside it; and the rest joins into paragraphs,
 * a word broken at a line's or a page's end joined up. A figure that
 * interrupts a paragraph goes after it. Pure, so the tests check it without
 * poppler.
 */
import { join, plain, words, type Block, type Region, type VerseLine } from "./blocks";
import { inside, type Box, type Figure } from "./figures";

export type Item = { top: number; left: number; width: number; height: number; size: number; text: string };
export type Page = { number: number; width: number; height: number; items: Item[] };

type Seg = { left: number; right: number; text: string };
type Line = {
  page: number; leaf: number; top: number; bottom: number; left: number; right: number; size: number;
  text: string; refs: string[]; segs: Seg[]; rtl: boolean; figure?: number;
  /** The width of the column or page this line was set in. */
  frame: number;
};

const MARK = /^(?:\d{1,3}|[*†‡§¶]{1,3}|\\\*{1,3})$/;
const NOTE_START = /^(\d{1,3}|[*†‡§¶]{1,3}|(?:\\\*){1,3})[.)]?\s+(?=\S)/;
const REF = (m: string) => `\u0001${m}\u0002`;
const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/gu;
const RTL_RUN = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff](?:[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u0660-\u0669\u06f0-\u06f9\s]*[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u0660-\u0669])?/gu;
const RTL_ONE = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u;
const LETTER = /\p{L}/gu;
const CAPTION = /^(fig(?:ure)?s?\.?|plate|photo(?:graph)?|illustration|image|map|diagram|chart|table|abb\.|abbildung|figura|ill\.|picture|exhibit|source)\s*[\divxlcIVXLC]/i;
const MATH_CHARS = /[=+−×÷∑∏∫∮√∞≤≥≠≈≡±∓∂∇∈∉⊂⊃⊆⊇∪∩→←↔⇒⇔⟨⟩∀∃αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ′″^_|]/gu;
const SUPER: Record<string, string> = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "*": "*" };

const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;
const isRtl = (s: string) => { const r = count(s, RTL); return r > 0 && r >= count(s, LETTER) * 0.5; };
const rise = (a: { top: number; height: number }, b: { top: number; height: number }) => Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
const median = (xs: number[], fallback: number) => { if (!xs.length) return fallback; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
function weightedSize(items: { size: number; text: string }[]) {
  const by = new Map<number, number>();
  for (const i of items) { const k = Math.round(i.size * 2) / 2; by.set(k, (by.get(k) ?? 0) + i.text.length); }
  return [...by].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

/* ── Vertical text ───────────────────────────────────────────────────── */

const CJK_ONE = /^[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\ufe10-\ufe4f]$/u;
/** Japanese or Chinese set in columns, top to bottom, right to left: poppler gives it a character at a time. */
function isVertical(items: Item[]): boolean {
  const singles = items.filter((i) => CJK_ONE.test(i.text.trim()));
  if (items.length < 20 || singles.length < items.length * 0.6) return false;
  const stacked = singles.filter((i) => singles.some((o) => o !== i && Math.abs(o.left - i.left) < i.width * 0.3 && o.top > i.top && o.top - (i.top + i.height) < i.height * 0.6));
  return stacked.length >= singles.length * 0.6;
}

/** Turns each column into a line, rightmost first, so the rest reads it like horizontal text. */
function columnsToLines(items: Item[], page: { width: number }): Item[] {
  const cols: Item[][] = [];
  /* Punctuation sits in a corner of its cell, off the column's centre: it joins the nearest column after the rest. */
  const PUNCT = /^[、。，．・：；！？「」『』（）〈〉《》【】\ufe10-\ufe19\ufe30-\ufe4f]$/u;
  const center = (i: Item) => i.left + i.width / 2;
  const sorted = [...items].sort((a, b) => b.left - a.left || a.top - b.top);
  for (const i of sorted.filter((x) => !PUNCT.test(x.text.trim()))) {
    const col = cols.find((c) => Math.abs(center(c[0]) - center(i)) < Math.max(c[0].width, i.width) * 0.45);
    if (col) col.push(i); else cols.push([i]);
  }
  for (const i of sorted.filter((x) => PUNCT.test(x.text.trim()))) {
    const near = cols.map((c) => ({ c, d: Math.abs(center(c[0]) - center(i)) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d < near.c[0].width * 1.2) near.c.push(i); else cols.push([i]);
  }
  return cols.map((c) => {
    c.sort((a, b) => a.top - b.top);
    const size = weightedSize(c);
    const top = c[0].top, bottom = Math.max(...c.map((i) => i.top + i.height));
    const x = Math.min(...c.map((i) => i.left));
    /* Rotated: the column's place across the page becomes its line's place down it; where it starts, its indent. */
    return { top: page.width - x - size, left: top, width: bottom - top, height: size, size, text: c.map((i) => i.text).join("").replace(/\u3000/g, "　") };
  });
}

/* ── Reading order: X-Y cuts ─────────────────────────────────────────── */

type Unit = { top: number; left: number; width: number; height: number; size: number; text: string; figure?: number };

/** Splits a page's units into leaves in reading order. */
type Leaf = { units: Unit[]; frame: number };
const span = (units: Unit[]) => Math.max(...units.map((u) => u.left + u.width)) - Math.min(...units.map((u) => u.left));
function cut(units: Unit[], size: number, rtl: boolean, leading: number, frame: number): Leaf[] {
  if (units.length <= 1) return [{ units, frame }];
  const x = xCut(units, size, rtl);
  if (x) return x.flatMap((part) => cut(part, size, rtl, leading, Math.min(frame, span(part))));
  const y = yCut(units, size, leading);
  if (y) return y.flatMap((part) => cut(part, size, rtl, leading, frame));
  return [{ units, frame }];
}

/** The usual white space between one line and the next on a page. */
function leadingOf(units: Unit[], size: number): number {
  const rows = [...units].filter((u) => u.figure === undefined).sort((a, b) => a.top - b.top);
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const g = rows[i].top - (rows[i - 1].top + rows[i - 1].height);
    if (g > 0 && g < size * 3) gaps.push(g);
  }
  return median(gaps, size * 0.3);
}

/** A gutter running the whole height of these units, with real text on both sides (not a table's short cells). */
function xCut(units: Unit[], size: number, rtl: boolean): Unit[][] | null {
  const spans = units.map((u) => [u.left, u.left + u.width] as const).sort((a, b) => a[0] - b[0]);
  let best: { at: number; gap: number } | null = null;
  let end = spans[0][1];
  for (const [l, r] of spans.slice(1)) {
    if (l - end >= Math.max(7, size * 0.7) && (!best || l - end > best.gap)) best = { at: (l + end) / 2, gap: l - end };
    end = Math.max(end, r);
  }
  if (!best) return null;
  const left = units.filter((u) => u.left + u.width / 2 < best!.at), right = units.filter((u) => u.left + u.width / 2 >= best!.at);
  const prose = (side: Unit[]) => {
    const text = side.filter((u) => u.figure === undefined);
    if (!text.length) return side.length > 0; // a figure beside text
    const chars = text.reduce((n, u) => n + plain(u.text).length, 0);
    return chars >= 40 && chars / text.length >= 10;
  };
  if (!left.length || !right.length || !prose(left) || !prose(right)) return null;
  return rtl ? [right, left] : [left, right];
}

/** The widest gap from top to bottom, when it's wider than a line's leading. */
function yCut(units: Unit[], size: number, leading: number): Unit[][] | null {
  const spans = units.map((u) => [u.top, u.top + u.height] as const).sort((a, b) => a[0] - b[0]);
  let best: { at: number; gap: number } | null = null;
  let end = spans[0][1];
  for (const [t, b] of spans.slice(1)) {
    if (t - end >= Math.max(size * 0.5, leading * 1.8 + 1) && (!best || t - end > best.gap)) best = { at: (t + end) / 2, gap: t - end };
    end = Math.max(end, b);
  }
  if (!best) return null;
  const top = units.filter((u) => u.top + u.height / 2 < best!.at), bottom = units.filter((u) => u.top + u.height / 2 >= best!.at);
  return top.length && bottom.length ? [top, bottom] : null;
}

/* ── Lines ───────────────────────────────────────────────────────────── */

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", "‹": "›", "›": "‹" };
const LTR_RUN = /[0-9\u0660-\u0669\u06f0-\u06f9A-Za-z\u00c0-\u024f](?:[0-9\u0660-\u0669\u06f0-\u06f9A-Za-z\u00c0-\u024f.,:/%'’\- ]*[0-9\u0660-\u0669\u06f0-\u06f9A-Za-z\u00c0-\u024f])?/g;
/**
 * poppler gives Arabic and Hebrew in the order they're drawn, right to left
 * read as left to right: turn it back into reading order, keeping a letter's
 * marks on it, numbers and Latin words the right way round, and brackets
 * facing the right way.
 */
export function logicalOrder(visual: string): string {
  const reversed = [...graphemes.segment(visual)].map((g) => g.segment).reverse().map((g) => MIRROR[g] ?? g).join("");
  return reversed.replace(LTR_RUN, (run) => [...graphemes.segment(run)].map((g) => g.segment).reverse().join(""));
}

/** Units on one baseline become one line; a small mark riding high after a word is a note reference; a drop cap joins its word. */
function linesOf(units: Unit[], page: number, leaf: number, frame: number): Line[] {
  const sizes = units.filter((u) => u.figure === undefined).map((u) => u.size);
  const usual = median(sizes, 10);
  /* A drop cap: one or two letters far bigger than the text beside them. */
  const caps = units.filter((u) => u.figure === undefined && plain(u.text).length <= 2 && /\p{L}/u.test(plain(u.text)) && u.size >= usual * 1.8 && units.some((o) => o !== u && o.left > u.left + u.width - 1 && o.left < u.left + u.width + usual * 2 && Math.abs(o.top - u.top) < u.height));
  const rest = units.filter((u) => !caps.includes(u)).sort((a, b) => a.top - b.top || a.left - b.left);
  /* A figure is a line of its own, never part of the text beside or over it. */
  const rows: Unit[][] = rest.filter((u) => u.figure !== undefined).map((u) => [u]);
  for (const u of rest.filter((x) => x.figure === undefined)) {
    const row = rows.find((r) => r[0].figure === undefined && r.some((o) => rise(o, u) > 0.4 * Math.min(o.height, u.height)));
    if (row) row.push(u); else rows.push([u]);
  }
  /* Lines beside a drop cap start where it does: they're not indented. */
  const besideCap = new Set<Unit[]>();
  for (const cap of caps) {
    const row = rows.filter((r) => r.some((o) => o.left >= cap.left + cap.width - 1)).sort((a, b) => Math.abs(a[0].top - cap.top) - Math.abs(b[0].top - cap.top))[0];
    if (row) row.unshift({ ...cap, size: row[0].size, left: cap.left, text: `${cap.text}\u0005` });
    for (const r of rows) if (r !== row && r[0].figure === undefined && r[0].top >= cap.top - 1 && r[0].top < cap.top + cap.height - 2) besideCap.add(r);
  }
  return rows.map((row) => {
    const rtl = isRtl(row.map((u) => u.text).join(""));
    row.sort((a, b) => rtl ? b.left - a.left : a.left - b.left);
    if (rtl) for (const u of row) if (u.figure === undefined && RTL_ONE.test(u.text)) u.text = logicalOrder(u.text);
    /* Arabic or Hebrew words inside a left-to-right line are drawn reversed too. */
    if (!rtl) for (const u of row) if (u.figure === undefined && RTL_ONE.test(u.text)) u.text = u.text.replace(RTL_RUN, (run) => logicalOrder(run));
    const size = weightedSize(row.filter((u) => u.figure === undefined));
    const main = row.find((o) => o.figure === undefined && o.size >= size * 0.95) ?? row[0];
    let text = "";
    const refs: string[] = [];
    const segs: Seg[] = [];
    let edge = rtl ? Infinity : -Infinity;
    for (const u of row) {
      const t = plain(u.text);
      /* Smaller, and not hanging below the line (a subscript would): poppler doesn't always report the rise itself. */
      const raised = u.figure === undefined && u.size > 0 && u.size < size * 0.82 && MARK.test(t.replace(/\*/g, "\\*")) && u.top + u.height <= main.top + main.height + 1;
      if (raised && text) { refs.push(t); text = text.replace(/\s+$/, "") + REF(t); edge = rtl ? u.left : u.left + u.width; continue; }
      const gap = rtl ? edge - (u.left + u.width) : u.left - edge;
      if (text && gap > Math.max(1, size * 0.12) && !/\s$/.test(text) && !/^[\s\p{M}]/u.test(u.text) && !text.endsWith("\u0005")) text += " ";
      if (!segs.length || gap > size * 1.2) segs.push({ left: u.left, right: u.left + u.width, text: u.text });
      else { const s = segs.at(-1)!; s.text = join(s.text, u.text); s.left = Math.min(s.left, u.left); s.right = Math.max(s.right, u.left + u.width); }
      text += u.text;
      edge = rtl ? u.left : u.left + u.width;
    }
    const lone = row.length === 1 && row[0].figure !== undefined ? row[0].figure : undefined;
    return {
      page, leaf, top: Math.min(...row.map((u) => u.top)), bottom: Math.max(...row.map((u) => u.top + u.height)),
      left: besideCap.has(row) ? Math.min(...caps.map((c) => c.left)) : Math.min(...row.map((u) => u.left)), right: Math.max(...row.map((u) => u.left + u.width)), size,
      text: text.replace(/\u0005/g, "").replace(/\s+/g, " ").trim(), refs, segs, rtl, figure: lone, frame,
    };
  }).filter((l) => l.text || l.figure !== undefined).sort((a, b) => a.top - b.top);
}

/** Running heads and folios read the same on every page once numbers are set aside. */
const shape = (s: string) => plain(s).toLowerCase().replace(/\u0001.*?\u0002/g, "").replace(/\b[ivxlcdm]+\b|\d+/g, "#").replace(/[^\p{L}#]+/gu, " ").trim();
const FOLIO = /^(?:page\s+|p\.\s*)?(?:\d{1,4}|[ivxlcdm]{1,7})(?:\s*(?:of|\/)\s*\d+)?$/i;

export type Structured = { blocks: Block[]; regions: Region[]; words: number; notes: number; headings: number; figures: number; verse: number; tables: number };

export function structure(pages: Page[], figures: Map<number, Figure[]> = new Map()): Structured {
  const regions: Region[] = [];
  /* The words inside each figure (a diagram's labels, a balloon's lines), kept as its alt text. */
  const alts = new Map<number, string>();
  let leafId = 0;
  const allSizes = pages.flatMap((p) => p.items.map((i) => ({ size: i.size, text: i.text })));
  const body0 = weightedSize(allSizes) || 10;
  /* The usual width of the text on a page: what a full line measures in a single-column book. */
  const spans = pages.map((p) => p.items.length >= 3 ? span(p.items.map((i) => ({ ...i }))) : 0).filter((w) => w > 0).sort((a, b) => a - b);
  const pageFrame = spans[Math.floor(spans.length * 0.9)] ?? 0;

  /* 1. Each page in reading order, figures among the text. */
  const perPage: Line[][] = pages.map((page) => {
    const figs = figures.get(page.number) ?? [];
    const pageArea = page.width * page.height;
    const units: Unit[] = [];
    const vertical = isVertical(page.items);
    const items = vertical ? columnsToLines(page.items.filter((i) => i.text.trim() || i.text === "\u3000"), page) : page.items.filter((i) => i.text.trim());
    for (const f0 of figs) {
      let f = f0;
      /* A drawing's labels just outside its lines (axis ticks and titles, a map's names): short, no full stop, not its caption. */
      if (!f0.raster && f0.w * f0.h < pageArea * 0.6) {
        const label = (i: Item) => words(plain(i.text)).length <= 6 && !/[.!?]["”’)]?$/.test(plain(i.text)) && !CAPTION.test(plain(i.text)) && i.width < page.width * 0.45;
        const near = (i: Item, b: Box) => { const dx = Math.max(b.x - (i.left + i.width), i.left - (b.x + b.w), 0), dy = Math.max(b.y - (i.top + i.height), i.top - (b.y + b.h), 0); return Math.max(dx, dy) < Math.max(10, i.size * 1.4); };
        let grew = true;
        while (grew) {
          grew = false;
          for (const i of items) if (label(i) && near(i, f) && !inside({ x: i.left, y: i.top, w: i.width, h: i.height }, f)) {
            const x = Math.min(f.x, i.left), y = Math.min(f.y, i.top);
            f = { ...f, x, y, w: Math.max(f.x + f.w, i.left + i.width) - x, h: Math.max(f.y + f.h, i.top + i.height) - y };
            grew = true;
          }
        }
        if (f !== f0) f = { ...f, x: f.x - 2, y: f.y - 2, w: f.w + 4, h: f.h + 4 };
      }
      const big = f.w * f.h > pageArea * 0.6;
      const id = regions.length + 1;
      const role = f.w * f.h > pageArea * 0.85 ? "page" : "picture";
      /* A small picture sitting in a line of text is part of that line. */
      const inline = f.h < body0 * 2.5 && items.some((i) => rise({ top: f.y, height: f.h }, i) > f.h * 0.5 && Math.abs(i.size - body0) < body0 * 0.3);
      regions.push({ id, page: page.number, x: f.x, y: f.y, w: f.w, h: f.h, raster: f.raster, role });
      units.push({ top: f.y, left: f.x, width: f.w, height: f.h, size: inline ? body0 : 0, text: inline ? `{{img:${id}}}` : "", figure: inline ? undefined : id });
      /* Its labels and balloons belong to the picture; text over a whole-page picture is read as text too. */
      if (!big) {
        const within = items.filter((i) => inside({ x: i.left, y: i.top, w: i.width, h: i.height }, f));
        if (within.length) {
          alts.set(id, plain(within.sort((a, b) => a.top - b.top || a.left - b.left).map((i) => i.text).join(" ")).replace(/\s+/g, " "));
          for (const i of within) items.splice(items.indexOf(i), 1);
        }
      }
    }
    for (const i of items) units.push({ ...i });
    if (!units.length) return [];
    const rtl = isRtl(items.map((i) => i.text).join(""));
    const size = median(items.map((i) => i.size), body0);
    const leaves = cut(units, size, rtl, leadingOf(units, size), pageFrame || span(units));
    return leaves.flatMap((leaf) => linesOf(leaf.units, page.number, ++leafId, leaf.frame));
  });

  /* 2. Running heads, feet and page numbers: small, in the top or bottom tenth, and a page number or the same words on two pages or more. */
  const pageOf = new Map(pages.map((p) => [p.number, p]));
  const band = (l: Line) => { const p = pageOf.get(l.page)!; return l.top < p.height * 0.1 || l.bottom > p.height * 0.9; };
  const body = weightedSize(perPage.flat().filter((l) => l.figure === undefined).map((l) => ({ size: l.size, text: l.text }))) || body0;
  const seen = new Map<string, Set<number>>();
  for (const l of perPage.flat()) if (l.figure === undefined && band(l)) {
    const s = shape(l.text);
    if (s) (seen.get(s) ?? seen.set(s, new Set()).get(s)!).add(l.page);
  }
  const furniture = (l: Line) => l.figure === undefined && band(l) && l.size <= body * 1.05 && words(l.text).length <= 14 && (
    FOLIO.test(plain(l.text).replace(/[—–\-·•|]/g, " ").trim().replace(/\s+/g, " ")) ||
    (pages.length >= 2 && (seen.get(shape(l.text))?.size ?? 0) >= 2));
  const kept = perPage.map((lines) => lines.filter((l) => !furniture(l)));

  /* 3. Footnotes: the run of smaller type at the foot of a column, starting with a mark. */
  let nextNote = 1;
  const notes: { id: number; text: string; page: number }[] = [];
  const ids = new Map<string, number>(); // `${page}:${mark}` → note id
  const content = kept.map((lines) => {
    const out: Line[] = [];
    const byLeaf = new Map<number, Line[]>();
    for (const l of lines) (byLeaf.get(l.leaf) ?? byLeaf.set(l.leaf, []).get(l.leaf)!).push(l);
    /* Leaves of one column's foot: consecutive small leaves at the end of the page. */
    const order = [...byLeaf.keys()];
    const small = (l: Line) => l.figure === undefined && l.size > 0 && l.size <= body * 0.88 && l.top > pageOf.get(l.page)!.height * 0.45;
    let footFrom = order.length;
    while (footFrom > 0 && byLeaf.get(order[footFrom - 1])!.every(small)) footFrom--;
    const footLines = order.slice(footFrom).flatMap((k) => byLeaf.get(k)!);
    /* The foot of the last text leaf may hold small lines too. */
    const lastBody = order[footFrom - 1] !== undefined ? byLeaf.get(order[footFrom - 1])! : [];
    let cutAt = lastBody.length;
    while (cutAt > 0 && small(lastBody[cutAt - 1])) cutAt--;
    const opens = (l: Line) => NOTE_START.test(l.text) || (l.refs.length > 0 && l.text.startsWith("\u0001"));
    const candidates = [...lastBody.slice(cutAt), ...footLines];
    const isFoot = candidates.length > 0 && opens(candidates[0]);
    for (const k of order.slice(0, footFrom)) {
      const leafLines = byLeaf.get(k)!;
      out.push(...(isFoot && leafLines === lastBody ? leafLines.slice(0, cutAt) : leafLines));
    }
    if (!isFoot) { out.push(...candidates.filter((l) => !lastBody.includes(l))); return out; }
    let current: { id: number; text: string; page: number } | null = null;
    for (const l of candidates) {
      if (opens(l)) {
        const mark = l.text.startsWith("\u0001") ? l.refs[0] : plain(NOTE_START.exec(l.text)![1]);
        const text = l.text.startsWith("\u0001") ? l.text.replace(/^\u0001.*?\u0002\s*/, "") : l.text.replace(NOTE_START, "");
        current = { id: nextNote++, text, page: l.page };
        ids.set(`${l.page}:${mark}`, current.id);
        notes.push(current);
      } else if (current) current.text = join(current.text, l.text);
    }
    return out;
  });

  /* 4. Headings: type clearly bigger than the body's, in at most three sizes. */
  const lines = content.flat();
  const text = lines.filter((l) => l.figure === undefined);
  const big = text.filter((l) => l.size >= body * 1.2 && plain(l.text).length <= 150);
  const rounded = (l: Line) => Math.round(l.size * 2) / 2;
  /* Sizes used only on the first pages (a title page's) don't outrank the chapters': the biggest is the book's title, the rest its lines. */
  const front = Math.min(2, Math.floor(pages.length / 3));
  const onlyFront = new Set([...new Set(big.map(rounded))].filter((size) => big.every((l) => rounded(l) !== size || l.page <= (pages[front - 1]?.number ?? 0))));
  const headingSizes = [...new Set(big.map(rounded))].filter((size) => !onlyFront.has(size)).sort((a, b) => b - a);
  const titleSize = onlyFront.size ? Math.max(...onlyFront) : -1;
  const level = (l: Line) => {
    if (l.figure !== undefined || l.size < body * 1.2 || plain(l.text).length > 150) return 0;
    if (onlyFront.has(rounded(l))) return rounded(l) === titleSize ? 1 : 0;
    return Math.min(headingSizes.indexOf(rounded(l)) + 1, 3);
  };

  /* The usual distance from one line to the next, and the usual measure. */
  const steps: number[] = [];
  const widths: number[] = [];
  for (let j = 1; j < lines.length; j++) {
    const a = lines[j - 1], b = lines[j];
    if (a.leaf === b.leaf && !a.figure && !b.figure && !level(a) && !level(b) && Math.abs(a.size - body) < 1) steps.push(b.top - a.top);
  }
  for (const l of text) if (!level(l) && Math.abs(l.size - body) < 1) widths.push(l.right - l.left);
  const step = median(steps.filter((s) => s > 0), body * 1.3);
  /* The same, for each size of type: a page set larger has its own leading. */
  const stepsBySize = new Map<number, number[]>();
  for (let j = 1; j < lines.length; j++) {
    const a = lines[j - 1], b = lines[j];
    if (a.leaf === b.leaf && !a.figure && !b.figure && Math.abs(a.size - b.size) < 0.5 && b.top > a.top) (stepsBySize.get(Math.round(a.size)) ?? stepsBySize.set(Math.round(a.size), []).get(Math.round(a.size))!).push(b.top - a.top);
  }
  const stepCache = new Map<number, number>();
  const stepFor = (size: number) => {
    const k = Math.round(size);
    if (!stepCache.has(k)) { const xs = stepsBySize.get(k); stepCache.set(k, xs && xs.length >= 3 ? median(xs, step) : Math.abs(size - body) < 1 ? step : size * 1.3); }
    return stepCache.get(k)!;
  };
  widths.sort((a, b) => a - b);
  const measure = widths[Math.floor(widths.length * 0.8)] ?? 0;

  /* 5. Captions: the text right under (or over, or beside) a figure, set apart from the body. */
  const captionOf = new Map<number, Line[]>();
  const taken = new Set<Line>();
  for (const r of regions) {
    if (!lines.some((l) => l.figure === r.id)) continue;
    const near = lines.filter((l) => l.page === r.page && l.figure === undefined && !level(l) && !taken.has(l));
    const overlapsX = (l: Line) => Math.min(l.right, r.x + r.w) - Math.max(l.left, r.x) > Math.min(l.right - l.left, r.w) * 0.5;
    const styled = (l: Line) => CAPTION.test(plain(l.text)) || l.size < body * 0.95 || /^\*[^*].*\*$/.test(l.text.trim());
    const below = near.filter((l) => l.top >= r.y + r.h - 2 && overlapsX(l)).sort((a, b) => a.top - b.top);
    const above = near.filter((l) => l.bottom <= r.y + 2 && overlapsX(l)).sort((a, b) => b.top - a.top);
    const beside = near.filter((l) => l.left >= r.x + r.w - 2 && l.left - (r.x + r.w) < body * 4 && l.top >= r.y - 2 && l.bottom <= r.y + r.h + 2).sort((a, b) => a.top - b.top);
    let got: Line[] = [];
    if (below[0] && below[0].top - (r.y + r.h) < Math.max(step * 1.6, 16) && styled(below[0])) got = run(below);
    else if (above[0] && (r.y - above[0].bottom) < Math.max(step * 1.6, 16) && CAPTION.test(plain(above[0].text))) got = [above[0]];
    else if (beside[0] && styled(beside[0])) got = run(beside);
    if (got.length) { captionOf.set(r.id, got); for (const l of got) taken.add(l); }
    function run(ls: Line[]) {
      const out = [ls[0]];
      for (const l of ls.slice(1)) {
        const prev = out.at(-1)!;
        const sameColumn = Math.min(l.right, ls[0].right) - Math.max(l.left, ls[0].left) > Math.min(l.right - l.left, ls[0].right - ls[0].left) * 0.5;
        if (!sameColumn) continue;
        if (l.top - prev.top > step * 1.5 || Math.abs(l.size - ls[0].size) > 0.6) break;
        out.push(l);
      }
      return out;
    }
  }

  /* 6. Mathematics set on its own lines: kept as a picture of itself. */
  const mathy = (l: Line) => {
    if (l.figure !== undefined || level(l)) return false;
    const t = plain(l.text);
    const longWords = (t.match(/\p{L}{4,}/gu) ?? []).length;
    return count(t, MATH_CHARS) >= 2 && longWords <= 2 && t.length < 160;
  };
  const mathRegion = new Map<Line, number>();
  for (let j = 0; j < lines.length; j++) {
    if (!mathy(lines[j]) || mathRegion.has(lines[j])) continue;
    let a = j, b = j;
    const near = (x: Line, y: Line) => x.page === y.page && x.leaf === y.leaf && Math.abs(y.top - x.bottom) < step * 0.9;
    while (a > 0 && near(lines[a - 1], lines[a]) && (mathy(lines[a - 1]) || plain(lines[a - 1].text).length <= 4)) a--;
    while (b < lines.length - 1 && near(lines[b], lines[b + 1]) && (mathy(lines[b + 1]) || plain(lines[b + 1].text).length <= 4)) b++;
    const group = lines.slice(a, b + 1);
    const x = Math.min(...group.map((l) => l.left)) - 2, y = Math.min(...group.map((l) => l.top)) - 2;
    const id = regions.length + 1;
    regions.push({ id, page: group[0].page, x, y, w: Math.max(...group.map((l) => l.right)) - x + 4, h: Math.max(...group.map((l) => l.bottom)) - y + 4, raster: false, role: "math" });
    for (const l of group) mathRegion.set(l, id);
  }

  const leafMargin = new Map<number, number>();
  for (const x of lines) if (x.figure === undefined && !level(x)) leafMargin.set(x.leaf, Math.min(leafMargin.get(x.leaf) ?? Infinity, x.left));

  /* 7. Blocks, in reading order. */
  const blocks: Block[] = [];
  const pendingNotes: { id: number; text: string; page: number }[] = [];
  const pendingFigures: Block[] = [];
  const refsDone = new Set<number>();
  let para: { text: string; page: number; size: number } | null = null;
  let heading: { level: number; text: string; page: number } | null = null;
  let verse: { lines: VerseLine[]; page: number; margin: number } | null = null;
  let table: { rows: string[][]; cols: number[]; page: number } | null = null;
  let lastMath = 0;

  const flushNotes = () => {
    for (let k = 0; k < pendingNotes.length;) {
      if (refsDone.has(pendingNotes[k].id)) { const n = pendingNotes.splice(k, 1)[0]; blocks.push({ kind: "note", id: n.id, text: n.text, page: n.page }); } else k++;
    }
  };
  const flushPara = () => {
    if (para) blocks.push({ kind: "p", text: para.text, page: para.page });
    para = null;
    blocks.push(...pendingFigures.splice(0));
    flushNotes();
  };
  const flushHeading = () => {
    /* A heading set in bold or italic throughout is just a heading. */
    if (heading) blocks.push({ kind: "h", level: heading.level, text: heading.text.replace(/^(\*{1,2})(?!\*)(.+?)\1$/, "$2"), page: heading.page });
    heading = null;
  };
  const flushVerse = () => { if (verse) blocks.push({ kind: "verse", lines: verse.lines, page: verse.page }); verse = null; };
  const flushTable = () => {
    if (!table) return;
    const prev = blocks.at(-1);
    /* A table carried over a page: the same columns, its header row not repeated. */
    if (prev?.kind === "table" && prev.rows[0]?.length === table.rows[0]?.length) {
      const rows = table.rows[0].join("|") === prev.rows[0].join("|") ? table.rows.slice(1) : table.rows;
      prev.rows.push(...rows);
    } else blocks.push({ kind: "table", rows: table.rows, page: table.page });
    table = null;
  };
  const flushAll = () => { flushHeading(); flushVerse(); flushTable(); flushPara(); };
  const marks = (l: Line) => l.text.replace(/\u0001(.*?)\u0002/g, (_m, mark: string) => {
    const id = ids.get(`${l.page}:${mark}`);
    if (!id) return /^\d+$/.test(mark) ? [...mark].map((c) => SUPER[c]).join("") : mark;
    refsDone.add(id);
    return `[^${id}]`;
  });
  const terminal = (s: string) => /[.!?…:;"”’»)\]。！？]$/.test(plain(s));

  /*
   * Which lines are verse: three or more lines in a row broken on purpose.
   * A break is on purpose when the next line's first word would have fitted
   * on the line before (wrapped prose never does that, whether justified or
   * ragged), unless it's simply a new indented paragraph after a full stop.
   */
  const verseLines = new Set<Line>();
  {
    const plainText = (l: Line) => plain(l.text.replace(/\u0001.*?\u0002/g, ""));
    const usualIndent = median(lines.filter((l) => l.figure === undefined && !level(l)).map((l) => l.left - (leafMargin.get(l.leaf) ?? l.left)).filter((d) => d > body * 0.5 && d < body * 6), body * 1.5);
    const prose = (l: Line) => l.figure === undefined && !level(l) && !mathRegion.has(l) && !taken.has(l) && l.segs.length <= 1 && Math.abs(l.size - body) < 1.5;
    const onPurpose = (a: Line, b: Line) => {
      if (!prose(a) || !prose(b) || a.page !== b.page || Math.abs(a.left - b.left) > measure * 0.6 || b.top - a.top > step * 1.45 || b.top <= a.top) return false;
      const t = plainText(a);
      const charW = (a.right - a.left) / Math.max(1, t.length);
      const first = plainText(b).split(/\s+/)[0] ?? "";
      /* A word hyphenated at the end of a nearly full line was wrapped, even if its second half would fit. */
      const broken = /[\p{L}][-\u00ad\u2010]$/u.test(t) && a.right - a.left > a.frame * 0.6;
      const fits = !broken && (a.right - a.left) + (first.length + 1) * charW < a.frame * 0.97;
      const newParagraph = terminal(a.text) && Math.abs((b.left - (leafMargin.get(b.leaf) ?? b.left)) - usualIndent) < body * 0.6;
      return fits && !newParagraph;
    };
    let run: Line[] = [];
    /* Ragged prose fills most of its lines; verse, as a run, doesn't. */
    const judge = () => { if (run.length >= 3 && median(run.map((l) => (l.right - l.left) / l.frame), 1) < 0.85) for (const l of run) verseLines.add(l); run = []; };
    for (let j = 0; j < lines.length; j++) {
      const l = lines[j], next = lines[j + 1];
      if (next && onPurpose(l, next)) { if (!run.length) run.push(l); run.push(next); }
      else judge();
    }
    judge();
  }

  /* Which lines are table rows: three or more lines in a row with two or more cells whose starts line up. */
  const tableLines = new Set<Line>();
  {
    let runStart = 0;
    const cells = (l: Line) => l.figure === undefined && !level(l) && !mathRegion.has(l) && l.segs.length >= 2;
    for (let j = 0; j <= lines.length; j++) {
      if (j < lines.length && cells(lines[j]) && (j === runStart || lines[j].page === lines[j - 1].page)) continue;
      const group = lines.slice(runStart, j);
      if (group.length >= 3) {
        const starts = group.flatMap((l) => l.segs.map((s) => Math.round(s.left / 6)));
        const common = [...new Set(starts)].filter((x) => starts.filter((y) => Math.abs(y - x) <= 1).length >= group.length * 0.6);
        if (common.length >= 2) for (const l of group) tableLines.add(l);
      }
      runStart = j + 1;
    }
  }

  /* Each leaf's text margin and far edge, for indents and short lines. */
  const leafEdges = new Map<number, { margin: number; edge: number; count: number }>();
  for (const x of lines) {
    if (x.figure !== undefined || level(x)) continue;
    const e = leafEdges.get(x.leaf) ?? { margin: x.rtl ? -Infinity : Infinity, edge: x.rtl ? Infinity : -Infinity, count: 0 };
    if (x.rtl) { e.margin = Math.max(e.margin, x.right); e.edge = Math.min(e.edge, x.left); } else { e.margin = Math.min(e.margin, x.left); e.edge = Math.max(e.edge, x.right); }
    e.count++;
    leafEdges.set(x.leaf, e);
  }

  const notesOf = new Map<number, { id: number; text: string; page: number }[]>();
  for (const n of notes) (notesOf.get(n.page) ?? notesOf.set(n.page, []).get(n.page)!).push({ ...n, text: n.text.replace(/\u0001(.*?)\u0002/g, "$1") });
  let notePage = lines[0]?.page ?? 0;
  const queueNotes = (upTo: number) => {
    for (const [page, ns] of notesOf) if (page < upTo) { pendingNotes.push(...ns); notesOf.delete(page); }
  };

  let prevLine: Line | null = null;
  for (const l of lines) {
    if (l.page !== notePage) { queueNotes(l.page); notePage = l.page; }
    if (taken.has(l)) continue; // a caption, written with its figure
    if (l.figure !== undefined) {
      const r = regions[l.figure - 1];
      const cap = captionOf.get(l.figure);
      const fig: Block = { kind: "figure", image: l.figure, caption: cap ? cap.map(marks).reduce((a, t) => join(a, t), "") : null, page: l.page, role: r.role, ...(alts.get(l.figure) ? { alt: alts.get(l.figure) } : {}) };
      flushHeading(); flushVerse(); flushTable();
      /* A figure inside a paragraph waits for the paragraph to end. */
      if (para) pendingFigures.push(fig); else { blocks.push(fig); flushNotes(); }
      prevLine = l;
      continue;
    }
    const m = mathRegion.get(l);
    if (m !== undefined) {
      if (m !== lastMath) {
        flushHeading(); flushVerse(); flushTable();
        const fig: Block = { kind: "figure", image: m, caption: null, page: l.page, role: "math", alt: plain(lines.filter((x) => mathRegion.get(x) === m).map((x) => x.text.replace(/\u0001(.*?)\u0002/g, "$1")).join(" ")) };
        if (para) pendingFigures.push(fig); else blocks.push(fig);
        lastMath = m;
      }
      prevLine = l;
      continue;
    }
    const t = marks(l);
    const lv = level(l);
    if (lv) {
      flushVerse(); flushTable(); flushPara();
      const h = heading as { level: number; text: string; page: number } | null;
      if (h && h.level === lv && prevLine && prevLine.leaf === l.leaf && l.top - prevLine.bottom < l.size * 1.2) h.text = join(h.text, t);
      else { flushHeading(); heading = { level: lv, text: t, page: l.page }; }
      prevLine = l;
      continue;
    }
    flushHeading();
    if (verseLines.has(l)) {
      flushTable(); flushPara();
      const gap = prevLine && verseLines.has(prevLine) && prevLine.page === l.page ? l.top - prevLine.top : 0;
      if (!verse || gap > step * 1.45) { flushVerse(); verse = { lines: [], page: l.page, margin: l.left }; }
      verse.margin = Math.min(verse.margin, l.left);
      verse.lines.push({ indent: Math.max(0, l.left), text: t });
      prevLine = l;
      continue;
    }
    flushVerse();
    if (tableLines.has(l)) {
      flushPara();
      if (!table) table = { rows: [], cols: [], page: l.page };
      table.rows.push(l.segs.map((s) => s.text.trim()));
      prevLine = l;
      continue;
    }
    flushTable();
    /* Prose. */
    const sameLeaf = prevLine && prevLine.leaf === l.leaf && prevLine.figure === undefined;
    const { margin, edge, count: leafCount } = leafEdges.get(l.leaf)!;
    const indent = l.rtl ? margin - l.right : l.left - margin;
    const p = para as { text: string; page: number; size: number } | null;
    const startsNew = !p
      || Math.abs(l.size - p.size) > 1.5
      || (sameLeaf && l.top - prevLine!.top > stepFor(l.size) * 1.45)
      || (indent > body * 0.8 && indent < body * 6 && leafCount > 1)
      || (sameLeaf && !level(prevLine!) && (l.rtl ? prevLine!.left - edge : edge - prevLine!.right) > body * 4 && terminal(prevLine!.text))
      || (!sameLeaf && terminal(p.text) && /^[\p{Lu}\p{Lo}"“‘«(¿¡]/u.test(plain(t)));
    if (startsNew) { flushPara(); para = { text: t, page: l.page, size: l.size }; } else p!.text = join(p!.text, t);
    prevLine = l;
  }
  queueNotes(Infinity);
  flushAll();
  /* Notes whose marks weren't found: kept, after everything. */
  for (const n of pendingNotes.splice(0)) blocks.push({ kind: "note", id: n.id, text: n.text, page: n.page });

  /* Verse indents in steps of half an em from the stanza's margin. */
  for (const b of blocks) if (b.kind === "verse") {
    const margin = Math.min(...b.lines.map((l) => l.indent));
    for (const l of b.lines) l.indent = Math.min(12, Math.round((l.indent - margin) / (body * 0.5)));
  }
  const used = new Set(blocks.flatMap((b) => b.kind === "figure" ? [b.image] : "text" in b ? [...b.text.matchAll(/\{\{img:(\d+)\}\}/g)].map((m) => Number(m[1])) : []));
  const allWords = blocks.reduce((n, b) => n + words(b.kind === "verse" ? b.lines.map((l) => l.text).join(" ") : b.kind === "table" ? b.rows.flat().join(" ") : b.kind === "figure" ? b.caption ?? "" : b.text).length, 0);
  return {
    blocks, regions: regions.filter((r) => used.has(r.id)), words: allWords,
    notes: notes.length, headings: blocks.filter((b) => b.kind === "h").length,
    figures: blocks.filter((b) => b.kind === "figure" && b.role !== "math").length,
    verse: blocks.filter((b) => b.kind === "verse").length, tables: blocks.filter((b) => b.kind === "table").length,
  };
}

export type { Box };
