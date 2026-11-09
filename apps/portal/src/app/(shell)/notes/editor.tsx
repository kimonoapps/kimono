"use client";

import { useEffect, useRef } from "react";
import { Annotation, ChangeSet, Compartment, EditorState, Prec, StateEffect, StateField, type ChangeSpec, type Range } from "@codemirror/state";
import { collab, getSyncedVersion, receiveUpdates, sendableUpdates } from "@codemirror/collab";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

/*
 * 筆 A note's body: Markdown underneath, read as a document. Markup shows
 * only while you're in it: bold, italic, code and link markers come back when
 * the caret touches that span; heading, quote and rule markers when it is on
 * that line; code fences while it is in the block. Bullets are dots (filled,
 * then open rings a level down), a task's [ ] is an ink ring that ticks, and
 * numbers stay. Shortcuts and typed markers make the rest (docs/kimono-notes.md).
 */

/* A change the page made (theirs, loaded after a clash), not one typed here. */
const fromOutside = Annotation.define<boolean>();

type Node = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

const hidden = Decoration.replace({});
const mark = Decoration.mark({ class: "nt-md-mark" });
const number = Decoration.mark({ class: "nt-md-num" });
const marks: Record<string, Decoration> = {
  StrongEmphasis: Decoration.mark({ class: "nt-md-strong" }),
  Emphasis: Decoration.mark({ class: "nt-md-em" }),
  Strikethrough: Decoration.mark({ class: "nt-md-strike" }),
  InlineCode: Decoration.mark({ class: "nt-md-code" }),
  Link: Decoration.mark({ class: "nt-md-link" }),
  Autolink: Decoration.mark({ class: "nt-md-link" }),
  Image: Decoration.mark({ class: "nt-md-picture" }),
  HTMLTag: Decoration.mark({ class: "nt-md-html" }),
  HTMLBlock: Decoration.mark({ class: "nt-md-html" }),
};
const lines: Record<string, string> = {
  ATXHeading1: "nt-md-h1", ATXHeading2: "nt-md-h2", ATXHeading3: "nt-md-h3", ATXHeading4: "nt-md-h4", ATXHeading5: "nt-md-h4", ATXHeading6: "nt-md-h4",
  SetextHeading1: "nt-md-h1", SetextHeading2: "nt-md-h2", Blockquote: "nt-md-quote", FencedCode: "nt-md-block", CodeBlock: "nt-md-block",
};
const spans = new Set(["StrongEmphasis", "Emphasis", "InlineCode", "Strikethrough"]);

/* When a tick was last made by hand: only that one draws its stroke, not every tick scrolled into view. */
let tickedAt = 0;
const taskLine = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;

class Tick extends WidgetType {
  constructor(readonly done: boolean) { super(); }
  eq(other: Tick) { return other.done === this.done; }
  toDOM(view: EditorView) {
    const box = document.createElement("button");
    box.type = "button";
    box.className = `nt-tick${this.done ? " is-done" : ""}${this.done && performance.now() - tickedAt < 400 ? " is-fresh" : ""}`;
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.done));
    box.setAttribute("aria-label", this.done ? "Done" : "To do");
    box.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring" cx="12" cy="12" r="9"/><path class="tick" d="M7.5 12.5l3 3 6-6.5"/></svg>';
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("click", (event) => {
      event.preventDefault();
      if (view.state.readOnly) return;
      /* Which [ ] is read from the line's text as it is now, never from a position kept since. */
      const line = view.state.doc.lineAt(view.posAtDOM(box));
      const found = taskLine.exec(line.text);
      if (!found) return;
      const at = line.from + found[1].length + 1;
      tickedAt = performance.now();
      view.dispatch({ changes: { from: at, to: at + 1, insert: found[2] === " " ? "x" : " " }, userEvent: "input.tick" });
    });
    return box;
  }
  ignoreEvent() { return true; }
}

class Dot extends WidgetType {
  constructor(readonly open: boolean) { super(); }
  eq(other: Dot) { return other.open === this.open; }
  toDOM() { const dot = document.createElement("span"); dot.className = `nt-dot${this.open ? " is-open" : ""}`; dot.setAttribute("aria-hidden", "true"); return dot; }
}

class Rule extends WidgetType {
  eq() { return true; }
  toDOM() { const rule = document.createElement("span"); rule.className = "nt-rule"; rule.setAttribute("aria-hidden", "true"); return rule; }
}

