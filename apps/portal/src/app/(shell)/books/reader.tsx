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
  themes: { register(name: string, styles: Record<string, Record<string, string>>): void; select(name: string): void; fontSize(size: string): void; override(name: string, value: string, priority?: boolean): void };
  flow(flow: "paginated" | "scrolled-doc"): void;
  spread(spread: "none" | "auto"): void;
  destroy(): void;
};
type NavItem = { href: string; label: string; subitems?: NavItem[] };
type EpubBook = {
  ready: Promise<void>;
  loaded: { navigation: Promise<{ toc: NavItem[] }> };
  renderTo(el: HTMLElement, options: Record<string, unknown>): Rendition;
  locations: { generate(chars: number): Promise<string[]>; percentageFromCfi(cfi: string): number; cfiFromPercentage(p: number): string };
  spine: { get(target: string): { href: string } | null };
  getRange(cfi: string): Promise<Range>;
  destroy(): void;
};

type Paper = "paper" | "sepia" | "dusk" | "night";
const papers: Record<Paper, { label: string; bg: string; ink: string }> = {
  paper: { label: "Paper", bg: "#FBF8F2", ink: "#2A2622" },
  sepia: { label: "Sepia", bg: "#F1E6D0", ink: "#3D3125" },
  dusk: { label: "Dusk", bg: "#34312D", ink: "#DDD5C9" },
  night: { label: "Night", bg: "#1C1A18", ink: "#E2DCD2" },
};
/* The reader's choices: how the page looks and reads. Kept on this device. */
const faces = {
  serif: { label: "Mincho", css: "\"Shippori Mincho\", \"Iowan Old Style\", Georgia, serif" },
  book: { label: "Book", css: "\"Iowan Old Style\", \"Palatino Linotype\", Palatino, Georgia, serif" },
  sans: { label: "Sans", css: "var(--font-sans, system-ui), -apple-system, \"Segoe UI\", sans-serif" },
} as const;
const leadings = { tight: { label: "Tight", value: "1.45" }, normal: { label: "Normal", value: "1.7" }, loose: { label: "Loose", value: "2" } } as const;
const widths = { narrow: { label: "Narrow", px: 600 }, medium: { label: "Medium", px: 760 }, wide: { label: "Wide", px: 1100 } } as const;
const layouts = { page: { label: "One page" }, spread: { label: "Two pages" }, scroll: { label: "Scroll" } } as const;
type Look = {
  paper: Paper; size: number; face: keyof typeof faces; leading: keyof typeof leadings;
  width: keyof typeof widths; align: "left" | "justify"; layout: keyof typeof layouts;
};
const pick = <T extends string>(v: unknown, all: Record<T, unknown>, fallback: T): T => typeof v === "string" && v in all ? v as T : fallback;
const prefs = {
  read: (): Look => {
    let v: Partial<Record<keyof Look, unknown>> = {};
    try { v = JSON.parse(localStorage.getItem("kb.reader") ?? "{}"); } catch { /* a private window */ }
    let dark = false;
    try { dark = matchMedia("(prefers-color-scheme: dark)").matches; } catch { /* no window */ }
    return {
      paper: pick(v.paper, papers, dark ? "night" : "paper"), size: Number(v.size) || 100,
      face: pick(v.face, faces, "serif"), leading: pick(v.leading, leadings, "normal"), width: pick(v.width, widths, "medium"),
      align: v.align === "left" ? "left" : "justify", layout: pick(v.layout, layouts, "page"),
    };
  },
  write: (v: Look) => { try { localStorage.setItem("kb.reader", JSON.stringify(v)); } catch { /* a private window */ } },
};
/* Puts a look on the book: the face, spacing and alignment inside its pages, and how they're laid out. */
function dress(r: Rendition, look: Look) {
  r.themes.select(look.paper);
  r.themes.fontSize(`${look.size}%`);
  r.themes.override("font-family", faces[look.face].css, true);
  r.themes.override("line-height", leadings[look.leading].value, true);
  r.themes.override("text-align", look.align, true);
}

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
  const opened = useRef<{ book: EpubBook; toc: NavItem[] } | null>(null);
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
    moved.current = true;
    setTurning(true);
    void (dir > 0 ? r.next() : r.prev()).finally(() => setTimeout(() => setTurning(false), 60));
  }, []);

  /* Arrow keys and Page Up/Down turn pages; Escape closes. Heard inside the book's own frame too. */
  const keys = useCallback((e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") turn(1);
    if (e.key === "ArrowLeft" || e.key === "PageUp") turn(-1);
    if (e.key === "Escape") onCloseRef.current();
  }, [turn]);

  /* Keep the place: a moment after the page settles, and only once you've
     turned a page (opening a book, or failing to find your place, never moves it). */
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current || Math.abs(fraction - saved.current) < 0.005) return;
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
        /* The book's container first, by hand: the EPUB reader waits forever on a book that won't open, so the server's reason is shown instead. */
        const probe = await fetch(`${partsUrl(file)}META-INF/container.xml`, { cache: "no-store" });
        if (!probe.ok) {
          const said = await probe.json().catch(() => null) as { error?: string } | null;
          if (!cancelled) setProblem(probe.status === 202 ? "This book is still being made. Try again in a few minutes." : said?.error ?? "This book didn't open.");
          return;
        }
        const ePub = (await import("epubjs")).default as unknown as (url: string, options?: Record<string, unknown>) => EpubBook;
        book = ePub(partsUrl(file), { openAs: "directory" });
        /* And a limit, so a book that's damaged inside says so rather than spinning. */
        await Promise.race([book.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("took too long")), 45_000))]);
        if (cancelled || !stage.current) return;
        const toc = flatten((await book.loaded.navigation).toc ?? []);
        const first = prefs.read();
        const r = book.renderTo(stage.current, { width: "100%", height: "100%", flow: first.layout === "scroll" ? "scrolled-doc" : "paginated", spread: first.layout === "spread" ? "auto" : "none", allowScriptedContent: false });
        rendition.current = r;
        opened.current = { book, toc };
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
        dress(r, prefs.read());
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
    return () => { cancelled = true; rendition.current?.destroy(); rendition.current = null; opened.current = null; book?.destroy(); };
  }, [file, opening, keys]);

  useEffect(() => {
    const r = rendition.current;
    if (r) dress(r, look);
    prefs.write(look);
  }, [look]);
  /* Layout changes re-lay the book (scrolling or pages, one or two). */
  const laidOut = useRef(look.layout);
  useEffect(() => {
    const r = rendition.current;
    if (!r || laidOut.current === look.layout) return;
    laidOut.current = look.layout;
    r.spread(look.layout === "spread" ? "auto" : "none");
    r.flow(look.layout === "scroll" ? "scrolled-doc" : "paginated");
  }, [look.layout]);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    addEventListener("keyup", keys);
    const lock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { removeEventListener("keyup", keys); document.body.style.overflow = lock; };
  }, [keys]);

  /* Seeking: what's at a point in the book (its chapter and a line of it), and going there. */
  const peek = useCallback(async (f: number): Promise<{ chapter: string; text: string } | null> => {
    const o = opened.current;
    if (!o) return null;
    const cfi = o.book.locations.cfiFromPercentage(Math.min(0.999, Math.max(0, f)));
    if (!cfi) return null;
    const href = o.book.spine.get(cfi)?.href?.split("#")[0] ?? "";
    const chapter = o.toc.filter((t) => t.href.split("#")[0].endsWith(href) || href.endsWith(t.href.split("#")[0])).at(0)?.label.trim() ?? "";
    let text = "";
    try {
      const range = await o.book.getRange(cfi);
      const node = range.startContainer;
      const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element)?.closest("p, li, blockquote, h1, h2, h3, h4, div");
      text = (el?.textContent ?? node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
    } catch { /* the line is a nicety */ }
    return { chapter, text };
  }, []);
  const seek = useCallback((f: number) => {
    const o = opened.current, r = rendition.current;
    if (!o || !r) return;
    // eslint-disable-next-line react-hooks/immutability -- only ever called from the seek bar's pointer and key handlers, never while rendering
    moved.current = true;
    const cfi = o.book.locations.cfiFromPercentage(Math.min(0.999, Math.max(0, f)));
    if (cfi) void r.display(cfi);
  }, []);

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
        <button className={`kb-reader-icon kb-aa${settings ? " kb-on" : ""}`} aria-expanded={settings} aria-label="Reading settings" title="Reading settings" onClick={() => setSettings((v) => !v)}>
          <span className="kb-small-a">A</span><span className="kb-big-a">a</span>
        </button>
      </> : null}
      <button className="kb-reader-icon" onClick={() => { location.href = `${fileUrl(file)}&download=1`; }} aria-label="Save a copy" title="Save a copy">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19h14" /></svg>
      </button>
    </header>
    {settings && file.format === "epub" ? <ReaderSettings look={look} onChange={(next) => setLook((l) => ({ ...l, ...next }))} onClose={() => setSettings(false)} /> : null}
    {file.format === "pdf"
      ? <iframe className="kb-reader-pdf" src={fileUrl(file)} title={title} />
      : <div className="kb-reader-page" style={{ "--kb-col": `${look.layout === "spread" ? Math.max(1100, widths[look.width].px) : widths[look.width].px}px` } as React.CSSProperties}
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { const s = touch.current; touch.current = null; if (s === null) return; const dx = e.changedTouches[0].clientX - s; if (Math.abs(dx) > 40) turn(dx < 0 ? 1 : -1); }}>
        <button className="kb-turn kb-turn-prev" aria-label="Previous page" onClick={() => turn(-1)}><svg viewBox="0 0 24 24" aria-hidden><path d="m14 6-6 6 6 6" /></svg></button>
        <div className="kb-leafwrap"><div ref={stage} className={`kb-reader-stage${turning ? " kb-turning" : ""}`} /></div>
        <button className="kb-turn kb-turn-next" aria-label="Next page" onClick={() => turn(1)}><svg viewBox="0 0 24 24" aria-hidden><path d="m10 6 6 6-6 6" /></svg></button>
        {!ready && !problem ? <div className="kb-reader-wait"><MorphLoader ink="#7d8f58" label="Opening the book" className="kb-reader-ink" /><p>Opening {title}</p></div> : null}
        {problem ? <div className="kb-reader-wait"><p>{problem}</p></div> : null}
      </div>}
    {file.format === "epub" ? <footer className="kb-reader-foot">
      <SeekBar fraction={fraction} ready={ready} peek={peek} onSeek={seek} />
      <span>{Math.round(fraction * 100)}%</span>
    </footer> : null}
  </div>;
  return host ? createPortal(view, host) : view;
}

