"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MorphLoader } from "@kimono/ui";
import { booksApi, type BookFileInfo } from "./api";

/*
 * Reading in Kimono: an EPUB laid out in pages (epub.js), or a PDF in the
 * browser's own viewer. Turn pages with the arrow keys, a click on either
 * edge, or a swipe. The bars fade while you read and come back when you move.
 * Paper, sepia or night, and the text size, are remembered. How far in you
 * are is kept as you go, so the shelf, your profile, the phone and a Kimono
 * Read all pick up where you are.
 */

type Rendition = {
  display(target?: string): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  on(event: string, cb: (...args: unknown[]) => void): void;
  themes: { register(name: string, styles: Record<string, Record<string, string>>): void; select(name: string): void; fontSize(size: string): void };
  destroy(): void;
};
type NavItem = { href: string; label: string; subitems?: NavItem[] };
type EpubBook = {
  ready: Promise<void>;
  loaded: { navigation: Promise<{ toc: NavItem[] }> };
  renderTo(el: HTMLElement, options: Record<string, unknown>): Rendition;
  locations: { generate(chars: number): Promise<string[]>; percentageFromCfi(cfi: string): number; cfiFromPercentage(p: number): string };
  destroy(): void;
};

type Paper = "paper" | "sepia" | "night";
const papers: Record<Paper, { label: string; bg: string; ink: string }> = {
  paper: { label: "Paper", bg: "#FBF8F2", ink: "#2A2622" },
  sepia: { label: "Sepia", bg: "#F1E6D0", ink: "#3D3125" },
  night: { label: "Night", bg: "#1C1A18", ink: "#E2DCD2" },
};
const prefs = {
  read: (): { paper: Paper; size: number } => {
    try {
      const v = JSON.parse(localStorage.getItem("kb.reader") ?? "{}") as { paper?: string; size?: number };
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      return { paper: v.paper && v.paper in papers ? v.paper as Paper : dark ? "night" : "paper", size: Number(v.size) || 100 };
    } catch { return { paper: "paper", size: 100 }; }
  },
  write: (v: { paper: Paper; size: number }) => { try { localStorage.setItem("kb.reader", JSON.stringify(v)); } catch { /* a private window */ } },
};

/* The book as a folder of parts (api/v1/books/epub): epub.js asks for the container, the package and each chapter as it needs them. */
const partsUrl = (f: BookFileInfo) => {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(f.address))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `/api/v1/books/epub/${b64}/`;
};
const fileUrl = (f: BookFileInfo) => `/api/v1/books/file?f=${encodeURIComponent(f.address)}&format=${f.format}`;
const flatten = (items: NavItem[]): NavItem[] => items.flatMap((i) => [i, ...flatten(i.subitems ?? [])]);