function decorate(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
  const found: Range<Decoration>[] = [];
  const solid: Range<Decoration>[] = [];
  const { doc, selection } = view.state;
  const focused = view.hasFocus;
  const touches = (from: number, to: number) => focused && selection.ranges.some((r) => r.from <= to && r.to >= from);
  const onLine = (pos: number) => { const line = doc.lineAt(pos); return touches(line.from, line.to); };
  const lineClass = (from: number, to: number, cls: string) => {
    for (let line = doc.lineAt(from); ; line = doc.line(line.number + 1)) {
      found.push(Decoration.line({ class: cls }).range(line.from));
      if (line.to >= to || line.number >= doc.lines) break;
    }
  };
  /* A marker and the one space after it. */
  const withSpace = (to: number) => doc.sliceString(to, to + 1) === " " ? to + 1 : to;
  const showOrHide = (from: number, to: number, show: boolean) => { if (to > from) found.push((show ? mark : hidden).range(from, to)); };
  const depthOf = (node: Node) => { let depth = -1; for (let up: Node | null = node; up; up = up.parent) if (up.name === "BulletList" || up.name === "OrderedList") depth++; return depth; };
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter: (ref) => {
        const name = ref.name, node = ref.node, parent = node.parent;
        if (lines[name]) lineClass(ref.from, ref.to, lines[name]);
        if (marks[name] && ref.to > ref.from) found.push(marks[name].range(ref.from, ref.to));
        switch (name) {
          case "HeaderMark": {
            const shown = onLine(ref.from);
            /* An opening mark takes its space with it; a closing one, the space before it. */
            const opening = ref.from === doc.lineAt(ref.from).from || /^\s*$/.test(doc.sliceString(doc.lineAt(ref.from).from, ref.from));
            if (opening) showOrHide(ref.from, withSpace(ref.to), shown);
            else showOrHide(doc.sliceString(ref.from - 1, ref.from) === " " ? ref.from - 1 : ref.from, ref.to, shown);
            break;
          }
          case "QuoteMark": showOrHide(ref.from, withSpace(ref.to), onLine(ref.from)); break;
          case "HorizontalRule":
            if (onLine(ref.from)) found.push(mark.range(ref.from, ref.to));
            else found.push(Decoration.replace({ widget: new Rule() }).range(ref.from, ref.to));
            break;
          case "CodeMark": case "CodeInfo":
            if (parent && (parent.name === "FencedCode" || parent.name === "InlineCode")) showOrHide(ref.from, ref.to, touches(parent.from, parent.to));
            else showOrHide(ref.from, ref.to, true);
            break;
          case "EmphasisMark": case "StrikethroughMark":
            showOrHide(ref.from, ref.to, !parent || !spans.has(parent.name) || touches(parent.from, parent.to));
            break;
          case "Link": {
            /* Only a link with an address hides its markup: [words] alone stays as typed. */
            const url = node.getChild("URL");
            const parts = node.getChildren("LinkMark");
            if (url && parts.length >= 2) {
              if (touches(ref.from, ref.to)) { for (const part of parts) found.push(mark.range(part.from, part.to)); found.push(Decoration.mark({ class: "nt-md-url" }).range(url.from, url.to)); }
              else { found.push(hidden.range(parts[0].from, parts[0].to)); found.push(hidden.range(parts[1].from, ref.to)); }
            } else for (const part of parts) found.push(mark.range(part.from, part.to));
            return false;
          }
          case "Image": for (const part of node.getChildren("LinkMark")) found.push(mark.range(part.from, part.to)); break;
          case "Autolink": for (const part of node.getChildren("LinkMark")) showOrHide(part.from, part.to, touches(ref.from, ref.to)); return false;
          case "ListItem": {
            const marker = node.getChild("ListMark");
            if (!marker) break;
            const task = node.getChild("Task")?.getChild("TaskMarker");
            /* Nesting shows as 1.6em a level, not as the spaces typed. */
            const line = doc.lineAt(marker.from);
            const depth = depthOf(node);
            if (marker.from > line.from && /^\s+$/.test(doc.sliceString(line.from, marker.from))) {
              const indent = hidden.range(line.from, marker.from);
              found.push(indent); solid.push(indent);
            }
            if (depth > 0) found.push(Decoration.line({ attributes: { style: `padding-left: ${depth * 1.6}em` } }).range(line.from));
            if (task) {
              const done = /x/i.test(doc.sliceString(task.from, task.to));
              /* The ring stands for "- [ ] ": the caret steps over it in one. */
              const range = Decoration.replace({ widget: new Tick(done) }).range(marker.from, withSpace(task.to));
              found.push(range); solid.push(range);
              if (done) lineClass(task.from, node.getChild("Task")!.to, "nt-md-done");
            } else if (parent?.name === "BulletList") {
              /* The dot stands for "- ", as the ring does for "- [ ] ". */
              const range = Decoration.replace({ widget: new Dot(depth % 2 === 1) }).range(marker.from, withSpace(marker.to));
              found.push(range); solid.push(range);
            } else found.push(number.range(marker.from, marker.to));
            break;
          }
          case "TaskMarker": return false;
        }
      },
    });
  }
  return { decorations: Decoration.set(found, true), atomic: Decoration.set(solid, true) };
}

const live = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  atomic: DecorationSet;
  constructor(view: EditorView) { ({ decorations: this.decorations, atomic: this.atomic } = decorate(view)); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      ({ decorations: this.decorations, atomic: this.atomic } = decorate(update.view));
    }
  }
}, { decorations: (plugin) => plugin.decorations });
const atomic = EditorView.atomicRanges.of((view) => view.plugin(live)?.atomic ?? Decoration.none);

/* ── tables: always drawn as tables, and written in cell by cell ── */

const focusMoved = StateEffect.define<boolean>();
const hasFocus = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => { for (const e of tr.effects) if (e.is(focusMoved)) return e.value; return value; },
});
const followFocus = EditorView.focusChangeEffect.of((_state, focusing) => focusMoved.of(focusing));

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** A cell's Markdown, enough of it: code, bold, italic, struck, links. */
function cellHtml(raw: string) {
  const codes: string[] = [];
  let html = escapeHtml(raw.replace(/\\\|/g, "|")).replace(/`([^`]+)`/g, (_, code: string) => { codes.push(code); return `\u0000${codes.length - 1}\u0000`; });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>").replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, words: string, url: string) => `<a href="${url}" target="_blank" rel="noreferrer">${words}</a>`);
  return html.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code class="nt-md-code">${codes[Number(i)]}</code>`);
}
/** "| a | b |" → its cells, each with where it starts in the line. */
function cellsOf(line: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let start = 0, i = 0;
  const lead = /^\s*\|/.exec(line);
  if (lead) start = i = lead[0].length;
  for (; i <= line.length; i++) {
    if (i < line.length && !(line[i] === "|" && line[i - 1] !== "\\")) continue;
    const text = line.slice(start, i);
    if (i < line.length || text.trim()) out.push({ text: text.trim(), at: start + (text.length - text.trimStart().length) });
    start = i + 1;
  }
  return out;
}

/*
 * A table is always drawn as one, and written in directly: each cell is
 * typed into where it stands, and what is typed goes back into the note's
 * Markdown underneath, which never shows. Tab and Enter move between cells
 * (past the last, a new row); the bar over it adds and takes away rows and
 * columns. A column's width is the dashes under its heading, ten pixels
 * each: dragging its edge writes more or fewer. With every column at three,
 * the widths follow what's in them.
 */
type TableModel = { head: string[]; dashes: number[]; align: string[]; rows: string[][] };
const pxPerDash = 10;

function parseTable(text: string): TableModel {
  const lines = text.split("\n");
  const head = cellsOf(lines[0] ?? "").map((c) => c.text);
  const rule = cellsOf(lines[1] ?? "").map((c) => c.text);
  const width = Math.max(head.length, rule.length, 1);
  const pad = (cells: string[]) => Array.from({ length: width }, (_, i) => cells[i] ?? "");
  return {
    head: pad(head),
    dashes: Array.from({ length: width }, (_, i) => Math.max(3, (rule[i] ?? "").replace(/[^-]/g, "").length)),
    align: Array.from({ length: width }, (_, i) => { const r = rule[i] ?? ""; return /^:-+:$/.test(r) ? "center" : /-:$/.test(r) ? "right" : /^:-/.test(r) ? "left" : ""; }),
    rows: lines.slice(2).map((line) => pad(cellsOf(line).map((c) => c.text))),
  };
}
const cellText = (text: string) => text.replace(/\n/g, " ").replace(/(^|[^\\])\|/g, "$1\\|").trim();
function writeTable(t: TableModel): string {
  const row = (cells: string[]) => `| ${cells.map((c) => cellText(c) || " ").join(" | ")} |`;
  const rule = `| ${t.dashes.map((d, i) => { const dash = "-".repeat(Math.max(3, d)); return t.align[i] === "center" ? `:${dash.slice(2)}:` : t.align[i] === "right" ? `${dash.slice(1)}:` : t.align[i] === "left" ? `:${dash.slice(1)}` : dash; }).join(" | ")} |`;
  return [row(t.head), rule, ...t.rows.map(row)].join("\n");
}
const sized = (t: TableModel) => t.dashes.some((d) => d > 3);