/**
 * The book's length as a bar you can use: hover anywhere for the chapter
 * there and a line of it, click or drag to go. Arrow keys step it too.
 */
function SeekBar({ fraction, ready, peek, onSeek }: {
  fraction: number; ready: boolean; peek: (f: number) => Promise<{ chapter: string; text: string } | null>; onSeek: (f: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ f: number; x: number; w: number } | null>(null);
  const [shown, setShown] = useState<{ f: number; chapter: string; text: string } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  /* Where a seek is going, held until the book gets there, so the bar doesn't fall back meanwhile. */
  const [held, setHeld] = useState<{ to: number; from: number } | null>(null);
  const asked = useRef(0);
  const at = (clientX: number) => {
    const box = bar.current?.getBoundingClientRect();
    if (!box) return null;
    const f = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return { f, x: f * box.width, w: box.width };
  };
  /* What's there, a beat after the pointer settles (each look loads a chapter, so not on every pixel). */
  useEffect(() => {
    if (!hover || !ready) return;
    const ask = ++asked.current;
    const t = setTimeout(() => { void peek(hover.f).then((p) => { if (p && ask === asked.current) setShown({ f: hover.f, ...p }); }); }, 90);
    return () => clearTimeout(t);
  }, [hover, ready, peek]);
  const shownHere = shown && hover && Math.abs(shown.f - hover.f) < 0.03 ? shown : null;
  const left = hover ? Math.min(Math.max(hover.x, 150), Math.max(150, hover.w - 150)) : 0;
  const filled = drag ?? (held && held.from === fraction ? held.to : fraction);
  const go = (f: number) => { setHeld({ to: Math.min(1, Math.max(0, f)), from: fraction }); onSeek(f); };
  return <div ref={bar} className={`kb-seek${hover ? " kb-seeking" : ""}${drag !== null ? " kb-dragging" : ""}`} role="slider" tabIndex={0} aria-label="Place in the book"
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-valuetext={`${Math.round(fraction * 100)}%`}
    onPointerMove={(e) => { const p = at(e.clientX); if (!p) return; setHover(p); if (drag !== null) setDrag(p.f); }}
    onPointerLeave={() => { if (drag === null) { setHover(null); setShown(null); } }}
    onPointerDown={(e) => { const p = at(e.clientX); if (!p) return; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* dragging just ends at the bar's edge */ } setDrag(p.f); setHover(p); }}
    onPointerUp={(e) => { const p = at(e.clientX); if (p && drag !== null) go(p.f); setDrag(null); if (e.pointerType !== "mouse") { setHover(null); setShown(null); } }}
    onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); go(filled + (e.key === "ArrowRight" ? 0.02 : -0.02)); } }}>
    <span className="kb-seek-track"><span className="kb-seek-fill" style={{ width: `${filled * 100}%` }} />
      {hover ? <span className="kb-seek-ghost" style={{ width: `${hover.f * 100}%` }} /> : null}
    </span>
    <span className="kb-seek-thumb" style={{ left: `${filled * 100}%` }} />
    {hover ? <div className="kb-seek-peek" style={{ left }}>
      <b>{shownHere?.chapter || "\u00a0"}<span>{Math.round(hover.f * 100)}%</span></b>
      {shownHere?.text ? <p>{shownHere.text}</p> : <p className="kb-seek-wait">{ready ? "\u2026" : ""}</p>}
    </div> : null}
  </div>;
}

