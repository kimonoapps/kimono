"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MorphLoader } from "@kimono/ui";
import Markdown, { type Components } from "react-markdown";
import { asBook, booksApi, BooksError, count, ratingLabel, stateLabel, verdictOf, type Book, type BookFileInfo, type FriendOnBook, type FriendReading, type Genre, type GenrePage as GenrePageData, type Home, type Page, type Rating, type ReadingFormat, type ShelfItem, type ShelfState } from "./api";
import { Book3D } from "./book3d";
import { Reader } from "./reader";

/*
 * 本 Kimono Books on the web: your reading, then shelves to browse, search
 * over everything, and a book's page as a sheet. Which tab and which book
 * are in the address, so a reload or a link opens the same place.
 */

type Tab = "home" | "shelf";

/* Your shelf, so a book you're reading says so wherever it shows up. The same
   book may come from another source than the one shelved: matched by key, or
   by title and the author's surname. */
const sameBook = (title: string, author: string) => `${title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 40)}|${(author.toLowerCase().split(/\s+/).pop() ?? "")}`;
const MyShelf = createContext<(b: Pick<Book, "key" | "title" | "authors">) => ShelfItem | undefined>(() => undefined);
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

function readPlace(): { tab: Tab; book: string | null; q: string; genre: string | null } {
  const p = new URLSearchParams(window.location.search);
  return { tab: p.get("tab") === "shelf" ? "shelf" : "home", book: p.get("b"), q: p.get("q") ?? "", genre: p.get("g") };
}
function writePlace(tab: Tab, book: string | null, q: string, push: boolean, genre: string | null = null) {
  const p = new URLSearchParams();
  if (tab !== "home") p.set("tab", tab);
  if (genre && tab === "home") p.set("g", genre);
  if (q) p.set("q", q);
  if (book) p.set("b", book);
  const url = `/books${p.size ? `?${p}` : ""}`;
  if (`${location.pathname}${location.search}` === url) return;
  if (push) history.pushState(null, "", url); else history.replaceState(null, "", url);
}

export function BooksApp({ accent, firstName }: { accent: string; firstName: string }) {
  const [tab, setTab] = useState<Tab>(() => readPlace().tab);
  const [open, setOpen] = useState<string | null>(() => readPlace().book);
  const [query, setQuery] = useState(() => readPlace().q);
  const [genre, setGenre] = useState<string | null>(() => readPlace().genre);
  const [home, setHome] = useState<Home | null>(null);
  const [shelf, setShelf] = useState<ShelfItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const say = useCallback((text: string) => setToast({ text, at: Date.now() }), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);

  const loadHome = useCallback(() => {
    booksApi.home().then((h) => { setHome(h); setShelf(h.shelf); setProblem(null); })
      .catch((e: unknown) => setProblem(e instanceof BooksError ? e.message : "Books couldn't load."));
  }, []);
  useEffect(loadHome, [loadHome]);

  useEffect(() => {
    const back = () => { const p = readPlace(); setTab(p.tab); setOpen(p.book); setQuery(p.q); setGenre(p.genre); };
    addEventListener("popstate", back);
    return () => removeEventListener("popstate", back);
  }, []);

  /* The new page renders as a transition, so the tab's pill moves first instead of waiting on it. */
  const go = (next: Tab) => { startTransition(() => { setTab(next); setGenre(null); }); setQuery(""); writePlace(next, null, "", true); root.current?.scrollTo({ top: 0, behavior: "smooth" }); };
  const browse = (id: string) => { startTransition(() => { setTab("home"); setGenre(id); }); setQuery(""); writePlace("home", null, "", true, id); root.current?.scrollTo({ top: 0 }); };
  const openBook = useCallback((key: string) => { setOpen(key); writePlace(tab, key, query, true, genre); }, [tab, query, genre]);
  const closeBook = useCallback(() => { setOpen(null); writePlace(tab, null, query, false, genre); }, [tab, query, genre]);
  const search = (q: string) => { setQuery(q); writePlace(tab, open, q, false, genre); };

  /* Shelf changes from anywhere (a book's page, a tile) land here. */
  const placed = useCallback((items: ShelfItem[] | null, note?: string) => {
    if (items) { setShelf(items); setHome((h) => h ? { ...h, shelf: items } : h); }
    if (note) say(note);
  }, [say]);

  const reading = useMemo(() => (shelf ?? []).filter((s) => s.state === "reading"), [shelf]);
  const mineOf = useMemo(() => {
    const byKey = new Map((shelf ?? []).map((s) => [s.key, s]));
    const byBook = new Map((shelf ?? []).map((s) => [sameBook(s.title, s.authors[0] ?? ""), s]));
    return (b: Pick<Book, "key" | "title" | "authors">) => byKey.get(b.key) ?? byBook.get(sameBook(b.title, b.authors[0] ?? ""));
  }, [shelf]);

  return <div ref={root} className="kb k-inkbar" style={{ "--kb-accent": accent } as React.CSSProperties} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}>
    <header className={cx("kb-top", scrolled && "kb-solid")}>
      <SearchField value={query} onChange={search} />
      <Tabs at={query ? null : tab === "home" ? 0 : tab === "shelf" ? 1 : null}>
        <button aria-current={tab === "home" && !query ? "page" : undefined} onClick={() => go("home")}>Discover</button>
        <button aria-current={tab === "shelf" && !query ? "page" : undefined} onClick={() => go("shelf")}>
          My shelf{shelf?.length ? <span className="kb-count">{shelf.length}</span> : null}
        </button>
      </Tabs>
    </header>

    <MyShelf.Provider value={mineOf}>
    <main className="kb-main">
      {query.trim()
        ? <SearchResults q={query.trim()} genres={home?.genres ?? []} onOpen={openBook} onBrowse={browse} />
        : tab === "shelf"
          ? <ShelfPage shelf={shelf} onOpen={openBook} onDiscover={() => go("home")} />
          : genre
            ? <GenrePage key={genre} id={genre} genres={home?.genres ?? []} onOpen={openBook} onBrowse={browse} onBack={() => go("home")} />
            : <HomePage home={home} reading={reading} firstName={firstName} problem={problem} onRetry={loadHome} onOpen={openBook} onShelf={() => go("shelf")} onBrowse={browse} onPlaced={placed} />}
    </main>

    {open ? <BookSheet key={open} bookKey={open} onClose={closeBook} onOpen={openBook} onPlaced={placed} /> : null}
    </MyShelf.Provider>
    <div className={cx("kb-toast", toast && "kb-on")} role="status" aria-live="polite">{toast?.text}</div>
  </div>;
}