/* The table this widget stands for, found again in the note as it is now. */
function tableAt(view: EditorView, dom: HTMLElement): { from: number; to: number; model: TableModel } | null {
  let pos: number;
  try { pos = view.posAtDOM(dom); } catch { return null; }
  let found: { from: number; to: number } | null = null;
  syntaxTree(view.state).iterate({ from: pos, to: pos + 1, enter: (ref) => { if (ref.name === "Table" && !found) { found = { from: view.state.doc.lineAt(ref.from).from, to: view.state.doc.lineAt(ref.to).to }; } return !found; } });
  if (!found) return null;
  const { from, to } = found as { from: number; to: number };
  return { from, to, model: parseTable(view.state.doc.sliceString(from, to)) };
}

/* Where to put the caret once a table is drawn again: its cell, and whether to pick its words. */
let focusNext: { from: number; r: number; c: number; pick: boolean } | null = null;

/*
 * Bold, italic, code and links in a cell: the same marks as in the rest of
 * the note, put around what's picked (or the word being typed), or taken off
 * when they're already there. Shown as typed while you're in the cell.
 */
const cellMarks: Partial<Record<Action, [string, string]>> = { bold: ["**", "**"], italic: ["*", "*"], code: ["`", "`"] };
function cellRange(cell: HTMLElement): [number, number] | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !cell.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(cell);
  pre.setEnd(r.startContainer, r.startOffset);
  const from = pre.toString().length;
  return [from, from + r.toString().length];
}
function setCellText(cell: HTMLElement, text: string, from: number, to: number) {
  const grip = cell.querySelector(".nt-table-grip");
  cell.textContent = text;
  if (grip) cell.append(grip);
  const node = cell.firstChild;
  if (node && node.nodeType === Node.TEXT_NODE) {
    const range = document.createRange();
    range.setStart(node, Math.min(from, text.length));
    range.setEnd(node, Math.min(to, text.length));
    const sel = window.getSelection();
    sel?.removeAllRanges(); sel?.addRange(range);
  }
  cell.dispatchEvent(new Event("input", { bubbles: true }));
}
/** Formats what's picked in [cell]; false for what a cell can't hold (headings, lists, tables). */
function formatCell(cell: HTMLElement, action: Action): boolean {
  if (action !== "link" && !cellMarks[action]) return action === "heading" || action === "bullets" || action === "checklist" || action === "numbered" || action === "table";
  const at = cellRange(cell);
  if (!at) return true;
  const text = (cell.textContent ?? "");
  let [from, to] = at;
  /* Nothing picked: the word the caret is in. */
  if (from === to) {
    while (from > 0 && /[\p{L}\p{N}_'-]/u.test(text[from - 1])) from--;
    while (to < text.length && /[\p{L}\p{N}_'-]/u.test(text[to])) to++;
  }
  if (action === "link") {
    const words = text.slice(from, to) || "link";
    const next = `${text.slice(0, from)}[${words}](https://)${text.slice(to)}`;
    const url = from + words.length + 3;
    setCellText(cell, next, url, url + "https://".length);
    return true;
  }
  const [open, close] = cellMarks[action]!;
  if (text.slice(from - open.length, from) === open && text.slice(to, to + close.length) === close) {
    setCellText(cell, text.slice(0, from - open.length) + text.slice(from, to) + text.slice(to + close.length), from - open.length, to - open.length);
  } else {
    setCellText(cell, text.slice(0, from) + open + text.slice(from, to) + close + text.slice(to), from + open.length, to + open.length);
  }
  return true;
}
const focusedCell = (view: EditorView) => { const el = document.activeElement; return el instanceof HTMLElement && el.dataset.r !== undefined && view.dom.contains(el) ? el : null; };

/* Whether the caret sits at the very start of a cell, nothing picked. */
function atCellStart(cell: HTMLElement) {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.rangeCount) return false;
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return range.toString().length === 0;
}

function placeCaret(cell: HTMLElement, pick: boolean) {
  if (!cell.isConnected) return;
  cell.focus();
  const range = document.createRange();
  range.selectNodeContents(cell);
  if (!pick) range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges(); sel?.addRange(range);
}

class TableView extends WidgetType {
  constructor(readonly source: string, readonly from: number) { super(); }
  eq(other: TableView) { return other.source === this.source; }
  /* Same shape: the cells being typed in stay as they are, the rest follow. */
  updateDOM(dom: HTMLElement, view: EditorView) {
    const t = parseTable(this.source);
    const cells = [...dom.querySelectorAll<HTMLElement>("[data-r]")];
    if (cells.length !== (t.rows.length + 1) * t.head.length) return false;
    for (const cell of cells) {
      const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
      const raw = r < 0 ? t.head[c] : t.rows[r][c];
      if (document.activeElement !== cell && cell.dataset.raw !== raw) fill(cell, raw);
    }
    layout(dom, t);
    void view;
    return true;
  }
  toDOM(view: EditorView) {
    const t = parseTable(this.source);
    const editable = !view.state.readOnly;
    const wrap = document.createElement("div");
    wrap.className = "nt-table";
    const table = document.createElement("table");
    table.append(document.createElement("colgroup"));
    const make = (tag: "th" | "td", r: number, c: number, raw: string) => {
      const cell = document.createElement(tag);
      cell.dataset.r = String(r); cell.dataset.c = String(c);
      if (editable) { cell.contentEditable = "true"; cell.spellcheck = true; }
      cell.dataset.placeholder = r < 0 ? "Heading" : "";
      fill(cell, raw);
      if (t.align[c]) cell.style.textAlign = t.align[c];
      return cell;
    };
    const headRow = document.createElement("tr");
    t.head.forEach((raw, c) => {
      const th = make("th", -1, c, raw);
      if (editable) { const grip = document.createElement("span"); grip.className = "nt-table-grip"; grip.contentEditable = "false"; grip.dataset.c = String(c); th.append(grip); }
      headRow.append(th);
    });
    table.createTHead().append(headRow);
    const body = table.createTBody();
    t.rows.forEach((row, r) => { const tr = document.createElement("tr"); row.forEach((raw, c) => tr.append(make("td", r, c, raw))); body.append(tr); });
    const scroller = document.createElement("div");
    scroller.className = "nt-table-scroll";
    scroller.append(table);
    wrap.append(scroller);
    if (editable) wrap.append(tableBar(view, wrap));
    layout(wrap, t);
    if (editable) wire(view, wrap);
    if (focusNext && focusNext.from === this.from) {
      const want = focusNext; focusNext = null;
      requestAnimationFrame(() => { const cell = wrap.querySelector<HTMLElement>(`[data-r="${want.r}"][data-c="${want.c}"]`); if (cell) placeCaret(cell, want.pick); });
    }
    return wrap;
  }
  ignoreEvent() { return true; }
}

/* A cell shows its words; while it's being typed in, its Markdown. */
function fill(cell: HTMLElement, raw: string) {
  cell.dataset.raw = raw;
  const grip = cell.querySelector(".nt-table-grip");
  if (document.activeElement === cell) cell.textContent = raw.replace(/\\\|/g, "|");
  else cell.innerHTML = cellHtml(raw);
  if (grip) cell.append(grip);
  cell.classList.toggle("is-empty", !raw);
}

function layout(wrap: HTMLElement, t: TableModel) {
  const table = wrap.querySelector("table")!;
  const group = table.querySelector("colgroup")!;
  group.replaceChildren(...t.dashes.map((d) => { const col = document.createElement("col"); if (sized(t)) col.style.width = `${d * pxPerDash}px`; return col; }));
  table.classList.toggle("is-sized", sized(t));
}

/* Changes the table in the note, and says where the caret goes after. */
function change(view: EditorView, wrap: HTMLElement, edit: (t: TableModel) => void, after?: { r: number; c: number; pick?: boolean }) {
  const found = tableAt(view, wrap);
  if (!found) return;
  edit(found.model);
  const text = writeTable(found.model);
  if (after) focusNext = { from: found.from, r: after.r, c: after.c, pick: Boolean(after.pick) };
  view.dispatch({ changes: { from: found.from, to: found.to, insert: text }, userEvent: "input.table" });
  /* The table is drawn again as the change lands: the caret goes into it now, before the next key. */
  if (after) focusCellNow(view, found.from);
}

function focusCellNow(view: EditorView, from: number) {
  const want = focusNext;
  if (!want || want.from !== from) return;
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>(".nt-table")) {
    if (tableAt(view, el)?.from !== from) continue;
    const cell = el.querySelector<HTMLElement>(`[data-r="${want.r}"][data-c="${want.c}"]`);
    if (cell) { focusNext = null; placeCaret(cell, want.pick); }
    return;
  }
}

/* Out of a table, below it, with a blank line between: a line straight under a table would be one of its rows. */
function leaveBelow(view: EditorView, to: number) {
  const doc = view.state.doc;
  const next = doc.sliceString(to, to + 2);
  if (next === "\n\n") view.dispatch({ selection: { anchor: to + 2 } });
  else if (next.startsWith("\n")) view.dispatch({ changes: { from: to + 1, insert: "\n" }, selection: { anchor: to + 2 } });
  else view.dispatch({ changes: { from: to, insert: "\n\n" }, selection: { anchor: to + 2 } });
  view.focus();
}

function wire(view: EditorView, wrap: HTMLElement) {
  const at = (el: EventTarget | null) => { const cell = (el as Element | null)?.closest?.<HTMLElement>("[data-r]"); return cell ? { cell, r: Number(cell.dataset.r), c: Number(cell.dataset.c) } : null; };
  wrap.addEventListener("focusin", (event) => { const hit = at(event.target); if (hit) { hit.cell.textContent = (hit.cell.dataset.raw ?? "").replace(/\\\|/g, "|"); wrap.classList.add("is-writing"); } });
  wrap.addEventListener("focusout", (event) => { const hit = at(event.target); if (hit) { fill(hit.cell, hit.cell.dataset.raw ?? ""); wrap.classList.remove("is-writing"); } });
  wrap.addEventListener("input", (event) => {
    const hit = at(event.target);
    if (!hit) return;
    const raw = cellText(hit.cell.textContent ?? "");
    hit.cell.dataset.raw = raw;
    hit.cell.classList.toggle("is-empty", !raw);
    change(view, wrap, (t) => { if (hit.r < 0) t.head[hit.c] = raw; else if (t.rows[hit.r]) t.rows[hit.r][hit.c] = raw; });
  });
  wrap.addEventListener("paste", (event) => {
    if (!at(event.target)) return;
    event.preventDefault();
    document.execCommand("insertText", false, (event.clipboardData?.getData("text/plain") ?? "").replace(/\s*\n\s*/g, " "));
  });
  wrap.addEventListener("keydown", (event) => {
    const hit = at(event.target);
    if (!hit) return;
    const found = tableAt(view, wrap);
    if (!found) return;
    const t = found.model, cols = t.head.length, last = t.rows.length - 1;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && !event.shiftKey) {
      const action = ({ b: "bold", i: "italic", e: "code", k: "link" } as Record<string, Action>)[event.key.toLowerCase()];
      if (action) { event.preventDefault(); formatCell(hit.cell, action); return; }
    }
    const go = (r: number, c: number, pick = true) => {
      const cell = wrap.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
      if (cell) { event.preventDefault(); placeCaret(cell, pick); }
    };
    if (event.key === "Tab") {
      event.preventDefault();
      const order = hit.r * cols + hit.c + (event.shiftKey ? -1 : 1);
      const r = Math.floor(order / cols), c = ((order % cols) + cols) % cols;
      if (order < -cols) return;
      if (r > last) change(view, wrap, (m) => { m.rows.push(Array(cols).fill("")); }, { r: last + 1, c: 0 });
      else go(r, c);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (hit.r >= last) change(view, wrap, (m) => { m.rows.splice(hit.r + 1, 0, Array(cols).fill("")); }, { r: hit.r + 1, c: hit.c });
      else go(hit.r + 1, hit.c, false);
    } else if (event.key === "ArrowDown" && hit.r < last) go(hit.r + 1, hit.c, false);
    else if (event.key === "ArrowUp" && hit.r > -1) go(hit.r - 1, hit.c, false);
    else if (event.key === "ArrowDown" || event.key === "Escape") {
      /* Out of the table, to the line after it. */
      event.preventDefault();
      leaveBelow(view, found.to);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      view.dispatch({ selection: { anchor: Math.max(0, found.from - 1) } });
      view.focus();
    } else if (event.key === "Backspace" && atCellStart(hit.cell)) {
      /* Backspace at a cell's start: an empty table goes, an empty row goes, else back a cell. */
      const empty = !(hit.cell.textContent ?? "").trim();
      const tableEmpty = t.head.every((x) => !x.trim()) && t.rows.every((row) => row.every((x) => !x.trim()));
      event.preventDefault();
      if (empty && tableEmpty) {
        const to = Math.min(found.to + 1, view.state.doc.length);
        view.dispatch({ changes: { from: found.from, to }, selection: { anchor: found.from }, userEvent: "delete.table" });
        view.focus();
      } else if (empty && hit.r >= 0 && t.rows.length > 1 && t.rows[hit.r].every((x) => !x.trim())) {
        change(view, wrap, (m) => { m.rows.splice(hit.r, 1); }, { r: hit.r - 1, c: cols - 1 });
      } else if (hit.c > 0) go(hit.r, hit.c - 1, false);
      else if (hit.r > -1) go(hit.r - 1, cols - 1, false);
    }
  });
  /* A column's edge, dragged: the dashes under its heading follow. */
  wrap.addEventListener("pointerdown", (event) => {
    const grip = (event.target as Element).closest<HTMLElement>(".nt-table-grip");
    if (!grip) return;
    event.preventDefault();
    const c = Number(grip.dataset.c);
    const table = wrap.querySelector("table")!;
    const cols = [...table.querySelectorAll<HTMLElement>("col")];
    const ths = [...table.querySelectorAll<HTMLElement>("th")];
    /* The first drag fixes every column at the width it has now. */
    const widths = ths.map((th) => th.getBoundingClientRect().width);
    cols.forEach((col, i) => { col.style.width = `${widths[i]}px`; });
    table.classList.add("is-sized");
    const x0 = event.clientX, w0 = widths[c];
    const move = (e: PointerEvent) => { widths[c] = Math.max(3 * pxPerDash, w0 + e.clientX - x0); cols[c].style.width = `${widths[c]}px`; };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      change(view, wrap, (m) => { m.dashes = widths.map((w) => Math.max(3, Math.round(w / pxPerDash))); if (m.dashes.every((d) => d <= 3)) m.dashes[c] = 4; });
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  });
}

/* Over the table while you're in it or near it: rows, columns, and taking it away. */
function tableBar(view: EditorView, wrap: HTMLElement) {
  const bar = document.createElement("div");
  bar.className = "nt-table-bar";
  bar.contentEditable = "false";
  const where = () => {
    const cell = wrap.querySelector<HTMLElement>("[data-r]:focus") ?? wrap.querySelector<HTMLElement>("[data-r].was-here");
    return cell ? { r: Number(cell.dataset.r), c: Number(cell.dataset.c) } : null;
  };
  wrap.addEventListener("focusin", (e) => { wrap.querySelectorAll(".was-here").forEach((x) => x.classList.remove("was-here")); (e.target as Element).closest?.("[data-r]")?.classList.add("was-here"); });
  const button = (label: string, icon: string, run: () => void, danger = false) => {
    const b = document.createElement("button");
    b.type = "button"; b.title = label; b.setAttribute("aria-label", label);
    b.className = danger ? "is-danger" : "";
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", run);
    bar.append(b);
  };
  const row = '<path d="M4 9h16M4 15h16M4 5h16v14H4z"/>', col = '<path d="M9 4v16M15 4v16M5 4h14v16H5z"/>';
  button("Add a row", `${row}<path d="M19 2v6M16 5h6" />`, () => { const w = where(); change(view, wrap, (m) => { const at = w ? Math.max(0, w.r + 1) : m.rows.length; m.rows.splice(at, 0, Array(m.head.length).fill("")); }, { r: w ? Math.max(0, w.r + 1) : -2, c: w?.c ?? 0 }); });
  button("Add a column", `${col}<path d="M19 2v6M16 5h6" />`, () => { const w = where(); change(view, wrap, (m) => { const at = w ? w.c + 1 : m.head.length; m.head.splice(at, 0, ""); m.dashes.splice(at, 0, sized(m) ? 12 : 3); m.align.splice(at, 0, ""); m.rows.forEach((r) => r.splice(at, 0, "")); }, { r: -1, c: w ? w.c + 1 : 0 }); });
  button("Remove this row", `${row}<path d="M15 2l6 6M21 2l-6 6" />`, () => { const w = where(); if (!w || w.r < 0) return; change(view, wrap, (m) => { if (m.rows.length > 1) m.rows.splice(w.r, 1); else m.rows[0] = m.rows[0].map(() => ""); }, { r: Math.max(-1, w.r - 1), c: w.c }); });
  button("Remove this column", `${col}<path d="M15 2l6 6M21 2l-6 6" />`, () => { const w = where(); if (!w) return; change(view, wrap, (m) => { if (m.head.length < 2) return; for (const list of [m.head, m.dashes, m.align, ...m.rows] as unknown[][]) list.splice(w.c, 1); }, { r: w.r, c: Math.max(0, w.c - 1) }); });
  button("Delete the table", '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/>', () => {
    const found = tableAt(view, wrap);
    if (!found) return;
    const to = Math.min(found.to + 1, view.state.doc.length);
    view.dispatch({ changes: { from: found.from, to }, selection: { anchor: found.from }, userEvent: "delete.table" });
    view.focus();
  }, true);
  return bar;
}

function tablesOf(state: EditorState): DecorationSet {
  const found: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== "Table") return;
      const from = state.doc.lineAt(ref.from).from, to = state.doc.lineAt(ref.to).to;
      found.push(Decoration.replace({ widget: new TableView(state.doc.sliceString(from, to), from), block: true }).range(from, to));
      return false;
    },
  });
  return Decoration.set(found, true);
}
const tables = StateField.define<DecorationSet>({
  create: tablesOf,
  update: (value, tr) => tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? tablesOf(tr.state) : value,
  provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
});