/** The reading settings: one panel for the page, the type and the layout. */
function ReaderSettings({ look, onChange, onClose }: { look: Look; onChange: (next: Partial<Look>) => void; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".kb-aa")) onClose(); };
    addEventListener("pointerdown", away);
    return () => removeEventListener("pointerdown", away);
  }, [onClose]);
  const row = <K extends keyof Look>(label: string, key: K, options: Record<string, { label: string }>) => <div className="kb-set-row" role="radiogroup" aria-label={label}>
    <span className="kb-set-label">{label}</span>
    <span className="kb-set-choices">{Object.entries(options).map(([v, o]) => <button key={v} role="radio" aria-checked={look[key] === v}
      onClick={() => onChange({ [key]: v } as Partial<Look>)}>{o.label}</button>)}</span>
  </div>;
  return <div ref={panel} className="kb-reader-settings" role="dialog" aria-label="Reading settings">
    <div className="kb-set-row" role="radiogroup" aria-label="Page">
      <span className="kb-set-label">Page</span>
      <span className="kb-set-papers">{(Object.keys(papers) as Paper[]).map((p) => <button key={p} role="radio" aria-checked={look.paper === p} aria-label={papers[p].label} title={papers[p].label}
        className="kb-swatch" style={{ "--sw": papers[p].bg, "--sw-ink": papers[p].ink } as React.CSSProperties} onClick={() => onChange({ paper: p })}><span>Aa</span></button>)}</span>
    </div>
    <div className="kb-set-row" aria-label="Text size">
      <span className="kb-set-label">Size</span>
      <span className="kb-set-size">
        <button aria-label="Smaller text" onClick={() => onChange({ size: Math.max(70, look.size - 10) })}>A</button>
        <input type="range" min={70} max={200} step={5} value={look.size} aria-label="Text size" onChange={(e) => onChange({ size: Number(e.target.value) })} />
        <button aria-label="Larger text" className="kb-big" onClick={() => onChange({ size: Math.min(200, look.size + 10) })}>A</button>
        <span className="kb-set-value">{look.size}%</span>
      </span>
    </div>
    {row("Font", "face", faces)}
    {row("Spacing", "leading", leadings)}
    {row("Width", "width", widths)}
    {row("Align", "align", { left: { label: "Left" }, justify: { label: "Justified" } })}
    {row("Layout", "layout", layouts)}
  </div>;
}
