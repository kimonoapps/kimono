"use client";

import { useEffect, useRef } from "react";
import { Annotation, EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

/*
 * 筆 A note's body: Markdown, styled where you type. Headings, bold, italics,
 * lists, quotes, code and links take their look in place and their markup
 * fades to the outline colour. A task's [ ] is an ink ring you can click;
 * ticking it draws an ink tick and quiets the line, with no strike. Links
 * open on ⌘/Ctrl-click. Pictures stay as their words, and raw HTML is only
 * ever text.
 */

/* A change the page made (theirs, loaded after a clash), not one typed here. */
const fromOutside = Annotation.define<boolean>();

const mark = Decoration.mark({ class: "nt-md-mark" });
const marks: Record<string, Decoration> = {
  StrongEmphasis: Decoration.mark({ class: "nt-md-strong" }),
  Emphasis: Decoration.mark({ class: "nt-md-em" }),
  Strikethrough: Decoration.mark({ class: "nt-md-strike" }),
  InlineCode: Decoration.mark({ class: "nt-md-code" }),
  Link: Decoration.mark({ class: "nt-md-link" }),
  Autolink: Decoration.mark({ class: "nt-md-link" }),
  URL: Decoration.mark({ class: "nt-md-url" }),
  Image: Decoration.mark({ class: "nt-md-picture" }),
  HTMLTag: Decoration.mark({ class: "nt-md-html" }),
  HTMLBlock: Decoration.mark({ class: "nt-md-html" }),
};
const faded = new Set(["HeaderMark", "EmphasisMark", "CodeMark", "CodeInfo", "QuoteMark", "LinkMark", "ListMark", "HorizontalRule", "StrikethroughMark"]);
const lines: Record<string, string> = {
  ATXHeading1: "nt-md-h1", ATXHeading2: "nt-md-h2", ATXHeading3: "nt-md-h3", ATXHeading4: "nt-md-h4", ATXHeading5: "nt-md-h4", ATXHeading6: "nt-md-h4",
  SetextHeading1: "nt-md-h1", SetextHeading2: "nt-md-h2", Blockquote: "nt-md-quote", FencedCode: "nt-md-block", CodeBlock: "nt-md-block",
};

/* When a tick was last made by hand: only that one draws its stroke, not every tick scrolled into view. */
let tickedAt = 0;

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
      const at = view.posAtDOM(box);
      const text = view.state.sliceDoc(at, at + 3);
      if (!/^\[[ xX]\]$/.test(text)) return;
      tickedAt = performance.now();
      view.dispatch({ changes: { from: at + 1, to: at + 2, insert: this.done ? " " : "x" }, userEvent: "input.tick" });
    });
    return box;
  }
  ignoreEvent() { return true; }
}

function decorate(view: EditorView): DecorationSet {
  const found: Range<Decoration>[] = [];
  const doc = view.state.doc;
  const lineClass = (from: number, to: number, cls: string) => {
    for (let line = doc.lineAt(from); ; line = doc.line(line.number + 1)) {
      found.push(Decoration.line({ class: cls }).range(line.from));
      if (line.to >= to || line.number >= doc.lines) break;
    }
  };
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter: (node) => {
        const name = node.name;
        if (lines[name]) lineClass(node.from, node.to, lines[name]);
        if (name === "Task") {
          const marker = node.node.getChild("TaskMarker");
          if (marker) {
            const done = /x/i.test(doc.sliceString(marker.from, marker.to));
            found.push(Decoration.replace({ widget: new Tick(done) }).range(marker.from, marker.to));
            if (done) lineClass(node.from, node.to, "nt-md-done");
          }
        }
        if (faded.has(name) && node.to > node.from) found.push(mark.range(node.from, node.to));
        else if (marks[name] && node.to > node.from) found.push(marks[name].range(node.from, node.to));
      },
    });
  }
  return Decoration.set(found, true);
}

const live = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = decorate(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = decorate(update.view);
  }
}, { decorations: (plugin) => plugin.decorations });

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
  "&": { color: "var(--k-on-surface)", backgroundColor: "transparent", fontSize: "16.5px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--k-sans)", lineHeight: "1.7", overflow: "visible" },
  ".cm-content": { padding: "0 0 40vh", caretColor: "var(--k-app-accent)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--k-app-accent)", borderLeftWidth: "2px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in srgb, var(--k-app-accent) 22%, transparent) !important" },
  ".cm-placeholder": { color: "var(--k-faint)" },
});

export type BodyHandle = { replace: (text: string) => void; focus: () => void };

export function NoteBody({ initial, readOnly, onChange, onBlur, onReady }: {
  initial: string;
  readOnly?: boolean;
  onChange: (text: string) => void;
  onBlur: () => void;
  /** Hands over what the page may do to the text from outside: put theirs in after a clash, or take the cursor. */
  onReady?: (handle: BodyHandle | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const changed = useRef(onChange);
  const blurred = useRef(onBlur);
  const ready = useRef(onReady);
  useEffect(() => { changed.current = onChange; blurred.current = onBlur; ready.current = onReady; });
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage, addKeymap: true }),
          EditorView.lineWrapping,
          EditorState.readOnly.of(Boolean(readOnly)),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ "aria-label": "Note", spellcheck: "true", autocapitalize: "sentences" }),
          placeholder(readOnly ? "" : "Start writing"),
          live, links, look,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.every((t) => t.annotation(fromOutside))) changed.current(update.state.doc.toString());
            if (update.focusChanged && !update.view.hasFocus) blurred.current();
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
    });
    return () => { view.destroy(); ready.current?.(null); };
    // The editor is made once per note: its text after that is its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={host} className="nt-body" />;
}