/* ── writing together: others' cursors, and the note's shared changes ── */

export type RemoteCursor = { clientID: string; name: string; colour: string; anchor: number; head: number };
const setRemote = StateEffect.define<RemoteCursor[]>();
const remote = StateField.define<RemoteCursor[]>({
  create: () => [],
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setRemote)) value = e.value;
    if (!tr.docChanged) return value;
    return value.map((c) => ({ ...c, anchor: tr.changes.mapPos(Math.min(c.anchor, tr.startState.doc.length), -1), head: tr.changes.mapPos(Math.min(c.head, tr.startState.doc.length), 1) }));
  },
  provide: (field) => EditorView.decorations.from(field, (cursors) => {
    const found: Range<Decoration>[] = [];
    for (const c of cursors) {
      const from = Math.min(c.anchor, c.head), to = Math.max(c.anchor, c.head);
      if (to > from) found.push(Decoration.mark({ class: "nt-their-pick", attributes: { style: `--who: ${c.colour}` } }).range(from, to));
      found.push(Decoration.widget({ widget: new Caret(c.name, c.colour), side: 1 }).range(c.head));
    }
    return Decoration.set(found, true);
  }),
});

class Caret extends WidgetType {
  constructor(readonly name: string, readonly colour: string) { super(); }
  eq(other: Caret) { return other.name === this.name && other.colour === this.colour; }
  toDOM() {
    const caret = document.createElement("span");
    caret.className = "nt-their-caret";
    caret.style.setProperty("--who", this.colour);
    caret.setAttribute("aria-hidden", "true");
    const flag = document.createElement("span");
    flag.className = "nt-their-name";
    flag.textContent = this.name;
    caret.append(flag);
    return caret;
  }
  ignoreEvent() { return true; }
}

