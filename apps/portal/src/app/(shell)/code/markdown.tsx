"use client";

import { Fragment, memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Scroller } from "@/components/scroller";

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

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = new RegExp(String.raw`(\`[^\`\n]+\`)|${mathInline}|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))|(\*[^*\n]+\*|_[^_\n]+_)`, "g");
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(plain(text.slice(last, match.index)));
    const k = `${key}-${n++}`;
    if (match[1]) out.push(<code key={k}>{match[1].slice(1, -1)}</code>);
    else if (match[2]) out.push(<Tex key={k} source={match[2].slice(2, -2)} display />);
    else if (match[3]) out.push(<Tex key={k} source={match[3].slice(2, -2)} display={false} />);
    else if (match[4]) out.push(<Tex key={k} source={match[4].slice(1, -1)} display={false} />);
    else if (match[5]) out.push(<strong key={k}>{inline(match[5].slice(2, -2), k)}</strong>);
    else if (match[6]) { const href = match[7]; out.push(<button key={k} type="button" className="cd-link" title={href} onClick={() => window.open(href, "_blank", "noopener,noreferrer")}>{match[6].slice(1, match[6].indexOf("]"))}</button>); }
    else if (match[8]) out.push(<em key={k}>{match[8].slice(1, -1)}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(plain(text.slice(last)));
  return out;
}

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "math"; text: string };

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
      i++;
      out.push({ type: "code", lang: fence[2], text: body.join("\n") });
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
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { out.push({ type: "h", level: heading[1].length, text: heading[2] }); i++; continue; }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/).test(lines[i])) {
        items.push(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/, ""));
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items[items.length - 1] += ` ${lines[i++].trim()}`;
      }
      out.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      out.push({ type: "quote", text: body.join(" ") });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*```|\s*~~~|\s*[-*+]\s+|\s*\d+[.)]\s+|>|\s*\$\$|\s*\\\[)/.test(lines[i])) body.push(lines[i++]);
    out.push({ type: "p", text: body.join("\n") });
  }
  return out;
}

/* Drawn again only when its text changes: a long chat re-renders often while a reply streams in. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const parsed = useMemo(() => blocks(text), [text]);
  return <div className="cd-md">{parsed.map((block, n) => {
    const key = `b${n}`;
    switch (block.type) {
      case "math": return <Tex key={key} source={block.text} display />;
      case "code": return <Scroller key={key} fit as="pre" tone="lift" viewClassName="cd-pre" data-lang={block.lang || undefined}><code>{block.text}</code></Scroller>;
      case "h": return block.level <= 2 ? <h3 key={key}>{inline(block.text, key)}</h3> : <h4 key={key}>{inline(block.text, key)}</h4>;
      case "ul": return <ul key={key}>{block.items.map((item, m) => <li key={m}>{inline(item, `${key}-${m}`)}</li>)}</ul>;
      case "ol": return <ol key={key}>{block.items.map((item, m) => <li key={m}>{inline(item, `${key}-${m}`)}</li>)}</ol>;
      case "quote": return <blockquote key={key}>{inline(block.text, key)}</blockquote>;
      default: return <p key={key}>{block.text.split("\n").map((part, m) => <Fragment key={m}>{m ? <br /> : null}{inline(part, `${key}-${m}`)}</Fragment>)}</p>;
    }
  })}</div>;
});
