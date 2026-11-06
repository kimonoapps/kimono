"use client";

import Markdown, { type Components } from "react-markdown";
import { Scroller } from "@/components/scroller";
import remarkGfm from "remark-gfm";
import { CodePeek } from "./peek";

/*
 * A Markdown file, read: headings, lists, tables, quotes and code, typeset in
 * Kimono's faces. No raw HTML ever runs, links open in a new tab, and pictures
 * stay as their words, so a file can't reach out to another site by being read.
 */
const parts: Components = {
  // eslint-disable-next-line no-restricted-syntax -- a link inside someone's file, to another site: no Kimono transition
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>,
  img: ({ alt }) => alt ? <span className="fp-md-pic">{alt}</span> : null,
  code: ({ className, children }) => {
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    const text = String(children ?? "");
    return lang && text.includes("\n") ? <span className="fp-md-code"><CodePeek text={text.replace(/\n$/, "")} ext={lang} inline /></span> : <code>{children}</code>;
  },
  pre: ({ children }) => <div className="fp-md-pre">{children}</div>,
};

export default function MarkdownPeek({ text }: { text: string }) {
  return <Scroller className="fp-fill" viewClassName="fp-md" tabIndex={0}><Markdown remarkPlugins={[remarkGfm]} components={parts}>{text}</Markdown></Scroller>;
}