const liveSlot = new Compartment();

/** The change taking [from] to [to], as small as their shared start and end allow. */
function difference(from: string, to: string): ChangeSpec {
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) start++;
  let end = 0;
  while (end < from.length - start && end < to.length - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++;
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

/* ── finding where the caret is ── */

function enclosing(state: EditorState, from: number, to: number, name: string): Node | null {
  for (const side of [-1, 1] as const) {
    for (let node: Node | null = syntaxTree(state).resolveInner(from, side); node; node = node.parent) {
      if (node.name === name && node.from <= from && node.to >= to) return node;
    }
  }
  return null;
}

export type Formats = { bold: boolean; italic: boolean; code: boolean; link: boolean; heading: number; bullets: boolean; checklist: boolean; numbered: boolean };
export type Action = "bold" | "italic" | "code" | "link" | "heading" | "bullets" | "checklist" | "numbered" | "table";

const prefix = /^(\s*)(?:(#{1,6})\s+|>\s?|([-*+])\s+(?:\[([ xX])\]\s+)?|(\d+)[.)]\s+(?:\[([ xX])\]\s+)?)?/;

function formatsAt(state: EditorState): Formats {
  const { from, to, head } = state.selection.main;
  const line = state.doc.lineAt(head).text;
  const found = prefix.exec(line)!;
  const task = found[4] !== undefined || found[6] !== undefined;
  return {
    bold: Boolean(enclosing(state, from, to, "StrongEmphasis")),
    italic: Boolean(enclosing(state, from, to, "Emphasis")),
    code: Boolean(enclosing(state, from, to, "InlineCode") || enclosing(state, from, to, "FencedCode")),
    link: Boolean(enclosing(state, from, to, "Link")),
    heading: found[2]?.length ?? 0,
    bullets: Boolean(found[3]) && !task,
    checklist: task,
    numbered: Boolean(found[5]) && !task,
  };
}

/* ── bold, italic, code: wrapping and unwrapping ── */

const wraps = { bold: { node: "StrongEmphasis", mark: "**" }, italic: { node: "Emphasis", mark: "*" }, code: { node: "InlineCode", mark: "`" } } as const;

function toggleWrap(kind: keyof typeof wraps) {
  return (view: EditorView) => {
    if (view.state.readOnly) return false;
    const { node: name, mark: m } = wraps[kind];
    const { state } = view;
    const range = state.selection.main;
    const span = enclosing(state, range.from, range.to, name);
    if (span) {
      const first = span.firstChild;
      const open = first && first.from === span.from ? first.to - first.from : m.length;
      /* At the end of bold, ⌘B steps out of it rather than undoing it. */
      if (range.empty && range.head === span.to - open) { view.dispatch({ selection: { anchor: span.to } }); return true; }
      view.dispatch(state.update({ changes: [{ from: span.from, to: span.from + open }, { from: span.to - open, to: span.to }], userEvent: "input.format" }));
      return true;
    }
    const before = state.sliceDoc(range.from - m.length, range.from), after = state.sliceDoc(range.to, range.to + m.length);
    if (before === m && after === m) {
      view.dispatch({ changes: [{ from: range.from - m.length, to: range.from }, { from: range.to, to: range.to + m.length }], userEvent: "input.format" });
      return true;
    }
    if (range.empty) view.dispatch({ changes: { from: range.from, insert: m + m }, selection: { anchor: range.from + m.length }, userEvent: "input.format" });
    else view.dispatch({ changes: [{ from: range.from, insert: m }, { from: range.to, insert: m }], selection: { anchor: range.from + m.length, head: range.to + m.length }, userEvent: "input.format" });
    return true;
  };
}

/* ── links: ⌘K, then Tab or Enter steps to the address, and again out of it ── */

type Linking = { from: number; to: number; stage: "words" | "address" };
const setLinking = StateEffect.define<Linking | null>();
const linking = StateField.define<Linking | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setLinking)) return effect.value;
    if (!value) return null;
    const next = { ...value, from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1) };
    const head = tr.state.selection.main.head;
    return head < next.from || head > next.to ? null : next;
  },
});

