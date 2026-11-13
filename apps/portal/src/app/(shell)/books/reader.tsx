"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { booksApi, type BookFileInfo } from "./api";

/*
 * Reading in Kimono: an EPUB laid out in pages (epub.js), or a PDF in the
 * browser's own viewer. Turn pages with the arrow keys, a click on either
 * edge, or a swipe. How far in you are is kept as you go (debounced), so
 * the shelf, your profile, the phone and a Kimono Read all pick up where you are.
 */

type Rendition = {
  display(target?: string): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  on(event: string, cb: (...args: unknown[]) => void): void;
  themes: { register(name: string, styles: Record<string, Record<string, string>>): void; select(name: string): void; fontSize(size: string): void };
  destroy(): void;
};
type EpubBook = {
  ready: Promise<void>;
  renderTo(el: HTMLElement, options: Record<string, unknown>): Rendition;
  locations: { generate(chars: number): Promise<string[]>; percentageFromCfi(cfi: string): number; cfiFromPercentage(p: number): string };
  destroy(): void;
};

const fileUrl = (f: BookFileInfo) => `/api/v1/books/file?f=${encodeURIComponent(f.address)}&format=${f.format}`;

export function Reader({ bookKey, title, file, startAt, onClose, onProgress }: {
  bookKey: string; title: string; file: BookFileInfo; startAt: number;
  onClose: () => void; onProgress: (fraction: number) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const [fraction, setFraction] = useState(startAt);
  const [ready, setReady] = useState(file.format === "pdf");
  const [problem, setProblem] = useState<string | null>(null);
  const [size, setSize] = useState(100);
  const saved = useRef(startAt);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  /* Arrow keys and Page Up/Down turn pages; Escape closes. Also heard inside the book's own frame. */
  const keys = useCallback((e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") void rendition.current?.next();
    if (e.key === "ArrowLeft" || e.key === "PageUp") void rendition.current?.prev();
    if (e.key === "Escape") onCloseRef.current();
  }, []);

  /* Keep the place: a moment after the page settles, and on the way out. */
  useEffect(() => {
    if (Math.abs(fraction - saved.current) < 0.005) return;
    const t = setTimeout(() => {
      saved.current = fraction;
      booksApi.progress(bookKey, fraction).then((r) => onProgress(r.fraction)).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [fraction, bookKey, onProgress]);

  useEffect(() => {
    if (file.format !== "epub" || !stage.current) return;
    let book: EpubBook | null = null;
    let cancelled = false;
    (async () => {
      try {
        const ePub = (await import("epubjs")).default as unknown as (url: string, options?: Record<string, unknown>) => EpubBook;
        book = ePub(fileUrl(file), { openAs: "epub" });
        await book.ready;
        if (cancelled || !stage.current) return;
        const r = book.renderTo(stage.current, { width: "100%", height: "100%", flow: "paginated", spread: "auto", allowScriptedContent: false });
        rendition.current = r;
        const dark = matchMedia("(prefers-color-scheme: dark)").matches;
        r.themes.register("kimono", {
          body: { "font-family": "\"Shippori Mincho\", Georgia, serif", "line-height": "1.65", color: dark ? "#E6E1DA" : "#2A2622", background: "transparent", padding: "0 4px" },
          "h1, h2": { "font-family": "\"Shippori Mincho\", Georgia, serif", "font-weight": "700" },
          a: { color: "inherit" },
        });
        r.themes.select("kimono");
        await book.locations.generate(1200);
        if (cancelled) return;
        await r.display(startAt > 0 ? book.locations.cfiFromPercentage(startAt) : undefined);
        r.on("relocated", (...args: unknown[]) => {
          const loc = args[0] as { start?: { cfi?: string }; atEnd?: boolean };
          if (!book || !loc.start?.cfi) return;
          setFraction(loc.atEnd ? 1 : Math.min(1, Math.max(0, book.locations.percentageFromCfi(loc.start.cfi))));
        });
        r.on("keyup", (...args: unknown[]) => keys(args[0] as KeyboardEvent));
        setReady(true);
      } catch (error) {
        console.error(error);
        if (!cancelled) setProblem("This book didn't open.");
      }
    })();
    return () => { cancelled = true; rendition.current?.destroy(); rendition.current = null; book?.destroy(); };
  }, [file, startAt, keys]);

  useEffect(() => { rendition.current?.themes.fontSize(`${size}%`); }, [size]);

  useEffect(() => {
    addEventListener("keyup", keys);
    const lock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { removeEventListener("keyup", keys); document.body.style.overflow = lock; };
  }, [keys]);

  /* Swipes on touch screens. */
  const touch = useRef<number | null>(null);

  return <div className="kb-reader" role="dialog" aria-modal="true" aria-label={`Reading ${title}`}>
    <header className="kb-reader-top">
      <button className="kb-reader-icon" onClick={onClose} aria-label="Close the book"><svg viewBox="0 0 24 24" aria-hidden><path d="m15 6-6 6 6 6" /></svg></button>
      <span className="kb-reader-title">{title}{file.sample ? <em> · Preview</em> : null}</span>
      {file.format === "epub" ? <span className="kb-reader-size" role="group" aria-label="Text size">
        <button className="kb-reader-icon" onClick={() => setSize((s) => Math.max(80, s - 10))} aria-label="Smaller text">A−</button>
        <button className="kb-reader-icon" onClick={() => setSize((s) => Math.min(170, s + 10))} aria-label="Larger text">A+</button>
      </span> : null}
      <button className="kb-reader-icon" onClick={() => { location.href = `${fileUrl(file)}&download=1`; }} aria-label="Download"><svg viewBox="0 0 24 24" aria-hidden><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19h14" /></svg></button>
    </header>
    {file.format === "pdf"
      ? <iframe className="kb-reader-pdf" src={fileUrl(file)} title={title} />
      : <div className="kb-reader-page"
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { const s = touch.current; touch.current = null; if (s === null) return; const dx = e.changedTouches[0].clientX - s; if (Math.abs(dx) > 40) void (dx < 0 ? rendition.current?.next() : rendition.current?.prev()); }}>
        <button className="kb-turn kb-turn-prev" aria-label="Previous page" onClick={() => void rendition.current?.prev()} />
        <div ref={stage} className="kb-reader-stage" />
        <button className="kb-turn kb-turn-next" aria-label="Next page" onClick={() => void rendition.current?.next()} />
        {!ready && !problem ? <div className="kb-reader-wait"><span className="kb-ghost" /></div> : null}
        {problem ? <div className="kb-reader-wait"><p>{problem}</p></div> : null}
      </div>}
    {file.format === "epub" ? <footer className="kb-reader-foot">
      <span className="kb-reader-bar"><span style={{ width: `${fraction * 100}%` }} /></span>
      <span>{Math.round(fraction * 100)}%</span>
    </footer> : null}
  </div>;
}
