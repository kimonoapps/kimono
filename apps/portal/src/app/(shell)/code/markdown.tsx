"use client";

import { Fragment, type ReactNode } from "react";

/*
 * The little Markdown an agent writes: paragraphs, headings, lists, quotes,
 * fenced code, and inline code, bold, italics and links. Built as elements,
 * never as HTML, so nothing the agent writes can become markup.
 */

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))|(\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const k = `${key}-${n++}`;
    if (match[1]) out.push(<code key={k}>{match[1].slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={k}>{inline(match[2].slice(2, -2), k)}</strong>);
    else if (match[3]) { const href = match[4]; out.push(<button key={k} type="button" className="cd-link" title={href} onClick={() => window.open(href, "_blank", "noopener,noreferrer")}>{match[3].slice(1, match[3].indexOf("]"))}</button>); }
    else if (match[5]) out.push(<em key={k}>{match[5].slice(1, -1)}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; lang: string; text: string };

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
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*```|\s*~~~|\s*[-*+]\s+|\s*\d+[.)]\s+|>)/.test(lines[i])) body.push(lines[i++]);
    out.push({ type: "p", text: body.join("\n") });
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  return <div className="cd-md">{blocks(text).map((block, n) => {
    const key = `b${n}`;
    switch (block.type) {
      case "code": return <pre key={key} className="cd-pre" data-lang={block.lang || undefined}><code>{block.text}</code></pre>;
      case "h": return block.level <= 2 ? <h3 key={key}>{inline(block.text, key)}</h3> : <h4 key={key}>{inline(block.text, key)}</h4>;
      case "ul": return <ul key={key}>{block.items.map((item, m) => <li key={m}>{inline(item, `${key}-${m}`)}</li>)}</ul>;
      case "ol": return <ol key={key}>{block.items.map((item, m) => <li key={m}>{inline(item, `${key}-${m}`)}</li>)}</ol>;
      case "quote": return <blockquote key={key}>{inline(block.text, key)}</blockquote>;
      default: return <p key={key}>{block.text.split("\n").map((part, m) => <Fragment key={m}>{m ? <br /> : null}{inline(part, `${key}-${m}`)}</Fragment>)}</p>;
    }
  })}</div>;
}