function makeLink(view: EditorView) {
  if (view.state.readOnly) return false;
  const { state } = view;
  const range = state.selection.main;
  const inside = enclosing(state, range.from, range.to, "Link");
  const url = inside?.getChild("URL");
  if (inside && url) { view.dispatch({ selection: { anchor: url.from, head: url.to } }); return true; }
  const words = state.sliceDoc(range.from, range.to);
  const isAddress = /^(https?:\/\/|mailto:|www\.)\S+$/i.test(words);
  const insert = isAddress ? `[](${words})` : `[${words}]()`;
  const caret = isAddress ? range.from + 1 : range.from + 1 + words.length;
  view.dispatch({ changes: { from: range.from, to: range.to, insert }, selection: { anchor: caret }, effects: setLinking.of({ from: range.from, to: range.from + insert.length, stage: "words" }), userEvent: "input.format" });
  return true;
}

function stepLink(view: EditorView) {
  const at = view.state.field(linking, false);
  if (!at) return false;
  const text = view.state.sliceDoc(at.from, at.to);
  const middle = text.indexOf("](");
  if (middle < 0) return false;
  if (at.stage === "words") view.dispatch({ selection: { anchor: at.from + middle + 2 }, effects: setLinking.of({ ...at, stage: "address" }) });
  else view.dispatch({ selection: { anchor: at.to }, effects: setLinking.of(null) });
  return true;
}

/* ── lines: lists and headings ── */

function selectedLines(state: EditorState) {
  const seen = new Set<number>();
  const out: { from: number; text: string }[] = [];
  for (const range of state.selection.ranges) {
    for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      out.push({ from: line.from, text: line.text });
    }
  }
  return out;
}

