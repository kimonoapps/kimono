"use client";

import { useState } from "react";
import MarkdownPeek from "@/components/file-preview/markdown";

export type PublicNote = { id: string; parentId: string | null; title: string; text: string; updatedAt: number };
type PublicSection = { id: string; parentId: string | null; name: string };

/**
 * The public page's reading: a note's title in Mincho over its text, typeset
 * as Drive previews Markdown. A notebook adds a side list of its sections and
 * notes; picking one shows it.
 */
export function PublicReader({ title, sections, notes }: { title: string | null; sections: PublicSection[]; notes: PublicNote[] }) {
  const [openId, setOpenId] = useState(notes[0]?.id ?? null);
  const open = notes.find((n) => n.id === openId) ?? null;
  const list = (parent: string | null, depth: number): React.ReactNode => <>
    {notes.filter((n) => n.parentId === parent).map((n) => <button key={n.id} type="button" className="np-item" style={{ "--depth": depth } as React.CSSProperties}
      aria-current={n.id === openId ? "page" : undefined} onClick={() => setOpenId(n.id)}>{n.title}</button>)}
    {sections.filter((s) => s.parentId === parent).map((s) => <div key={s.id} className="np-section">
      <span className="np-section-name" style={{ "--depth": depth } as React.CSSProperties}>{s.name}</span>
      {list(s.id, depth + 1)}
    </div>)}
  </>;
  return <div className={title === null ? "np-one" : "np-book"}>
    {title !== null ? <nav className="np-list" aria-label={title}>
      <h1 className="np-book-name">{title}</h1>
      {notes.length ? list(null, 0) : <p className="np-quiet">Nothing here yet.</p>}
    </nav> : null}
    {open ? <article className="np-note">
      <h2 className="np-title">{open.title}</h2>
      <div className="np-text fp-big"><MarkdownPeek key={open.id} text={open.text} /></div>
    </article> : null}
  </div>;
}
