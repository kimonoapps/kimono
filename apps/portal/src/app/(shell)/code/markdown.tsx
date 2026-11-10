"use client";

import { Fragment, memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Scroller } from "@/components/scroller";
import { HadithBlock, IslamNotice, QuranBlock } from "./scripture";

/*
 * The little Markdown an agent writes: paragraphs, headings, lists, quotes,
 * fenced code, inline code, bold, italics and links, and LaTeX maths. Built as
 * elements, never as HTML, so nothing the agent writes can become markup; the
 * one exception is KaTeX's own output, which it builds from the maths alone
 * (with \href, \url and the like left off) and escapes.
 */

/* Maths is rare, so KaTeX (and its fonts) load the first time some shows up, not with the page. */
type Katex = typeof import("./tex-engine").default;
let engine: Katex | null = null;
let loading: Promise<Katex> | null = null;
function useKatex() {
  const [ready, setReady] = useState(engine);
  useEffect(() => {
    if (ready) return;
    let live = true;
    loading ??= import("./tex-engine").then((m) => (engine = m.default));
    loading.then((k) => { if (live) setReady(() => k); }, () => { loading = null; });
    return () => { live = false; };
  }, [ready]);
  return ready;
}

/** Maths drawn by KaTeX; what it can't read stays as the source, in the error colour. Until it loads, the source shows. */
function Tex({ source, display }: { source: string; display: boolean }) {
  const katex = useKatex();
  const html = useMemo(() => katex?.renderToString(source, { displayMode: display, throwOnError: false, trust: false, strict: "ignore", output: "htmlAndMathml" }) ?? null, [katex, source, display]);
  if (html === null) return display ? <div className="cd-math">{source}</div> : <span className="cd-math-inline">{source}</span>;
  return display
    ? <div className="cd-math" dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="cd-math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
}

/* Inline maths: $$…$$, \(…\), and $…$ the way pandoc reads it, so prices stay prices:
   the opening $ is followed by a non-space, the closing one follows a non-space and isn't
   followed by a digit ("$5 and $10" is money, "$x^2$" is maths). */
const mathInline = String.raw`(\$\$[^$]+?\$\$)|(\\\([\s\S]+?\\\))|((?<![\\\w$])\$(?=[^\s$])[^$\n]*?[^\s\\$]\$(?!\d))`;

/* \$ is a dollar sign written so it can't open maths: shown as the sign alone. */
const plain = (text: string) => text.replace(/\\\$/g, "$");

/*
 * While a reply is being written its words fade in as they arrive. Each word is
 * keyed by where it starts, so one already shown keeps its place and only new
 * ones animate (a word still growing keeps its key and doesn't start over).
 */
function fadingWords(text: string, key: string, from: number): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const part of text.split(/(\s+)/)) {
    if (part && /\S/.test(part)) out.push(<span key={`${key}-w${from + at}`} className="cd-w">{part}</span>);
    else if (part) out.push(part);
    at += part.length;
  }
  return out;
}

function inline(text: string, key = "i", fade = false): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = new RegExp(String.raw`(\`[^\`\n]+\`)|${mathInline}|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))|(\*[^*\n]+\*|_[^_\n]+_)`, "g");
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) { const words = plain(text.slice(last, match.index)); if (fade) out.push(...fadingWords(words, key, last)); else out.push(words); }
    const k = `${key}-${n++}`;
    if (match[1]) out.push(<code key={k}>{match[1].slice(1, -1)}</code>);
    else if (match[2]) out.push(<Tex key={k} source={match[2].slice(2, -2)} display />);
    else if (match[3]) out.push(<Tex key={k} source={match[3].slice(2, -2)} display={false} />);
    else if (match[4]) out.push(<Tex key={k} source={match[4].slice(1, -1)} display={false} />);
    else if (match[5]) out.push(<strong key={k}>{inline(match[5].slice(2, -2), k, fade)}</strong>);
    else if (match[6]) { const href = match[7]; out.push(<button key={k} type="button" className="cd-link" title={href} onClick={() => window.open(href, "_blank", "noopener,noreferrer")}>{match[6].slice(1, match[6].indexOf("]"))}</button>); }
    else if (match[8]) out.push(<em key={k}>{match[8].slice(1, -1)}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) { const words = plain(text.slice(last)); if (fade) out.push(...fadingWords(words, key, last)); else out.push(words); }
  return out;
}

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "ul" | "ol"; items: string[]; start: number }
  | { type: "quote"; text: string }
  | { type: "code"; lang: string; text: string; closed: boolean }
  | { type: "math"; text: string }
  | { type: "hr" }
  | { type: "table"; head: string[]; align: ("left" | "center" | "right" | undefined)[]; rows: string[][] };