/* ── Search ────────────────────────────────────────────────────────────── */

function SearchField({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const slash = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") { e.preventDefault(); input.current?.focus(); }
    };
    addEventListener("keydown", slash);
    return () => removeEventListener("keydown", slash);
  }, []);
  return <label className="kb-search">
    <svg viewBox="0 0 24 24" aria-hidden><path d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm9.5 16-4.8-4.8" /></svg>
    <input ref={input} type="search" value={value} placeholder="Title, author or ISBN" aria-label="Search books"
      onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { onChange(""); e.currentTarget.blur(); } }} />
    {value ? <button type="button" className="kb-clear" aria-label="Clear" onClick={() => { onChange(""); input.current?.focus(); }}>
      <svg viewBox="0 0 24 24" aria-hidden><path d="m7 7 10 10M17 7 7 17" /></svg>
    </button> : null}
  </label>;
}

function SearchResults({ q, genres, onOpen, onBrowse }: { q: string; genres: Genre[]; onOpen: (key: string) => void; onBrowse: (id: string) => void }) {
  const folded = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const matching = folded(q).length > 1 ? genres.filter((g) => folded(g.title).includes(folded(q)) || folded(q).split(" ").some((w) => w.length > 3 && folded(g.title).split(" ").includes(w))) : [];
  const [found, setFound] = useState<{ q: string; books: Book[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      booksApi.search(q, ctrl.signal).then((r) => { setFound({ q, books: r.books }); setProblem(null); })
        .catch((e: unknown) => { if (!ctrl.signal.aborted) setProblem(e instanceof BooksError ? e.message : "Search didn't answer."); });
    }, 280);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);
  const books = found?.books ?? [];
  const settled = found?.q === q;
  return <section className="kb-results" aria-busy={!settled}>
    <h1 className="kb-h1">{settled ? books.length ? <>Books for <em>{q}</em></> : <>Nothing for <em>{q}</em> yet</> : <>Looking for <em>{q}</em></>}</h1>
    {matching.length ? <div className="kb-genres kb-genres-inline">{matching.map((g) => <button key={g.id} className="kb-genre" onClick={() => onBrowse(g.id)}>Browse {g.title}<svg viewBox="0 0 24 24" aria-hidden><path d="m10 6 6 6-6 6" /></svg></button>)}</div> : null}
    {problem ? <p className="kb-note">{problem}</p> : null}
    {settled && !books.length && !problem ? <p className="kb-note">Try fewer words, the author&apos;s name, or the ISBN on the back. Books keeps looking and will have it if it turns up.</p> : null}
    <div className="kb-grid">
      {!settled && !books.length ? <Ghosts n={12} /> : books.map((b, i) => <div key={b.key} className="kb-cell" style={{ animationDelay: `${Math.min(i, 16) * 30}ms` }}>
        <Book3D book={b} onOpen={() => onOpen(b.key)} />
        <BookCaption book={b} />
      </div>)}
    </div>
  </section>;
}

/* ── Home ──────────────────────────────────────────────────────────────── */

function HomePage({ home, reading, firstName, problem, onRetry, onOpen, onShelf, onBrowse, onPlaced }: {
  home: Home | null; reading: ShelfItem[]; firstName: string; problem: string | null; onRetry: () => void; onOpen: (key: string) => void; onShelf: () => void;
  onBrowse: (id: string) => void; onPlaced: (items: ShelfItem[] | null, note?: string) => void;
}) {
  if (problem && !home) return <div className="kb-empty"><p>{problem}</p><button className="kb-btn kb-tonal" onClick={onRetry}>Try again</button></div>;
  const featured = home?.featured ?? null;
  return <>
    {featured ? <Featured book={featured} onOpen={onOpen} onPlaced={onPlaced} />
      : <section className="kb-hero kb-hello">
        <div className="kb-hero-body">
          <p className="kb-eyebrow">Kimono Books</p>
          <h1 className="kb-display">What are you reading, {firstName}?</h1>
          <p className="kb-lede">Find a book, put it on your shelf, and keep your place.</p>
        </div>
        <div className="kb-fan" aria-hidden>
          {(home?.rows[0]?.books ?? []).slice(0, 5).map((b, i) => <span key={b.key} className="kb-fan-book" style={{ "--i": i } as React.CSSProperties}><Book3D book={b} size="md" still eager /></span>)}
        </div>
      </section>}
    {home?.genres.length ? <nav className="kb-genres" aria-label="Genres">{home.genres.map((g) => <button key={g.id} className="kb-genre" onClick={() => onBrowse(g.id)}>{g.title}</button>)}</nav> : null}
    {reading.length ? <Shelf title="Continue reading" action={reading.length > 6 ? <button className="kb-link" onClick={onShelf}>Your shelf</button> : undefined}>
      {reading.map((s) => <div key={s.key} className="kb-slot">
        <Book3D book={asBook(s)} progress={s.fraction} onOpen={() => onOpen(s.key)} />
        <BookCaption book={asBook(s)} />
      </div>)}
    </Shelf> : null}
    {home?.friends.length ? <FriendsShelf friends={home.friends} onOpen={onOpen} /> : null}
    {!home ? <ShelfGhosts /> : home.rows.map((row, i) => <Shelf key={row.id} title={row.title} delay={i}
      action={home.genres.some((g) => g.id === row.id) ? <button className="kb-link" onClick={() => onBrowse(row.id)}>See all</button> : undefined}>
      {row.books.map((b, n) => <div key={b.key} className="kb-slot">
        <Book3D book={b} onOpen={() => onOpen(b.key)} badge={row.id === "trending" && n < 10 ? <span className="kb-rank">{n + 1}</span> : undefined} />
        <BookCaption book={b} />
      </div>)}
    </Shelf>)}
  </>;
}