/** Turns the selected lines into bullets, a checklist, numbers or a heading level, or back to plain lines when they already are. */
function setLines(kind: "bullets" | "checklist" | "numbered" | 1 | 2 | 3 | "cycle") {
  return (view: EditorView) => {
    if (view.state.readOnly) return false;
    const { state } = view;
    const targets = selectedLines(state);
    const now = formatsAt(state);
    const level = kind === "cycle" ? (now.heading >= 3 ? 0 : now.heading + 1) : kind;
    const isAlready = (text: string) => {
      const f = prefix.exec(text)!;
      const task = f[4] !== undefined || f[6] !== undefined;
      if (kind === "bullets") return Boolean(f[3]) && !task;
      if (kind === "checklist") return task;
      if (kind === "numbered") return Boolean(f[5]) && !task;
      return false;
    };
    const off = typeof level !== "number" && targets.every((t) => isAlready(t.text));
    const changes: ChangeSpec[] = [];
    targets.forEach((t, i) => {
      const f = prefix.exec(t.text)!;
      const indent = f[1];
      const ticked = (f[4] ?? f[6] ?? " ").toLowerCase() === "x" ? "x" : " ";
      let next: string;
      if (typeof level === "number") next = level && (f[2]?.length !== level || kind === "cycle") ? `${"#".repeat(level)} ` : "";
      else if (off) next = "";
      else next = kind === "bullets" ? "- " : kind === "checklist" ? `- [${ticked}] ` : `${i + 1}. `;
      changes.push({ from: t.from, to: t.from + f[0].length, insert: (typeof level === "number" ? "" : indent) + next });
    });
    view.dispatch(state.update({ changes, userEvent: "input.format" }));
    return true;
  };
}

const listLine = /^(\s*)([-*+]|\d+[.)])(\s+)/;

/** Tab and ⇧Tab move a list item in and out; in code, Tab is two spaces; elsewhere it does nothing. */
function indentList(dir: 1 | -1) {
  return (view: EditorView) => {
    const { state } = view;
    if (state.readOnly) return true;
    const changes: ChangeSpec[] = [];
    let listed = false;
    for (const t of selectedLines(state)) {
      const own = listLine.exec(t.text);
      if (!own) continue;
      listed = true;
      const indent = own[1].length;
      let want = indent;
      for (let n = state.doc.lineAt(t.from).number - 1; n >= 1; n--) {
        const above = listLine.exec(state.doc.line(n).text);
        if (!above) { if (state.doc.line(n).text.trim()) continue; else break; }
        const its = above[1].length;
        if (dir > 0 && its === indent) { want = its + above[2].length + above[3].length; break; }
        if (dir > 0 && its < indent) break;
        if (dir < 0 && its < indent) { want = its; break; }
      }
      if (dir < 0 && want === indent && indent > 0) want = 0;
      if (want !== indent) changes.push({ from: t.from, to: t.from + indent, insert: " ".repeat(want) });
    }
    if (listed) { if (changes.length) view.dispatch({ changes, userEvent: "input.indent" }); return true; }
    if (dir > 0 && enclosing(state, state.selection.main.from, state.selection.main.to, "FencedCode")) {
      view.dispatch(state.replaceSelection("  "));
    }
    return true;
  };
}

/* `[] ` at the start of a line becomes a checkbox; `# `, `- `, `1. ` and `> ` already are what they say. */
const typedMarkers = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== " " || from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const before = view.state.sliceDoc(line.from, from);
  const box = /^(\s*)\[\s?\]$/.exec(before);
  if (!box) return false;
  const insert = `${box[1]}- [ ] `;
  view.dispatch({ changes: { from: line.from, to: from, insert }, selection: { anchor: line.from + insert.length }, userEvent: "input.type" });
  return true;
});

/* Enter on an empty item or an empty quote line ends the list or quote: the marker goes, the line stays. */
function endEmpty(view: EditorView) {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || state.readOnly) return false;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to || !/^\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?|>\s?)$/.test(line.text)) return false;
  /* A blank line after it, so what comes next is its own paragraph rather than part of the last item. */
  const gap = line.number > 1 && state.doc.line(line.number - 1).text.trim() ? "\n" : "";
  view.dispatch({ changes: { from: line.from, to: line.to, insert: gap }, selection: { anchor: line.from + gap.length }, userEvent: "delete" });
  return true;
}

/* Enter just inside the closing marks at a line's end steps over them first, so they stay with their words. */
function stepOverMarks(view: EditorView) {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  if (range.head < line.to && /^(?:\*\*|\*|__|_|`|~~)+$/.test(state.sliceDoc(range.head, line.to))) view.dispatch({ selection: { anchor: line.to } });
  return false;
}

const shortcuts = Prec.highest(keymap.of([
  { key: "Enter", run: (view) => stepLink(view) || stepOverMarks(view) || endEmpty(view) },
  { key: "Tab", run: (view) => stepLink(view) || indentList(1)(view), shift: indentList(-1) },
  { key: "Mod-b", run: toggleWrap("bold") },
  { key: "Mod-i", run: toggleWrap("italic") },
  { key: "Mod-e", run: toggleWrap("code") },
  { key: "Mod-k", run: makeLink },
  { key: "Shift-Mod-7", run: setLines("numbered") },
  { key: "Shift-Mod-8", run: setLines("bullets") },
  { key: "Shift-Mod-9", run: setLines("checklist") },
  { key: "Mod-Alt-1", run: setLines(1) },
  { key: "Mod-Alt-2", run: setLines(2) },
  { key: "Mod-Alt-3", run: setLines(3) },
]));

/* ⌘K in the note is a link: it never reaches the rail's apps sheet. */
const keepKeys = ViewPlugin.define((view) => {
  const keep = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") event.stopPropagation(); };
  view.dom.addEventListener("keydown", keep);
  return { destroy: () => view.dom.removeEventListener("keydown", keep) };
});

/* ⌘/Ctrl-click on a link opens it, in a tab of its own; a plain click just puts the cursor there. */
function linkAt(view: EditorView, pos: number): string | null {
  let node = syntaxTree(view.state).resolveInner(pos, 1);
  for (let up: typeof node | null = node; up; up = up.parent) {
    if (up.name === "Link" || up.name === "Autolink" || up.name === "URL") { node = up; break; }
    if (!up.parent) return null;
  }
  const url = node.name === "URL" ? node : node.getChild("URL");
  if (!url) return null;
  const href = view.state.sliceDoc(url.from, url.to).replace(/^<|>$/g, "");
  return /^(https?:|mailto:)/i.test(href) ? href : /^www\./i.test(href) ? `https://${href}` : null;
}
const links = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const href = pos === null ? null : linkAt(view, pos);
    if (!href) return false;
    event.preventDefault();
    window.open(href, "_blank", "noopener,noreferrer");
    return true;
  },
});

