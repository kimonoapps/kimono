"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { Book } from "./api";
import "./book3d.css";

/*
 * A book you can almost pick up: cover, spine and page edges in 3D (books.css,
 * .kb-book). On a shelf it stands turned a little, its spine showing; hover or
 * focus turns it to face you, lifts it, and its cover swings open on the
 * first page. Covers that fail to load become a cloth binding with the title
 * stamped on.
 */

/* Cloth colours for spines and bindings: tonal, from Kimono's own family. */
const cloths = [
  ["#3f4a2c", "#e6ecd6"], ["#5b3242", "#f6dde3"], ["#2f3a52", "#dde4f3"], ["#6b4a22", "#f5e6cf"],
  ["#3c2f4f", "#e7def3"], ["#26443f", "#d7ece7"], ["#7a3b2e", "#f6ddd5"], ["#424242", "#ececec"],
] as const;

export function clothOf(key: string): readonly [string, string] {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return cloths[Math.abs(h) % cloths.length];
}

/* Thicker books for longer ones: 14px for a slim one, up to 30px. */
const depthOf = (pages: number | null) => pages ? Math.round(Math.min(30, Math.max(14, 10 + pages / 28))) : 20;

export function Book3D({ book, size = "md", onOpen, badge, progress, still = false, eager = false }: {
  book: Pick<Book, "key" | "title" | "authors" | "cover" | "pages">;
  size?: "sm" | "md" | "lg" | "xl";
  onOpen?: () => void;
  /** A small mark in the corner: a rank, a shelf state. */
  badge?: ReactNode;
  /** Reading progress, 0 to 1: a ribbon down the page edges. */
  progress?: number;
  /** Faces you without turning: the big book on its own page. */
  still?: boolean;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [cloth, ink] = clothOf(book.key);
  const style = { "--kb-cloth": cloth, "--kb-cloth-ink": ink, "--kb-d": `${depthOf(book.pages)}px` } as CSSProperties;
  const showCover = book.cover && !failed;
  const author = book.authors[0] ?? "";
  const body = <span className="kb-book-body">
    <span className="kb-pages" aria-hidden />
    <span className="kb-spine" aria-hidden><span>{book.title}</span></span>
    <span className="kb-back" aria-hidden />
    <span className="kb-leaf" aria-hidden>
      <span className="kb-leaf-title">{book.title}</span>
      {author ? <span className="kb-leaf-author">{author}</span> : null}
    </span>
    <span className="kb-cover">
      {showCover
        ? <img src={book.cover!} alt="" loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} onError={() => setFailed(true)} />
        : <span className="kb-cloth-cover"><span className="kb-cloth-title">{book.title}</span>{author ? <span className="kb-cloth-author">{author}</span> : null}</span>}
      <span className="kb-hinge" aria-hidden />
    </span>
    {progress !== undefined && progress > 0 ? <span className="kb-ribbon" style={{ "--kb-p": progress } as CSSProperties} aria-hidden /> : null}
  </span>;
  const className = `kb-book kb-${size}${still ? " kb-still" : ""}`;
  return onOpen
    ? <button type="button" className={className} style={style} onClick={onOpen} aria-label={`${book.title}${author ? `, ${author}` : ""}`}>
      {body}{badge ? <span className="kb-badge">{badge}</span> : null}
    </button>
    : <span className={className} style={style} role="img" aria-label={book.title}>{body}{badge ? <span className="kb-badge">{badge}</span> : null}</span>;
}