/** Today's pick: one of the week's most read, on its own cover's colours, with enough said to want it. */
function Featured({ book, onOpen, onPlaced }: { book: Book; onOpen: (key: string) => void; onPlaced: (items: ShelfItem[] | null, note?: string) => void }) {
  const mine = useContext(MyShelf)(book);
  const [saving, setSaving] = useState(false);
  const want = async () => {
    setSaving(true);
    try { const { books } = await booksApi.setShelf(book.key, "want"); onPlaced(books, `Want to read · ${book.title}`); }
    catch { onPlaced(null, "That didn't save."); }
    setSaving(false);
  };
  return <section className="kb-hero kb-featured">
    {book.cover ? <div className="kb-featured-wash" aria-hidden style={{ backgroundImage: `url(${JSON.stringify(book.cover.replace("-M.jpg", "-L.jpg"))})` }} /> : null}
    <div className="kb-hero-body">
      <p className="kb-eyebrow">Today&apos;s pick{book.genres[0] ? ` · ${book.genres[0]}` : ""}</p>
      <h1 className="kb-display">{book.title}</h1>
      {book.authors.length ? <p className="kb-byline">by {book.authors.slice(0, 2).join(", ")}</p> : null}
      <p className="kb-featured-facts">
        {book.rating ? <span><Stars value={book.rating} /> {book.rating.toFixed(1)}</span> : null}
        {book.readers ? <span>{count(book.readers)} readers</span> : null}
        {book.year ? <span>{book.year}</span> : null}
        {book.pages ? <span>{book.pages} pages</span> : null}
      </p>
      {book.description ? <p className="kb-featured-about">{plain(book.description.split(/\n{2,}/)[0])}</p> : null}
      <div className="kb-btns">
        <button className="kb-btn kb-filled" onClick={() => onOpen(book.key)}>Open</button>
        {mine ? <span className="kb-featured-mine">{stateLabel[mine.state]}</span>
          : <button className="kb-btn kb-tonal" disabled={saving} onClick={want}>Want to read</button>}
      </div>
    </div>
    <div className="kb-hero-book"><Book3D book={book} size="xl" onOpen={() => onOpen(book.key)} eager /></div>
  </section>;
}

/** A genre: its most read books, a page at a time, with the other genres a tap away. */
function GenrePage({ id, genres, onOpen, onBrowse, onBack }: { id: string; genres: Genre[]; onOpen: (key: string) => void; onBrowse: (id: string) => void; onBack: () => void }) {
  const [pages, setPages] = useState<GenrePageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const fetchPage = useCallback((page: number) => booksApi.genre(id, page)
    .then((g) => { setPages((p) => [...p.slice(0, page), g]); setProblem(null); })
    .catch((e: unknown) => setProblem(e instanceof BooksError ? e.message : "That genre didn't load."))
    .finally(() => setLoading(false)), [id]);
  /* The first page on arrival (the page is keyed by genre, so it starts loading); more on asking. */
  useEffect(() => { void fetchPage(0); }, [fetchPage]);
  const load = (page: number) => { setLoading(true); void fetchPage(page); };
  const seen = new Set<string>();
  const books = pages.flatMap((p) => p.books).filter((b) => !seen.has(b.key) && seen.add(b.key));
  const title = pages[0]?.title ?? genres.find((g) => g.id === id)?.title ?? "";
  const more = pages.at(-1)?.more ?? false;
  return <section className="kb-results">
    <button className="kb-link kb-crumb" onClick={onBack}><svg viewBox="0 0 24 24" aria-hidden><path d="m14 6-6 6 6 6" /></svg>Discover</button>
    <h1 className="kb-display">{title}</h1>
    <nav className="kb-genres" aria-label="Genres">{genres.filter((g) => g.id !== id).map((g) => <button key={g.id} className="kb-genre" onClick={() => onBrowse(g.id)}>{g.title}</button>)}</nav>
    {problem ? <p className="kb-note">{problem}</p> : null}
    <div className="kb-grid">
      {!books.length && loading ? <Ghosts n={18} /> : books.map((b, i) => <div key={b.key} className="kb-cell" style={{ animationDelay: `${Math.min(i % 48, 16) * 30}ms` }}>
        <Book3D book={b} onOpen={() => onOpen(b.key)} />
        <BookCaption book={b} />
      </div>)}
    </div>
    {more ? <div className="kb-more"><button className="kb-btn kb-tonal" disabled={loading} onClick={() => load(pages.length)}>{loading ? <MorphLoader tone="plain" label="Loading" className="kb-ink" /> : "More"}</button></div> : null}
  </section>;
}

function Shelf({ title, children, delay = 0, action }: { title: ReactNode; children: ReactNode; delay?: number; action?: ReactNode }) {
  const rail = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const measure = () => { const r = rail.current; if (r) setEdge({ start: r.scrollLeft < 8, end: r.scrollLeft + r.clientWidth > r.scrollWidth - 8 }); };
  useEffect(measure, []);
  const page = (dir: 1 | -1) => rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.85, behavior: "smooth" });
  return <section className="kb-shelf" style={{ animationDelay: `${Math.min(delay, 6) * 70}ms` }}>
    <div className="kb-shelf-head"><h2>{title}</h2>{action}</div>
    <div className="kb-rail-wrap">
      <button className="kb-page kb-prev" aria-label="Back" hidden={edge.start} onClick={() => page(-1)}><svg viewBox="0 0 24 24" aria-hidden><path d="m14 6-6 6 6 6" /></svg></button>
      <div ref={rail} className="kb-rail" onScroll={measure}>{children}</div>
      <button className="kb-page kb-next" aria-label="More" hidden={edge.end} onClick={() => page(1)}><svg viewBox="0 0 24 24" aria-hidden><path d="m10 6 6 6-6 6" /></svg></button>
    </div>
  </section>;
}