const look = EditorView.theme({
  "&": { color: "var(--k-on-surface)", backgroundColor: "transparent", fontSize: "16px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--k-sans)", lineHeight: "1.65", overflow: "visible" },
  ".cm-content": { padding: "0 0 30vh", caretColor: "var(--k-app-accent)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--k-app-accent)", borderLeftWidth: "2px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in srgb, var(--k-app-accent) 22%, transparent) !important" },
  ".cm-placeholder": { color: "var(--k-faint)" },
});

/* A table: two columns, a header row and one row to fill, on lines of their own below the caret's; the caret in the first heading. */
function insertTable(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const empty = !line.text.trim();
  const before = empty ? (line.number > 1 && view.state.doc.line(line.number - 1).text.trim() ? "\n" : "") : "\n\n";
  const table = writeTable({ head: ["", ""], dashes: [3, 3], align: ["", ""], rows: [["", ""], ["", ""]] });
  const at = empty ? line.from : line.to;
  const from = at + before.length;
  focusNext = { from, r: -1, c: 0, pick: false };
  view.dispatch({ changes: { from: at, to: empty ? line.to : at, insert: `${before}${table}\n` }, userEvent: "input.table", scrollIntoView: true });
  focusCellNow(view, from);
  return true;
}

const actions: Record<Action, (view: EditorView) => boolean> = {
  bold: toggleWrap("bold"), italic: toggleWrap("italic"), code: toggleWrap("code"), link: makeLink,
  heading: setLines("cycle"), bullets: setLines("bullets"), checklist: setLines("checklist"), numbered: setLines("numbered"), table: insertTable,
};

export type LiveUpdate = { clientID: string; changes: unknown };
export type BodyHandle = {
  replace: (text: string) => void; focus: () => void; run: (action: Action) => void;
  /**
   * Starts writing together from change [version], whose text is [text]: the
   * page's own text, where it differs, becomes this page's first change.
   */
  goLive: (version: number, clientID: string, text: string) => void;
  /** This page's changes not yet taken, from the change number they follow. */
  pending: () => { version: number; updates: { changes: unknown }[] } | null;
  /** Changes made, from change [from] on; false when some before them are missing. */
  receive: (from: number, updates: LiveUpdate[]) => boolean;
  /** The change number this page has caught up to. */
  synced: () => number;
  showCursors: (cursors: RemoteCursor[]) => void;
};

export function NoteBody({ initial, readOnly, onChange, onBlur, onReady, onFormats, onCursor }: {
  initial: string;
  readOnly?: boolean;
  onChange: (text: string) => void;
  onBlur: () => void;
  /** Hands over what the page may do to the text from outside: put theirs in after a clash, take the cursor, or format. */
  onReady?: (handle: BodyHandle | null) => void;
  /** The formatting at the caret, for the format bar. */
  onFormats?: (formats: Formats) => void;
  /** Where the caret is, as it moves. */
  onCursor?: (anchor: number, head: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const changed = useRef(onChange);
  const blurred = useRef(onBlur);
  const ready = useRef(onReady);
  const formats = useRef(onFormats);
  const cursor = useRef(onCursor);
  useEffect(() => { changed.current = onChange; blurred.current = onBlur; ready.current = onReady; formats.current = onFormats; cursor.current = onCursor; });
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          shortcuts, keepKeys,
          markdown({ base: markdownLanguage, addKeymap: true }),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          typedMarkers, linking,
          EditorView.lineWrapping,
          EditorState.readOnly.of(Boolean(readOnly)),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ "aria-label": "Note", spellcheck: "true", autocapitalize: "sentences" }),
          placeholder(readOnly ? "" : "Start writing"),
          live, atomic, links, look, hasFocus, followFocus, tables, remote, liveSlot.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.every((t) => t.annotation(fromOutside))) changed.current(update.state.doc.toString());
            if (update.focusChanged && !update.view.hasFocus) blurred.current();
            if (update.docChanged || update.selectionSet || update.focusChanged) formats.current?.(formatsAt(update.state));
            if ((update.docChanged || update.selectionSet) && update.view.hasFocus) { const main = update.state.selection.main; cursor.current?.(main.anchor, main.head); }
          }),
        ],
      }),
    });
    ready.current?.({
      /* Only what changed is swapped, so the cursor and the scroll stay where they were and nothing flashes. */
      replace: (text) => {
        const now = view.state.doc.toString();
        if (now === text) return;
        let from = 0;
        while (from < now.length && from < text.length && now[from] === text[from]) from++;
        let end = 0;
        while (end < now.length - from && end < text.length - from && now[now.length - 1 - end] === text[text.length - 1 - end]) end++;
        view.dispatch({ changes: { from, to: now.length - end, insert: text.slice(from, text.length - end) }, annotations: fromOutside.of(true) });
      },
      focus: () => view.focus(),
      run: (action) => {
        /* In a table cell, the format bar formats the cell. */
        const cell = focusedCell(view);
        if (cell) { formatCell(cell, action); return; }
        view.focus(); actions[action](view);
      },
      goLive: (version, clientID, text) => {
        const mine = view.state.doc.toString();
        /* Starting again (the Portal restarted) drops what the old start remembered first. */
        view.dispatch({ effects: liveSlot.reconfigure([]) });
        if (mine !== text) view.dispatch({ changes: difference(mine, text), annotations: [fromOutside.of(true)] });
        view.dispatch({ effects: liveSlot.reconfigure(collab({ startVersion: version, clientID })) });
        if (mine !== text && !view.state.readOnly) view.dispatch({ changes: difference(text, mine) });
      },
      pending: () => {
        const updates = sendableUpdates(view.state);
        return updates.length ? { version: getSyncedVersion(view.state), updates: updates.map((u) => ({ changes: u.changes.toJSON() })) } : null;
      },
      receive: (from, updates) => {
        const skip = getSyncedVersion(view.state) - from;
        if (skip < 0) return false;
        const fresh = updates.slice(skip);
        if (fresh.length) view.dispatch(receiveUpdates(view.state, fresh.map((u) => ({ changes: ChangeSet.fromJSON(u.changes), clientID: u.clientID }))));
        return true;
      },
      synced: () => getSyncedVersion(view.state),
      showCursors: (cursors) => {
        const most = view.state.doc.length;
        view.dispatch({ effects: setRemote.of(cursors.map((c) => ({ ...c, anchor: Math.min(c.anchor, most), head: Math.min(c.head, most) }))) });
      },
    });
    formats.current?.(formatsAt(view.state));
    return () => { view.destroy(); ready.current?.(null); };
    // The editor is made once per note: its text after that is its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={host} className="nt-body" />;
}