export function Reader({ bookKey, title, author, file, startAt, onClose, onProgress }: {
  bookKey: string; title: string; author: string; file: BookFileInfo; startAt: number;
  onClose: () => void; onProgress: (fraction: number) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const [fraction, setFraction] = useState(startAt);
  const [chapter, setChapter] = useState("");
  const [ready, setReady] = useState(file.format === "pdf");
  const [problem, setProblem] = useState<string | null>(null);
  const [look, setLook] = useState(prefs.read);
  const [calm, setCalm] = useState(false);
  const [turning, setTurning] = useState(false);
  /* Where to open, taken once: saving your place updates the shelf, and the
     shelf's new place must not reopen the book (that looped, re-fetching the
     file and jumping back each time). */
  const [opening] = useState(startAt);
  const saved = useRef(startAt);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const turn = useCallback((dir: 1 | -1) => {
    const r = rendition.current;
    if (!r) return;
    setTurning(true);
    void (dir > 0 ? r.next() : r.prev()).finally(() => setTimeout(() => setTurning(false), 60));
  }, []);

  /* Arrow keys and Page Up/Down turn pages; Escape closes. Heard inside the book's own frame too. */
  const keys = useCallback((e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") turn(1);
    if (e.key === "ArrowLeft" || e.key === "PageUp") turn(-1);
    if (e.key === "Escape") onCloseRef.current();
  }, [turn]);

  /* Keep the place: a moment after the page settles. */
  useEffect(() => {
    if (Math.abs(fraction - saved.current) < 0.005) return;
    const t = setTimeout(() => {
      saved.current = fraction;
      booksApi.progress(bookKey, fraction).then((r) => onProgress(r.fraction)).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [fraction, bookKey, onProgress]);

  /* The bars fade after a few still seconds and return on any movement. */
  useEffect(() => {
    let t = setTimeout(() => setCalm(true), 3200);
    const wake = () => { setCalm(false); clearTimeout(t); t = setTimeout(() => setCalm(true), 3200); };
    addEventListener("pointermove", wake);
    addEventListener("keydown", wake);
    return () => { clearTimeout(t); removeEventListener("pointermove", wake); removeEventListener("keydown", wake); };
  }, []);

  useEffect(() => {
    if (file.format !== "epub" || !stage.current) return;
    let book: EpubBook | null = null;
    let cancelled = false;
    (async () => {
      try {
        const ePub = (await import("epubjs")).default as unknown as (url: string, options?: Record<string, unknown>) => EpubBook;
        book = ePub(partsUrl(file), { openAs: "directory" });
        await book.ready;
        if (cancelled || !stage.current) return;
        const toc = flatten((await book.loaded.navigation).toc ?? []);
        const r = book.renderTo(stage.current, { width: "100%", height: "100%", flow: "paginated", spread: "auto", allowScriptedContent: false });
        rendition.current = r;
        for (const [name, p] of Object.entries(papers)) {
          r.themes.register(name, {
            html: { background: "transparent" },
            body: { "font-family": "\"Shippori Mincho\", \"Iowan Old Style\", Georgia, serif", "line-height": "1.7", color: p.ink, background: "transparent", hyphens: "auto", "text-align": "justify" },
            "h1, h2, h3": { "font-family": "\"Shippori Mincho\", Georgia, serif", "font-weight": "700", "line-height": "1.25", "text-align": "left" },
            p: { margin: "0 0 .9em" },
            a: { color: "inherit" },
            "::selection": { background: name === "night" ? "#5b6b3f" : "#d6e2b8" },
          });
        }
        const now = prefs.read();
        r.themes.select(now.paper);
        r.themes.fontSize(`${now.size}%`);
        await book.locations.generate(1200);
        if (cancelled) return;
        await r.display(opening > 0 && opening < 1 ? book.locations.cfiFromPercentage(opening) : undefined);
        r.on("relocated", (...args: unknown[]) => {
          const loc = args[0] as { start?: { cfi?: string; href?: string }; atEnd?: boolean };
          if (!book || !loc.start?.cfi) return;
          setFraction(loc.atEnd ? 1 : Math.min(1, Math.max(0, book.locations.percentageFromCfi(loc.start.cfi))));
          const here = loc.start.href?.split("#")[0];
          setChapter(toc.find((t) => t.href.split("#")[0] === here)?.label.trim() ?? "");
        });
        r.on("keyup", (...args: unknown[]) => keys(args[0] as KeyboardEvent));
        setReady(true);
      } catch (error) {
        console.error(error);
        if (!cancelled) setProblem("This book didn't open. The copy may be damaged; save it and try it elsewhere.");
      }
    })();
    return () => { cancelled = true; rendition.current?.destroy(); rendition.current = null; book?.destroy(); };
  }, [file, opening, keys]);

  useEffect(() => {
    rendition.current?.themes.select(look.paper);
    rendition.current?.themes.fontSize(`${look.size}%`);
    prefs.write(look);
  }, [look]);

  useEffect(() => {
    addEventListener("keyup", keys);
    const lock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { removeEventListener("keyup", keys); document.body.style.overflow = lock; };
  }, [keys]);

  const touch = useRef<number | null>(null);
  const paper = papers[look.paper];

  /* Above the book's page, not inside it: the sheet's own motion would hold a fixed layer in its box. */
  const host = typeof document === "undefined" ? null : document.querySelector(".kb");
  const view = <div className={`kb-reader kb-paper-${look.paper}${calm && ready ? " kb-calm" : ""}`} role="dialog" aria-modal="true" aria-label={`Reading ${title}`}
    style={{ "--paper": paper.bg, "--paper-ink": paper.ink } as React.CSSProperties}>
    <header className="kb-reader-top">
      <button className="kb-reader-icon" onClick={onClose} aria-label="Close the book"><svg viewBox="0 0 24 24" aria-hidden><path d="m15 6-6 6 6 6" /></svg></button>
      <span className="kb-reader-title">
        <b>{title}</b>
        <span>{chapter || author}{file.sample ? " · Preview" : ""}</span>
      </span>
      {file.format === "epub" ? <>
        <span className="kb-reader-group" role="radiogroup" aria-label="Page">
          {(Object.keys(papers) as Paper[]).map((p) => <button key={p} role="radio" aria-checked={look.paper === p} aria-label={papers[p].label} title={papers[p].label}
            className="kb-swatch" style={{ "--sw": papers[p].bg } as React.CSSProperties} onClick={() => setLook((l) => ({ ...l, paper: p }))} />)}
        </span>
        <span className="kb-reader-group" role="group" aria-label="Text size">
          <button className="kb-reader-icon kb-small-a" onClick={() => setLook((l) => ({ ...l, size: Math.max(80, l.size - 10) }))} aria-label="Smaller text">A</button>
          <button className="kb-reader-icon kb-big-a" onClick={() => setLook((l) => ({ ...l, size: Math.min(170, l.size + 10) }))} aria-label="Larger text">A</button>
        </span>
      </> : null}
      <button className="kb-reader-icon" onClick={() => { location.href = `${fileUrl(file)}&download=1`; }} aria-label="Save a copy" title="Save a copy">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19h14" /></svg>
      </button>
    </header>
    {file.format === "pdf"
      ? <iframe className="kb-reader-pdf" src={fileUrl(file)} title={title} />
      : <div className="kb-reader-page"
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { const s = touch.current; touch.current = null; if (s === null) return; const dx = e.changedTouches[0].clientX - s; if (Math.abs(dx) > 40) turn(dx < 0 ? 1 : -1); }}>
        <button className="kb-turn kb-turn-prev" aria-label="Previous page" onClick={() => turn(-1)}><svg viewBox="0 0 24 24" aria-hidden><path d="m14 6-6 6 6 6" /></svg></button>
        <div className="kb-leafwrap"><div ref={stage} className={`kb-reader-stage${turning ? " kb-turning" : ""}`} /></div>
        <button className="kb-turn kb-turn-next" aria-label="Next page" onClick={() => turn(1)}><svg viewBox="0 0 24 24" aria-hidden><path d="m10 6 6 6-6 6" /></svg></button>
        {!ready && !problem ? <div className="kb-reader-wait"><MorphLoader ink="#7d8f58" label="Opening the book" className="kb-reader-ink" /><p>Opening {title}</p></div> : null}
        {problem ? <div className="kb-reader-wait"><p>{problem}</p></div> : null}
      </div>}
    {file.format === "epub" ? <footer className="kb-reader-foot">
      <span className="kb-reader-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}><span style={{ width: `${fraction * 100}%` }} /></span>
      <span>{Math.round(fraction * 100)}%</span>
    </footer> : null}
  </div>;
  return host ? createPortal(view, host) : view;
}