function BookCaption({ book }: { book: Pick<Book, "key" | "title" | "authors" | "rating" | "readers"> }) {
  const mine = useContext(MyShelf)(book);
  if (mine?.state === "reading") return <span className="kb-caption">
    <span className="kb-cap-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(mine.fraction * 100)}><span style={{ width: `${Math.max(mine.fraction * 100, 3)}%` }} /></span>
    <span className="kb-cap-title">{book.title}</span>
    <span className="kb-cap-continue">Continue reading · {Math.round(mine.fraction * 100)}%</span>
  </span>;
  return <span className="kb-caption">
    <span className="kb-cap-title">{book.title}</span>
    <span className="kb-cap-author">{book.authors[0] ?? " "}</span>
    {book.rating ? <span className="kb-cap-meta"><Star />{book.rating.toFixed(1)}{book.readers ? <span> · {count(book.readers)} readers</span> : null}</span> : null}
  </span>;
}

/** What friends are reading: each book with the friend's portrait on it and what they made of it. */
function FriendsShelf({ friends, onOpen }: { friends: FriendReading[]; onOpen: (key: string) => void }) {
  return <Shelf title="Friends are reading">
    {friends.map((f) => <div key={`${f.username}:${f.book.key}`} className="kb-slot">
      <Book3D book={f.book} onOpen={() => onOpen(f.book.key)} progress={f.state === "reading" ? f.fraction : undefined}
        badge={<Face person={f} />} />
      <span className="kb-caption">
        <span className="kb-cap-title">{f.book.title}</span>
        <span className="kb-cap-who"><b>{f.name.split(/\s+/)[0]}</b> · {verdictOf(f).toLowerCase()}</span>
      </span>
    </div>)}
  </Shelf>;
}