/* A table's row: its cells between the pipes, an escaped \| kept as a pipe. */
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
const tableRule = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function blocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i++]);
      const closed = i < lines.length;
      i++;
      out.push({ type: "code", lang: fence[2], text: body.join("\n"), closed });
      continue;
    }
    /* Display maths: $$…$$ or \[…\], on lines of their own (or one line). */
    const opens = /^\s*(\$\$|\\\[)/.exec(line);
    if (opens) {
      const close = opens[1] === "$$" ? "$$" : "\\]";
      const rest = line.trimStart().slice(2);
      const end = rest.indexOf(close);
      if (end >= 0 && !rest.slice(end + 2).trim()) { out.push({ type: "math", text: rest.slice(0, end) }); i++; continue; }
      if (end < 0) {
        const body = [rest];
        let j = i + 1;
        while (j < lines.length && !lines[j].includes(close)) body.push(lines[j++]);
        if (j < lines.length && !lines[j].slice(lines[j].indexOf(close) + 2).trim()) {
          body.push(lines[j].slice(0, lines[j].indexOf(close)));
          out.push({ type: "math", text: body.join("\n") });
          i = j + 1;
          continue;
        }
      }
    }
    if (!line.trim()) { i++; continue; }
    /* a rule: ---, *** or ___ on a line of its own */
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ type: "hr" }); i++; continue; }
    /* a table: a row of cells, then a row of dashes, then its rows */
    if (line.includes("|") && i + 1 < lines.length && tableRule.test(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => c.startsWith(":") && c.endsWith(":") ? "center" as const : c.endsWith(":") ? "right" as const : c.startsWith(":") ? "left" as const : undefined);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push({ type: "table", head, align, rows });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { out.push({ type: "h", level: heading[1].length, text: heading[2] }); i++; continue; }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const marker = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
      const start = ordered ? Number(/\d+/.exec(line)![0]) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        if (marker.test(lines[i])) {
          items.push(lines[i].replace(marker, ""));
          i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items[items.length - 1] += ` ${lines[i++].trim()}`;
          continue;
        }
        /* A loose list (a blank line between items) is still one list: "1." … "2." keep counting. */
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j === i || j >= lines.length) break;
        if (marker.test(lines[j])) { i = j; continue; }
        if (/^\s{2,}\S/.test(lines[j]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[j])) { i = j; while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items[items.length - 1] += ` ${lines[i++].trim()}`; continue; }
        break;
      }
      out.push({ type: ordered ? "ol" : "ul", items, start });
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      out.push({ type: "quote", text: body.join(" ") });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*```|\s*~~~|\s*[-*+]\s+|\s*\d+[.)]\s+|>|\s*\$\$|\s*\\\[)/.test(lines[i]) && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && tableRule.test(lines[i + 1]))) body.push(lines[i++]);
    if (!body.length) body.push(lines[i++]);
    out.push({ type: "p", text: body.join("\n") });
  }
  return out;
}

/* Drawn again only when its text changes: a long chat re-renders often while a reply streams in. */
export const Markdown = memo(function Markdown({ text, streaming = false }: { text: string; /** Being written: new words fade in. */ streaming?: boolean }) {
  const parsed = useMemo(() => blocks(text), [text]);
  const f = streaming;
  return <div className="cd-md">{parsed.map((block, n) => {
    const key = `b${n}`;
    switch (block.type) {
      case "math": return <Tex key={key} source={block.text} display />;
      case "code":
        /* Quran and hadith are cited by reference and shown from their sources; until the block is closed the reference may still be growing. */
        if (block.lang === "islam-notice") return block.closed ? <IslamNotice key={key} /> : null;
        if (block.lang === "quran" || block.lang === "hadith") {
          if (!block.closed) return <div key={key} className="cd-scrip is-loading" aria-busy="true"><div className="cd-scrip-bars"><span /><span /></div></div>;
          return block.lang === "quran" ? <QuranBlock key={key} source={block.text} /> : <HadithBlock key={key} source={block.text} />;
        }
        return <Scroller key={key} fit as="pre" tone="lift" viewClassName="cd-pre" data-lang={block.lang || undefined}><code>{block.text}</code></Scroller>;
      case "h": return block.level <= 2 ? <h3 key={key}>{inline(block.text, key, f)}</h3> : <h4 key={key}>{inline(block.text, key, f)}</h4>;
      case "ul": return <ul key={key}>{block.items.map((item, m) => <li key={m}>{inline(item, `${key}-${m}`, f)}</li>)}</ul>;
      case "ol": return <ol key={key} start={block.start === 1 ? undefined : block.start}>{block.items.map((item, m) => <li key={m}>{inline(item, `${key}-${m}`, f)}</li>)}</ol>;
      case "quote": return <blockquote key={key}>{inline(block.text, key, f)}</blockquote>;
      case "hr": return <hr key={key} className="cd-rule" />;
      case "table": return <Scroller key={key} fit tone="lift" viewClassName="cd-table-wrap"><table className="cd-table">
        <thead><tr>{block.head.map((c, m) => <th key={m} style={{ textAlign: block.align[m] }}>{inline(c, `${key}-h${m}`, f)}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, r) => <tr key={r}>{block.head.map((_, m) => <td key={m} style={{ textAlign: block.align[m] }}>{inline(row[m] ?? "", `${key}-${r}-${m}`, f)}</td>)}</tr>)}</tbody>
      </table></Scroller>;
      default: return <p key={key}>{block.text.split("\n").map((part, m) => <Fragment key={m}>{m ? <br /> : null}{inline(part, `${key}-${m}`, f)}</Fragment>)}</p>;
    }
  })}</div>;
});