/* A description's Markdown, kept to what a blurb needs: paragraphs, emphasis, lists and quotes. Headings read as bold lines; links, pictures and raw HTML never render. */
const blurbParts: Components = Object.fromEntries(["h1", "h2", "h3", "h4", "h5", "h6"].map((h) => [h, ({ children }: { children?: ReactNode }) => <p><strong>{children}</strong></p>])) as Components;
const blurbAllowed = ["p", "strong", "em", "ul", "ol", "li", "blockquote", "br", "h1", "h2", "h3", "h4", "h5", "h6"];
function Blurb({ text }: { text: string }) {
  return <Markdown components={blurbParts} allowedElements={blurbAllowed} unwrapDisallowed skipHtml>{text}</Markdown>;
}
/** A description as plain words, for a line of it. */
const plain = (md: string) => md.replace(/^#+\s*/gm, "").replace(/^\s*[-*+]\s+/gm, "").replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim();

/** Discover and My shelf: one pill slides to the chosen tab, rather than each tab filling and unfilling on its own. */
function Tabs({ at, children }: { at: number | null; children: ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  const ink = useRef<HTMLSpanElement>(null);
  /* Moves the pill under a tab: at once when it's clicked, not when the page catches up. */
  const place = useCallback((index: number | null) => {
    const pill = ink.current;
    const buttons = [...(nav.current?.querySelectorAll("button") ?? [])];
    const button = index === null ? null : buttons[index];
    buttons.forEach((b) => b.classList.toggle("kb-on", b === button));
    if (!pill) return;
    if (!button) { pill.style.opacity = "0"; return; }
    pill.style.transform = `translateX(${button.offsetLeft}px)`;
    pill.style.width = `${button.offsetWidth}px`;
    pill.style.opacity = "1";
    /* No slide on the first paint: it starts where it belongs, and slides from then on. */
    if (!pill.style.transition) requestAnimationFrame(() => { pill.style.transition = "transform .38s var(--ease-out), width .38s var(--ease-out), opacity .2s"; });
  }, []);
  useEffect(() => {
    place(at);
    const watch = new ResizeObserver(() => place(at));
    if (nav.current) watch.observe(nav.current);
    return () => watch.disconnect();
  }, [at, children, place]);
  return <nav ref={nav} className="kb-tabs" aria-label="Books"
    onClickCapture={(e) => { const i = [...(nav.current?.querySelectorAll("button") ?? [])].findIndex((b) => b.contains(e.target as Node)); if (i >= 0) place(i); }}>
    <span ref={ink} className="kb-tab-ink" aria-hidden />
    {children}
  </nav>;
}

/** A portrait, or their initial on a tone of their own when there's none. */
function Face({ person, size = 30 }: { person: { name: string; username: string; picture: string | null }; size?: number }) {
  const [broken, setBroken] = useState(false);
  let h = 0;
  for (const c of person.username) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return <span className="kb-face" style={{ width: size, height: size, "--hue": h % 360 } as React.CSSProperties} title={person.name}>
    {person.picture && !broken ? <img src={person.picture} alt="" onError={() => setBroken(true)} /> : <span>{(person.name.trim()[0] ?? "?").toUpperCase()}</span>}
  </span>;
}

/** Your friends who have this book, and what they made of it. */
function FriendsOnBook({ friends }: { friends: FriendOnBook[] }) {
  const loved = friends.filter((f) => f.rating === "love").length;
  const summary = friends.length === 1
    ? `${friends[0].name.split(/\s+/)[0]} ${verdictOf(friends[0]).toLowerCase().replace(/^read it$/, "read it")}`
    : `${friends.length} friends${loved ? ` · ${loved} loved it` : ""}`;
  return <section className="kb-friends" aria-label="Friends">
    <div className="kb-friends-head">
      <span className="kb-faces">{friends.slice(0, 5).map((f) => <Face key={f.username} person={f} size={32} />)}</span>
      <span>{summary}</span>
    </div>
    <ul className="kb-friend-list">
      {[...friends].sort((a, b) => Number(!!b.review) - Number(!!a.review)).map((f) => <li key={f.username} className={cx(f.review && "kb-reviewed")}>
        <Face person={f} size={40} />
        <span className="kb-friend-name">{f.name}</span>
        <span className={cx("kb-verdict", f.rating && `kb-${f.rating}`)}>{f.rating ? <RatingIcon rating={f.rating} /> : null}{verdictOf(f)}</span>
        {f.review ? <ReviewText text={f.review} /> : null}
      </li>)}
    </ul>
  </section>;
}

/** A review, folded to a few lines until you ask for the rest. */
function ReviewText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280 || text.split("\n").length > 4;
  return <div className="kb-review-text">
    <div className={cx(long && !open && "kb-folded")}>{text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</div>
    {long ? <button className="kb-link" onClick={() => setOpen(!open)}>{open ? "Less" : "More"}</button> : null}
  </div>;
}

const REVIEW_MAX = 5000;

/** Your review: a quiet "Write a review" until you start; then yours, as friends see it, to edit or take down. */
function YourReview({ review, onSave }: { review: string | null; onSave: (text: string | null) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(review ?? "");
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 420)}px`;
  }, [draft, editing]);
  const save = async (text: string | null) => {
    setSaving(true);
    const ok = await onSave(text);
    setSaving(false);
    if (ok) setEditing(false);
  };
  if (!editing) return review
    ? <section className="kb-my-review" aria-label="Your review">
      <div className="kb-my-review-head"><span>Your review</span><button className="kb-link" onClick={() => { setDraft(review); setEditing(true); }}>Edit</button></div>
      <ReviewText text={review} />
    </section>
    : <button className="kb-write-review" onClick={() => { setDraft(""); setEditing(true); }}>
      <svg viewBox="0 0 24 24" aria-hidden><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Zm10-12 3 3" /></svg>Write a review
    </button>;
  const text = draft.trim();
  return <form className="kb-review-form" onSubmit={(e) => { e.preventDefault(); if (text) void save(text); }}>
    <textarea ref={area} autoFocus value={draft} maxLength={REVIEW_MAX} placeholder="What did you think?" aria-label="Your review"
      onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text) void save(text); if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }} />
    <div className="kb-review-actions">
      {review ? <button type="button" className="kb-link kb-danger" disabled={saving} onClick={() => void save(null)}>Take down</button> : null}
      {draft.length > REVIEW_MAX - 400 ? <span className="kb-count">{REVIEW_MAX - draft.length}</span> : null}
      <span className="kb-grow" />
      <button type="button" className="kb-btn" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
      <button type="submit" className="kb-btn kb-filled" disabled={saving || !text || text === review}>{saving ? <MorphLoader tone="plain" ink="#000000" label="Saving" className="kb-ink" /> : review ? "Save" : "Post"}</button>
    </div>
  </form>;
}

/** How much you liked it: the same three round buttons as Watch. */
function RateBook({ rating, onRate }: { rating: Rating | null; onRate: (r: Rating | null) => void }) {
  return <div className="kb-rate" role="group" aria-label="How was it?">
    <span className="kb-rate-label">{rating ? ratingLabel[rating] : "How was it?"}</span>
    {(["down", "up", "love"] as Rating[]).map((r) => <button key={r} className={cx("kb-rate-btn", `kb-${r}`)} aria-pressed={rating === r}
      aria-label={ratingLabel[r]} title={ratingLabel[r]} onClick={() => onRate(rating === r ? null : r)}><RatingIcon rating={r} /></button>)}
  </div>;
}

function RatingIcon({ rating }: { rating: Rating }) {
  if (rating === "love") return <svg viewBox="0 0 24 24" aria-hidden><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>;
  const up = <path d="M7 11v9H4v-9h3Zm0 0 4-7c1.7 0 2.6 1.2 2.2 2.8L12.6 10H18a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 17 20H7" />;
  return <svg viewBox="0 0 24 24" aria-hidden style={rating === "down" ? { transform: "rotate(180deg)" } : undefined}>{up}</svg>;
}

/* ── My shelf ──────────────────────────────────────────────────────────── */

const shelfOrder: ShelfState[] = ["reading", "want", "read"];
const shelfTitle: Record<ShelfState, string> = { reading: "Reading now", want: "Want to read", read: "Read" };

function ShelfPage({ shelf, onOpen, onDiscover }: { shelf: ShelfItem[] | null; onOpen: (key: string) => void; onDiscover: () => void }) {
  const [only, setOnly] = useState<ShelfState | null>(null);
  if (!shelf) return <ShelfGhosts />;
  if (!shelf.length) return <div className="kb-empty kb-empty-shelf">
    <div className="kb-empty-books" aria-hidden><span /><span /><span /></div>
    <h1 className="kb-h1">Your shelf is empty</h1>
    <p className="kb-note">Books you want to read, are reading and have read live here, and on your profile.</p>
    <button className="kb-btn kb-filled" onClick={onDiscover}>Find a book</button>
  </div>;
  const by = (s: ShelfState) => shelf.filter((b) => b.state === s);
  return <>
    <div className="kb-segments" role="tablist" aria-label="Shelf">
      <button role="tab" aria-selected={only === null} onClick={() => setOnly(null)}>All <span>{shelf.length}</span></button>
      {shelfOrder.map((s) => <button key={s} role="tab" aria-selected={only === s} onClick={() => setOnly(s)} disabled={!by(s).length}>{shelfTitle[s]} <span>{by(s).length}</span></button>)}
    </div>
    {shelfOrder.filter((s) => (only === null || only === s) && by(s).length).map((s, i) => <section key={s} className="kb-shelf kb-mine" style={{ animationDelay: `${i * 70}ms` }}>
      <div className="kb-shelf-head"><h2>{shelfTitle[s]}</h2></div>
      <div className="kb-grid">
        {by(s).map((b) => <div key={b.key} className="kb-cell">
          <Book3D book={asBook(b)} progress={s === "reading" ? b.fraction : undefined} onOpen={() => onOpen(b.key)} />
          <span className="kb-caption">
            <span className="kb-cap-title">{b.title}</span>
            <span className="kb-cap-author">{b.authors[0] ?? " "}</span>
            {s === "reading" ? <span className="kb-cap-meta">{Math.round(b.fraction * 100)}% in</span> : null}
          </span>
        </div>)}
      </div>
      
    </section>)}
  </>;
}

/* ── A book's page ─────────────────────────────────────────────────────── */

function BookSheet({ bookKey, onClose, onOpen, onPlaced }: { bookKey: string; onClose: () => void; onOpen: (key: string) => void; onPlaced: (items: ShelfItem[] | null, note?: string) => void }) {
  const [page, setPage] = useState<Page | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [saving, setSaving] = useState<ShelfState | "off" | null>(null);
  const [more, setMore] = useState(false);
  const [files, setFiles] = useState<BookFileInfo[] | null>(null);
  const [prefers, setPrefers] = useState<ReadingFormat | null>(null);
  const [reading, setReading] = useState<BookFileInfo | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);

  useEffect(() => {
    booksApi.book(bookKey).then(setPage).catch((e: unknown) => setProblem(e instanceof BooksError ? e.message : "This book didn't open."));
    booksApi.files(bookKey).then((r) => { setFiles(r.files); setPrefers(r.prefers); }).catch(() => setFiles([]));
  }, [bookKey]);

  const close = useCallback(() => { setLeaving(true); setTimeout(onClose, 220); }, [onClose]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".kb-reader")) close(); };
    addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    sheet.current?.focus();
    return () => { removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [close]);

  /* The big book leans toward the pointer. */
  const lean = (e: React.PointerEvent) => {
    const el = tilt.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--ry", `${((e.clientX - r.left) / r.width - 0.5) * 26}deg`);
    el.style.setProperty("--rx", `${-((e.clientY - r.top) / r.height - 0.5) * 14}deg`);
  };
  const rest = () => { tilt.current?.style.removeProperty("--ry"); tilt.current?.style.removeProperty("--rx"); };

  const place = async (state: ShelfState | null) => {
    if (!page) return;
    setSaving(state ?? "off");
    try {
      const { books } = await booksApi.setShelf(page.book.key, state);
      /* The shelf as the server keeps it: back on Reading, that's the place you'd reached. */
      const kept = books.find((b) => b.key === page.book.key);
      setPage({ ...page, shelf: state ? { ...page.shelf, state, fraction: kept?.fraction ?? 0, rating: kept?.rating ?? page.shelf?.rating ?? null } : null });
      onPlaced(books, state ? `${stateLabel[state]} · ${page.book.title}` : "Taken off your shelf");
    } catch (e) {
      onPlaced(null, e instanceof BooksError ? e.message : "That didn't save.");
    } finally { setSaving(null); }
  };

  const rate = async (rating: Rating | null) => {
    if (!page) return;
    const before = page.shelf;
    setPage({ ...page, shelf: { ...before, state: before?.state ?? "read", fraction: before?.fraction ?? 1, rating } });
    try {
      const r = await booksApi.rate(page.book.key, rating);
      setPage((p) => p ? { ...p, shelf: r.shelf } : p);
      const { books } = await booksApi.shelf();
      onPlaced(books, rating ? `${ratingLabel[rating]} · ${page.book.title}` : undefined);
    } catch {
      setPage((p) => p ? { ...p, shelf: before } : p);
      onPlaced(null, "That didn't save.");
    }
  };

  const review = async (text: string | null) => {
    if (!page) return false;
    try {
      const r = await booksApi.review(page.book.key, text);
      setPage((p) => p ? { ...p, shelf: r.shelf } : p);
      const { books } = await booksApi.shelf();
      onPlaced(books, r.shelf?.review ? "Review saved" : "Review taken down");
      return true;
    } catch (e) {
      onPlaced(null, e instanceof BooksError ? e.message : "That didn't save.");
      return false;
    }
  };

  const setFraction = async (fraction: number) => {
    if (!page) return;
    const r = await booksApi.progress(page.book.key, fraction).catch(() => null);
    if (!r) return;
    setPage({ ...page, shelf: { ...page.shelf, state: r.state, fraction: r.fraction, rating: page.shelf?.rating ?? null } });
    const { books } = await booksApi.shelf();
    onPlaced(books, r.state === "read" ? `Finished · ${page.book.title}` : undefined);
  };

  const b = page?.book;
  const description = b?.description ?? "";
  const long = description.length > 520;
  return <div className={cx("kb-scrim", leaving && "kb-leaving")} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div ref={sheet} className="kb-sheet k-inkbar" role="dialog" aria-modal="true" aria-label={b?.title ?? "Book"} tabIndex={-1}>
      <button className="kb-close" onClick={close} aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden><path d="m7 7 10 10M17 7 7 17" /></svg></button>
      {problem ? <div className="kb-empty"><p>{problem}</p></div> : !b ? <SheetGhost /> : <>
        <div className="kb-detail">
          <div ref={tilt} className="kb-stage" onPointerMove={lean} onPointerLeave={rest}>
            <Book3D book={b} size="xl" still progress={page.shelf?.state === "reading" ? page.shelf.fraction : undefined} eager />
          </div>
          <div className="kb-info">
            {b.genres.length ? <p className="kb-eyebrow">{b.genres.slice(0, 3).join(" · ")}</p> : null}
            <h1 className="kb-display">{b.title}</h1>
            {b.subtitle ? <p className="kb-subtitle">{b.subtitle}</p> : null}
            {b.authors.length ? <p className="kb-byline">by {b.authors.join(", ")}</p> : null}
            <dl className="kb-facts">
              {b.rating ? <div><dt>Rating</dt><dd><Stars value={b.rating} /> {b.rating.toFixed(1)}{b.ratings ? <small> ({count(b.ratings)})</small> : null}</dd></div> : null}
              {b.readers ? <div><dt>Readers</dt><dd>{count(b.readers)}</dd></div> : null}
              {b.year ? <div><dt>First published</dt><dd>{b.year}</dd></div> : null}
              {b.pages ? <div><dt>Pages</dt><dd>{b.pages}</dd></div> : null}
              {b.publisher ? <div><dt>Publisher</dt><dd>{b.publisher}</dd></div> : null}
            </dl>
            <FileActions files={files} prefers={prefers} onPrefers={setPrefers} onRead={setReading} />
            <ShelfChoice current={page.shelf?.state ?? null} saving={saving} onChoose={place} />
            {page.shelf?.state === "reading" ? <PlaceControl key={page.shelf.fraction} fraction={page.shelf.fraction} pages={b.pages} onSave={setFraction} /> : null}
            <RateBook rating={page.shelf?.rating ?? null} onRate={rate} />
            <YourReview key={page.book.key} review={page.shelf?.review ?? null} onSave={review} />
            {page.friends.length ? <FriendsOnBook friends={page.friends} /> : null}
            {description ? <div className={cx("kb-about", long && !more && "kb-folded")}>
              <Blurb text={description} />
            </div> : null}
            {long ? <button className="kb-link" onClick={() => setMore(!more)}>{more ? "Less" : "More"}</button> : null}
            {b.isbns[0] ? <p className="kb-isbn">ISBN {b.isbns[0]}</p> : null}
          </div>
        </div>
        {page.byAuthor.length ? <Shelf title={`More by ${b.authors[0]}`}>{page.byAuthor.map((x) => <div key={x.key} className="kb-slot"><Book3D book={x} size="sm" onOpen={() => onOpen(x.key)} /><BookCaption book={x} /></div>)}</Shelf> : null}
        {reading ? <Reader bookKey={b.key} title={b.title} author={b.authors[0] ?? ""} file={reading} startAt={page.shelf?.state === "reading" ? page.shelf.fraction : 0}
          onClose={() => setReading(null)} onProgress={(fraction) => { setPage((p) => p ? { ...p, shelf: { ...p.shelf, state: fraction >= 0.98 ? "read" : "reading", fraction, rating: p.shelf?.rating ?? null } } : p); booksApi.shelf().then((r) => onPlaced(r.books)).catch(() => {}); }} /> : null}
        {page.similar.length ? <Shelf title="If you like this">{page.similar.map((x) => <div key={x.key} className="kb-slot"><Book3D book={x} size="sm" onOpen={() => onOpen(x.key)} /><BookCaption book={x} /></div>)}</Shelf> : null}
      </>}
    </div>
  </div>;
}

/**
 * Reading it here. While Books looks for a copy, the button carries Kimono's
 * ink loader; with one, it reads (and a copy can be saved beside it); without
 * one, it stays, and says so when pressed, instead of quietly missing.
 */
/** A converted EPUB: made by Kimono from the book's PDF. */
const madeFromPdf = (f: BookFileInfo) => f.source === "converted";

/**
 * Read, and the copy to save. When a book comes both as an EPUB and a PDF,
 * the first Read asks which you'd rather (and remembers, everywhere you
 * read); after that a line under the buttons says which this is, with the
 * other a tap away.
 */
function FileActions({ files, prefers, onPrefers, onRead }: {
  files: BookFileInfo[] | null; prefers: ReadingFormat | null; onPrefers: (f: ReadingFormat | null) => void; onRead: (f: BookFileInfo) => void;
}) {
  const [missing, setMissing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [remember, setRemember] = useState(true);
  const usable = (files ?? []).filter((f) => f.readable && !f.preparing);
  const epub = usable.find((f) => f.format === "epub") ?? null;
  const pdf = usable.find((f) => f.format === "pdf") ?? null;
  const making = (files ?? []).find((f) => f.format === "epub" && f.preparing) ?? null;
  const both = Boolean(epub && pdf);
  const best = both ? (prefers === "pdf" ? pdf : epub) : epub ?? pdf ?? null;
  const other = both ? (best === epub ? pdf : epub) : null;
  const copy = pdf ?? files?.find((f) => f !== best && !madeFromPdf(f)) ?? best;
  const sizeOf = (f: BookFileInfo) => f.size ? ` · ${f.size > 1_048_576 ? `${(f.size / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}` : "";
  const looking = files === null;
  const read = () => {
    if (!best) { if (!looking) setMissing(true); return; }
    if (both && !prefers) { setAsking(true); return; }
    onRead(best);
  };
  const choose = (format: ReadingFormat) => {
    const file = format === "epub" ? epub : pdf;
    setAsking(false);
    if (remember) { onPrefers(format); void booksApi.setFormat(format).catch(() => {}); }
    if (file) onRead(file);
  };
  const what = (f: BookFileInfo) => f.format === "pdf" ? "PDF, the original pages" : madeFromPdf(f) ? "EPUB, made from the PDF" : "EPUB";
  return <>
    <div className="kb-btns kb-files">
      <button className={cx("kb-btn kb-filled", looking && "kb-looking", !looking && !best && "kb-absent")}
        aria-busy={looking} aria-expanded={both && !prefers ? asking : undefined} onClick={read}>
        {looking ? <MorphLoader tone="plain" ink="#000000" label="Looking for a copy" className="kb-ink" /> : <svg viewBox="0 0 24 24" aria-hidden><path d="M12 6.5C10 5 7.5 4.5 4 5v13c3.5-.5 6 0 8 1.5 2-1.5 4.5-2 8-1.5V5c-3.5-.5-6 0-8 1.5Zm0 0V19.5" /></svg>}
        {best?.sample ? "Preview" : "Read"}
      </button>
      {copy ? <button className="kb-btn kb-tonal" title="Save a copy" onClick={() => { location.href = `/api/v1/books/file?f=${encodeURIComponent(copy.address)}&format=${copy.format}&download=1`; }}>
        <svg viewBox="0 0 24 24" aria-hidden><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19h14" /></svg>
        {copy.format.toUpperCase()}{sizeOf(copy)}</button> : null}
    </div>
    {best && !asking && (prefers || !both) ? <p className="kb-format-line">
      {what(best)}{madeFromPdf(best) ? <span className="kb-format-note"> · the text reflows to your screen; tables and pictures may sit differently</span> : null}
      {other ? <> · <button className="kb-link" onClick={() => onRead(other)}>Read the {other.format.toUpperCase()} instead</button></> : null}
      {!both && making ? <> · an EPUB is being made from it</> : null}
    </p> : null}
    {asking && epub && pdf ? <div className="kb-format" role="group" aria-label="How would you like to read it?">
      <p className="kb-format-q">This book comes two ways. How would you like to read it?</p>
      <div className="kb-format-options">
        <button className="kb-format-option" onClick={() => choose("epub")}>
          <span className="kb-format-name">EPUB</span>
          <span>Text that fits your screen and your size, your place kept on every device and a Kimono Read.{madeFromPdf(epub) ? " Made from the PDF by Kimono, so tables and pictures may sit differently." : ""}</span>
        </button>
        <button className="kb-format-option" onClick={() => choose("pdf")}>
          <span className="kb-format-name">PDF</span>
          <span>The original pages, exactly as printed. Best on a big screen.</span>
        </button>
      </div>
      <label className="kb-format-remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember for every book</label>
    </div> : null}
    {missing ? <div className="kb-missing" role="status">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M12 6.5C10 5 7.5 4.5 4 5v13c3.5-.5 6 0 8 1.5 2-1.5 4.5-2 8-1.5V5c-3.5-.5-6 0-8 1.5Z" /><path d="m9 10 6 6m0-6-6 6" /></svg>
      <span><b>Not here to read yet.</b> Kimono has no copy of this book. Put it on your shelf and it&apos;ll be ready to open when one turns up.</span>
      <button className="kb-missing-x" aria-label="Dismiss" onClick={() => setMissing(false)}><svg viewBox="0 0 24 24" aria-hidden><path d="m7 7 10 10M17 7 7 17" /></svg></button>
    </div> : null}
  </>;
}

/** Want to read · Reading · Read: an expressive segmented choice; the chosen one rounds out. */
function ShelfChoice({ current, saving, onChoose }: { current: ShelfState | null; saving: ShelfState | "off" | null; onChoose: (s: ShelfState | null) => void }) {
  return <div className="kb-choice" role="group" aria-label="On your shelf">
    {(["want", "reading", "read"] as ShelfState[]).map((s) => <button key={s} aria-pressed={current === s} disabled={saving !== null}
      onClick={() => onChoose(current === s ? null : s)} className={cx(saving === s && "kb-saving")}>
      {current === s ? <svg viewBox="0 0 24 24" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg> : null}
      {stateLabel[s]}
    </button>)}
  </div>;
}

/** "On page 219 of 288", or "76% in" when the book's length isn't known. */
const placeLabel = (f: number, pages: number | null) => pages ? `On page ${Math.min(pages, Math.max(1, Math.floor(f * pages)))} of ${pages}` : `${Math.round(f * 100)}% in`;

/**
 * Your place: shown, and changed only on purpose. Update opens a small
 * field (a page when the book's length is known, else a percent) with
 * Save and Cancel, so nothing moves by brushing past it.
 */
function PlaceControl({ fraction, pages, onSave }: { fraction: number; pages: number | null; onSave: (f: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState(() => String(pages ? Math.min(pages, Math.max(1, Math.floor(fraction * pages))) : Math.round(fraction * 100)));
  const [saving, setSaving] = useState(false);
  const value = Number(typed);
  const valid = typed !== "" && Number.isInteger(value) && value >= 0 && value <= (pages ?? 100);
  const save = async () => {
    if (!valid) return;
    setSaving(true);
    await onSave(pages ? value / pages : value / 100);
    setSaving(false);
    setEditing(false);
  };
  return <div className="kb-place">
    {editing
      ? <form className="kb-place-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label>
          <span>{pages ? "Page" : "Percent"}</span>
          <input autoFocus inputMode="numeric" value={typed} aria-invalid={!valid} onChange={(e) => setTyped(e.target.value.replace(/\D/g, "").slice(0, 5))}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }} />
          <em>{pages ? `of ${pages}` : "%"}</em>
        </label>
        <button type="button" className="kb-btn kb-tonal" onClick={() => setEditing(false)}>Cancel</button>
        <button type="submit" className="kb-btn kb-filled" disabled={!valid || saving}>Save</button>
      </form>
      : <>
        <div className="kb-place-now">
          <b>{placeLabel(fraction, pages)}</b>
          <span className="kb-cap-progress"><span style={{ width: `${Math.max(fraction * 100, 2)}%` }} /></span>
        </div>
        <button className="kb-btn kb-tonal" onClick={() => setEditing(true)}>Update</button>
      </>}
  </div>;
}

/* ── Small parts ───────────────────────────────────────────────────────── */

function Progress({ fraction }: { fraction: number }) {
  return <div className="kb-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
    <span style={{ width: `${Math.max(fraction * 100, 2)}%` }} /><em>{Math.round(fraction * 100)}%</em>
  </div>;
}

function Star() {
  return <svg className="kb-star" viewBox="0 0 24 24" aria-hidden><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z" /></svg>;
}

function Stars({ value }: { value: number }) {
  return <span className="kb-stars" aria-label={`${value.toFixed(1)} out of 5`}>
    {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ "--f": Math.max(0, Math.min(1, value - i)) } as React.CSSProperties}><Star /></span>)}
  </span>;
}

function Ghosts({ n }: { n: number }) {
  return <>{Array.from({ length: n }, (_, i) => <div key={i} className="kb-cell"><span className="kb-ghost" style={{ animationDelay: `${i * 60}ms` }} /><span className="kb-ghost-line" /><span className="kb-ghost-line kb-short" /></div>)}</>;
}

function ShelfGhosts() {
  return <>{[0, 1, 2].map((r) => <section key={r} className="kb-shelf"><div className="kb-shelf-head"><span className="kb-ghost-line kb-title" /></div>
    <div className="kb-rail">{Array.from({ length: 8 }, (_, i) => <div key={i} className="kb-slot"><span className="kb-ghost" style={{ animationDelay: `${(r * 8 + i) * 40}ms` }} /></div>)}</div></section>)}</>;
}

function SheetGhost() {
  return <div className="kb-detail"><div className="kb-stage"><span className="kb-ghost kb-ghost-xl" /></div>
    <div className="kb-info"><span className="kb-ghost-line kb-title" /><span className="kb-ghost-line" /><span className="kb-ghost-line kb-short" /></div></div>;
}
