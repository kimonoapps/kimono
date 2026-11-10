"use client";

import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { InkCard, Seal } from "@kimono/ui";
import { Scroller } from "@/components/scroller";
import type { Hadith, Passage, Tafsir, Verse } from "@/lib/code/scripture";

/*
 * Quran and hadith as Kimono AI cites them: it writes only the reference
 *
 *   ```quran            ```hadith
 *   7:80-81 fr          abudawud 4462 fr
 *   ```                 ```
 *
 * and this shows the real text from published sources (see lib/code/scripture).
 * The verses cited are in full ink, a verse either side in grey for context;
 * hovering or tapping a verse shows its translation, English or French; the
 * tafsirs open beneath.
 */

type Lang = "en" | "fr";
const translators: Record<Lang, string> = { en: "Saheeh International", fr: "Muhammad Hamidullah" };
const sunnahSlug: Record<string, string> = { nawawi: "nawawi40", qudsi: "qudsi40" };

/* A card that breaks shows its reference instead, never taking the chat down with it. */
export class ScriptureBoundary extends Component<{ label: string; children: ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() { return { broken: true }; }
  componentDidCatch(error: unknown) { console.warn("A Quran or hadith card failed:", error); }
  render() {
    if (!this.state.broken) return this.props.children;
    return <div className="cd-scrip is-failed"><div className="cd-scrip-head"><span className="cd-scrip-title">{this.props.label}</span></div><p className="cd-scrip-note">This couldn&apos;t be shown.</p></div>;
  }
}

/* Where a text was taken from, under it: the source's name, linking to it. */
function SourceLine({ source, detail }: { source?: { name: string; url: string } | null; detail?: string }) {
  if (!source?.url) return null;
  return <button type="button" className="cd-scrip-source" title={source.url} onClick={() => window.open(source.url, "_blank", "noopener,noreferrer")}>
    From {source.name}{detail ? <> · {detail}</> : null}
  </button>;
}

/* Fetched once per page: a chat re-renders often while a reply streams in. */
const loaded = new Map<string, Promise<unknown>>();
function load<T>(url: string): Promise<T> {
  let hit = loaded.get(url);
  if (!hit) {
    hit = fetch(url).then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
    hit.catch(() => loaded.delete(url));
    loaded.set(url, hit);
  }
  return hit as Promise<T>;
}
function useLoad<T>(url: string | null): { data: T | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; data: T | null; failed: boolean }>({ url: null, data: null, failed: false });
  useEffect(() => {
    if (!url) return;
    let live = true;
    load<T>(url).then((data) => { if (live) setState({ url, data, failed: false }); }, () => { if (live) setState({ url, data: null, failed: true }); });
    return () => { live = false; };
  }, [url]);
  return state.url === url ? state : { data: null, failed: false };
}

const firstLang = (option?: string): Lang => option === "fr" || option === "en" ? option : typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
const arabicDigits = (n: number) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

/* ── The translation that floats over what's hovered or tapped ─────────── */

type Tip = { id: string; rect: DOMRect; body: ReactNode };
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pinned, setPinned] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = () => { if (closing.current) clearTimeout(closing.current); closing.current = null; };
  const show = (id: string, el: HTMLElement, body: ReactNode) => { hold(); setTip({ id, rect: el.getClientRects()[0] ?? el.getBoundingClientRect(), body }); };
  const hide = (soon = true) => { hold(); if (pinned) return; if (soon) closing.current = setTimeout(() => setTip(null), 140); else setTip(null); };
  useEffect(() => {
    if (!tip) return;
    const away = () => { setPinned(false); setTip(null); };
    /* a tap anywhere but a verse or the translation puts it away */
    const outside = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.(".cd-verse, .cd-verse-tip")) away(); };
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("scroll", away, true); window.removeEventListener("resize", away); document.removeEventListener("pointerdown", outside); };
  }, [tip]);
  /* hover for a mouse, a tap (or Enter) pins it until tapped again or elsewhere */
  const bind = (id: string, body: () => ReactNode) => ({
    tabIndex: 0,
    role: "button",
    "aria-expanded": tip?.id === id,
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { if (!pinned) show(id, e.currentTarget, body()); },
    onMouseLeave: () => hide(),
    onFocus: (e: React.FocusEvent<HTMLElement>) => { if (!pinned) show(id, e.currentTarget, body()); },
    onBlur: () => { setPinned(false); hide(false); },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (pinned && tip?.id === id) { setPinned(false); setTip(null); return; }
      setPinned(true); show(id, e.currentTarget, body());
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => { if (e.key === "Escape") { setPinned(false); setTip(null); } },
  });
  const node = tip ? <TipCard tip={tip} onEnter={hold} onLeave={() => hide()} /> : null;
  return { bind, node, open: tip?.id ?? null };
}

function TipCard({ tip, onEnter, onLeave }: { tip: Tip; onEnter: () => void; onLeave: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth;
    const left = Math.min(Math.max(12, tip.rect.left + tip.rect.width / 2 - w / 2), vw - w - 12);
    const below = tip.rect.top - h - 10 < 8;
    setPlace({ left, top: below ? tip.rect.bottom + 10 : tip.rect.top - h - 10, below });
  }, [tip]);
  return <div ref={ref} role="tooltip" className="cd-verse-tip k-inkbar" data-below={place?.below || undefined} onMouseEnter={onEnter} onMouseLeave={onLeave}
    style={{ left: place?.left ?? -9999, top: place?.top ?? -9999, visibility: place ? "visible" : "hidden" }}>{tip.body}</div>;
}

/* Which translation (EN or FR), and a swap between the Arabic first (the translation on hover) and the translation first (the Arabic on hover). */
function ReadSwitch({ lang, set, has = ["en", "fr"], swapped, swap }: { lang: Lang; set: (l: Lang) => void; has?: Lang[]; swapped: boolean; swap: (() => void) | null }) {
  return <div className="cd-scrip-controls">
    {swap ? <button type="button" className="cd-scrip-swap" aria-pressed={swapped} title={swapped ? "Show the Arabic first" : "Show the translation first"} aria-label={swapped ? "Show the Arabic first" : "Show the translation first"} onClick={swap}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7h11l-3-3M16 13H5l3 3" /></svg>
    </button> : null}
    {has.length > 1 ? <div className="cd-scrip-lang" role="radiogroup" aria-label="Translation">
      {has.map((l) => <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => set(l)}>{l.toUpperCase()}</button>)}
    </div> : null}
  </div>;
}

/* What the reader picked, for every card: their translation, and whether they read it first. */
const keptLang = (): Lang | null => { try { const l = localStorage.getItem("kimono:scripture-lang"); return l === "en" || l === "fr" ? l : null; } catch { return null; } };
const keepLang = (l: Lang) => { try { localStorage.setItem("kimono:scripture-lang", l); } catch {} };
const keptSwap = () => { try { return localStorage.getItem("kimono:scripture-first") === "translation"; } catch { return false; } };
const keepSwap = (on: boolean) => { try { localStorage.setItem("kimono:scripture-first", on ? "translation" : "arabic"); } catch {} };

/* The tafsir last read, opened first next time. */
const lastTafsir = (ids: number[]) => { try { const n = Number(localStorage.getItem("kimono:tafsir")); if (ids.includes(n)) return n; } catch {} return ids[0]; };
const keepTafsir = (id: number) => { try { localStorage.setItem("kimono:tafsir", String(id)); } catch {} };

/* ── Quran ──────────────────────────────────────────────────────────────── */

const span = (keys: string[]) => keys.length > 1 ? `${keys[0]}–${keys[keys.length - 1].split(":")[1]}` : keys[0] ?? "";

/* One tafsir on the verses it explains together (Ibn Kathir often takes two or three at once): those verses, then its words. */
function TafsirSection({ id, verseKey, passage, cited, lang, first }: { id: number; verseKey: string; passage: Passage; cited: string[]; lang: Lang; first: boolean }) {
  const { data, failed } = useLoad<Tafsir>(`/api/v1/code/scripture/tafsir?id=${id}&key=${encodeURIComponent(verseKey)}&v=3`);
  if (failed) return <section className="cd-tafsir-part is-empty">The tafsir on {verseKey} couldn&apos;t be loaded.</section>;
  if (!data) return first ? <section className="cd-tafsir-part is-loading" aria-busy="true"><span /><span /><span /></section> : null;
  /* a group already shown under an earlier verse of the passage isn't shown again */
  const opener = data.covers.find((k) => cited.includes(k));
  if (opener && opener !== verseKey) return null;
  const all = [...passage.before, ...passage.verses, ...passage.after];
  const shown = (data.covers.length ? data.covers : [verseKey]).map((k) => all.find((v) => v.key === k)).filter((v): v is Verse => !!v);
  const rtl = data.lang === "ar";
  return <section className="cd-tafsir-part">
    <div className="cd-tafsir-verses" lang="ar">
      <span className="cd-tafsir-on">{span(data.covers.length ? data.covers : [verseKey])}</span>
      {shown.map((v) => <div key={v.key} className="cd-tafsir-verse">
        <p className="cd-ar" dir="rtl">{v.arabic} <span className="cd-ayah">{arabicDigits(v.number)}</span></p>
        <p className="cd-tafsir-meaning" lang={lang}>{v.translation[lang]}</p>
      </div>)}
    </div>
    {!data.parts.length ? <p className="cd-tafsir-none">{data.name} has nothing on {span(data.covers.length ? data.covers : [verseKey])}.</p>
      : <div className="cd-tafsir-text" dir={rtl ? "rtl" : "ltr"} lang={data.lang}>
        {data.parts.map((part, n) => part.kind === "h" ? <h4 key={n}>{part.text}</h4>
          : part.kind === "gloss" ? <p key={n} className="cd-gloss"><span className="cd-ar" dir="rtl" lang="ar">{part.ar}</span> {part.text}</p>
          : part.kind === "ar" ? <p key={n} className="cd-ar is-quote" dir="rtl" lang="ar">{part.text}</p>
          : <p key={n} className={rtl ? "cd-ar is-prose" : undefined}>{part.text}</p>)}
      </div>}
    <footer className="cd-tafsir-foot"><SourceLine source={data.source} detail={data.edition} /></footer>
  </section>;
}

/* The tafsirs on a passage, in a dialog of their own: they run long. Which tafsir, and all the verses or one. */
function TafsirDialog({ passage, lang, onClose }: { passage: Passage; lang: Lang; onClose: () => void }) {
  const box = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLElement | null>(null);
  const cited = passage.verses.map((v) => v.key);
  const [id, setId] = useState(() => lastTafsir(passage.tafsirs.map((t) => t.id)));
  const [only, setOnly] = useState<string | null>(null);
  useEffect(() => { box.current?.showModal(); }, []);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [id, only]);
  const label = passage.ref.replace("-", "–");
  return <dialog ref={box} className="cd-tafsir-dialog" aria-labelledby="cd-tafsir-title" lang="en" onClose={onClose} onClick={(e) => { if (e.target === box.current) box.current?.close(); }}>
    <InkCard seed={`tafsir-${passage.ref}`} className="cd-tafsir-sheet">
      <header>
        <h2 id="cd-tafsir-title">Tafsir <span>{passage.chapter.name} {label}</span></h2>
        <button type="button" className="cd-tafsir-close" aria-label="Close" onClick={() => box.current?.close()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
        <div className="cd-tafsir-tabs" role="tablist" aria-label="Tafsir">
          {passage.tafsirs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={id === t.id} onClick={() => { setId(t.id); keepTafsir(t.id); }}>{t.name}{t.lang === "ar" ? <small lang="ar">عربي</small> : null}</button>)}
        </div>
        {cited.length > 1 ? <div className="cd-tafsir-pick" role="radiogroup" aria-label="Verses">
          <button type="button" role="radio" aria-checked={only === null} onClick={() => setOnly(null)}>All</button>
          {passage.verses.map((v) => <button key={v.key} type="button" role="radio" aria-checked={only === v.key} onClick={() => setOnly(v.key)}>{v.number}</button>)}
        </div> : null}
      </header>
      <Scroller viewRef={body} className="cd-tafsir-scroll" viewClassName="cd-tafsir-body">
        {(only ? [only] : cited).map((k, n) => <TafsirSection key={`${id}-${k}`} id={id} verseKey={k} passage={passage} cited={only ? [only] : cited} lang={lang} first={n === 0} />)}
      </Scroller>
    </InkCard>
  </dialog>;
}

/* A block's reference, then en or fr. */
const options = (rest: string[]) => ({ lang: rest.find((o) => o === "en" || o === "fr") });

export function QuranBlock({ source }: { source: string }) {
  const [ref, ...rest] = source.trim().split(/\s+/);
  const { lang: option } = options(rest);
  const { data, failed } = useLoad<Passage>(ref ? `/api/v1/code/scripture/quran?ref=${encodeURIComponent(ref)}&v=3` : null);
  const [lang, setLang] = useState<Lang>(() => option === "en" || option === "fr" ? option : keptLang() ?? firstLang(undefined));
  const [inverted, setInverted] = useState(keptSwap);
  const [reading, setReading] = useState(false);
  const tip = useTip();
  const label = data ? data.ref.replace("-", "–") : ref;

  const verse = useCallback((v: Verse, context: boolean) => inverted
    ? <p key={v.key} className={`cd-verse-line is-translation${context ? " is-context" : ""}`} lang={lang}>
        <span className="cd-ayah-num">{v.number}</span>
        <span className={`cd-verse${tip.open === v.key ? " is-open" : ""}`}
          {...tip.bind(v.key, () => <><p className="cd-ar cd-tip-ar" dir="rtl" lang="ar">{v.arabic}</p><small>{v.key}</small></>)}>{v.translation[lang]}</span>
      </p>
    : <p key={v.key} className={`cd-verse-line${context ? " is-context" : ""}`}>
        <span className={`cd-verse${tip.open === v.key ? " is-open" : ""}`}
          {...tip.bind(v.key, () => <><p lang={lang}>{v.translation[lang]}</p><small>{v.key} · {translators[lang]}</small></>)}>{v.arabic}</span>
        <span className="cd-ayah" aria-label={`verse ${v.number}`}>{arabicDigits(v.number)}</span>
      </p>, [lang, tip, inverted]);

  if (failed) return <div className="cd-scrip is-failed">
    <div className="cd-scrip-head"><span className="cd-scrip-title">Quran {label}</span></div>
    <p className="cd-scrip-note">This passage couldn&apos;t be loaded.</p>
  </div>;
  if (!data) return <div className="cd-scrip is-loading" aria-busy="true">
    <div className="cd-scrip-head"><span className="cd-scrip-title">Quran {label}</span></div>
    <div className="cd-scrip-bars"><span /><span /></div>
  </div>;

  const [s, a] = data.ref.split(":");
  return <figure className="cd-scrip" lang={inverted ? lang : "ar"}>
    <figcaption className="cd-scrip-head" lang={lang}>
      <button type="button" className="cd-scrip-title" title="Open on quran.com" onClick={() => window.open(`https://quran.com/${s}/${a}`, "_blank", "noopener,noreferrer")}>{data.chapter.name} <span>{label}</span></button>
      <span className="cd-scrip-name" lang="ar">{data.chapter.arabic}</span>
      <ReadSwitch lang={lang} set={(l) => { setLang(l); keepLang(l); }} swapped={inverted} swap={() => { setInverted(!inverted); keepSwap(!inverted); }} />
    </figcaption>
    <div className={inverted ? "cd-quran is-translation" : "cd-ar cd-quran"} dir={inverted ? "ltr" : "rtl"}>
      {data.before.map((v) => verse(v, true))}
      {data.verses.map((v) => verse(v, false))}
      {data.after.map((v) => verse(v, true))}
    </div>
    <div className="cd-scrip-foot" lang="en">
      <button type="button" className="cd-scrip-tafsir-toggle" aria-haspopup="dialog" onClick={() => setReading(true)}>
        Tafsir<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
      </button>
      <SourceLine source={data.source} detail={translators[lang]} />
    </div>
    {reading ? <TafsirDialog passage={data} lang={lang} onClose={() => setReading(false)} /> : null}
    {tip.node}
  </figure>;
}

/* ── Hadith ─────────────────────────────────────────────────────────────── */

export function HadithBlock({ source }: { source: string }) {
  const [book, number, ...rest] = source.trim().split(/\s+/);
  const { lang: option } = options(rest);
  const n = Number(number);
  const { data, failed } = useLoad<Hadith>(book && n ? `/api/v1/code/scripture/hadith?book=${encodeURIComponent(book)}&n=${n}&v=3` : null);
  const [lang, setLang] = useState<Lang>(() => option === "en" || option === "fr" ? option : keptLang() ?? firstLang(undefined));
  const [inverted, setInverted] = useState(keptSwap);
  const tip = useTip();
  const title = data ? `${data.bookName} ${data.number}` : `${book ?? ""} ${number ?? ""}`;

  if (failed) return <div className="cd-scrip is-failed">
    <div className="cd-scrip-head"><span className="cd-scrip-title">{title}</span></div>
    <p className="cd-scrip-note">This hadith couldn&apos;t be loaded.</p>
  </div>;
  if (!data) return <div className="cd-scrip is-loading" aria-busy="true">
    <div className="cd-scrip-head"><span className="cd-scrip-title">{title}</span></div>
    <div className="cd-scrip-bars"><span /><span /></div>
  </div>;

  const has = (["en", "fr"] as Lang[]).filter((l) => data.translation[l]);
  const shown: Lang = data.translation[lang] ? lang : "en";
  const translation = data.translation[shown] ?? "";
  return <figure className="cd-scrip is-hadith">
    <figcaption className="cd-scrip-head">
      <button type="button" className="cd-scrip-title" title="Open on sunnah.com" onClick={() => window.open(`https://sunnah.com/${sunnahSlug[data.book] ?? data.book}:${data.number}`, "_blank", "noopener,noreferrer")}>{data.bookName} <span>{data.number}</span></button>
      <ReadSwitch lang={shown} has={has} set={(l) => { setLang(l); keepLang(l); }} swapped={inverted} swap={data.arabic ? () => { setInverted(!inverted); keepSwap(!inverted); } : null} />
      {data.chapter ? <span className="cd-scrip-chapter">{data.chapter}</span> : null}
    </figcaption>
    {inverted && data.arabic
      ? <blockquote className="cd-hadith-text" lang={shown}>
          <span className={`cd-verse${tip.open === "h" ? " is-open" : ""}`} {...tip.bind("h", () => <p className="cd-ar cd-tip-ar" dir="rtl" lang="ar">{data.arabic}</p>)}>{translation}</span>
        </blockquote>
      : data.arabic
      ? <blockquote className="cd-ar cd-hadith" dir="rtl" lang="ar">
          <span className={`cd-verse${tip.open === "h" ? " is-open" : ""}`} {...tip.bind("h", () => <p lang={shown}>{translation}</p>)}>{data.arabic}</span>
        </blockquote>
      : <blockquote className="cd-hadith-text" lang={shown}>{translation}</blockquote>}
    {data.grades.length ? <ul className="cd-scrip-grades" aria-label="Grades">
      {data.grades.map((g) => <li key={g.name}><b>{g.grade}</b> {g.name}</li>)}
    </ul> : null}
    <div className="cd-scrip-foot is-quiet"><SourceLine source={data.source} detail="sunnah.com numbering" /></div>
    {tip.node}
  </figure>;
}

/* ── The notice before the first answer on Islam ───────────────────────── */

/* Asked once per page, and once acknowledged it stays so: every reply on Islam carries the block, only the first ever shows it. */
let noticeState: Promise<boolean> | null = null;
const seenNotice = () => noticeState ??= fetch("/api/v1/code/notices?notice=islam").then((r) => r.ok ? r.json() : { seen: false }).then((b: { seen: boolean }) => b.seen, () => { noticeState = null; return true; });

export function IslamNotice() {
  const [seen, setSeen] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { let live = true; seenNotice().then((s) => { if (live) setSeen(s); }); return () => { live = false; }; }, []);
  if (seen !== false) return null;
  const understand = async () => {
    setSaving(true);
    const ok = await fetch("/api/v1/code/notices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ notice: "islam" }) }).then((r) => r.ok, () => false);
    setSaving(false);
    if (ok) { noticeState = Promise.resolve(true); setSeen(true); window.dispatchEvent(new Event("kimono:notice-accepted")); }
  };
  return <aside className="cd-notice" role="note">
    <div>
      <p><b>Before you ask about Islam</b></p>
      <p>Use Kimono AI like a search engine, not a scholar. It doesn&apos;t give fiqh rulings of its own: it shows what the madhabs and scholars have said, with their sources. AI can still forget something, leave it out or narrow the scope, so stay vigilant and check what matters with a scholar you trust. We take many precautions against mistakes, but we can&apos;t guarantee there are none.</p>
      <p>If anything looks wrong or suspicious, give it a thumbs down straight away.</p>
    </div>
    <Seal type="button" compact disabled={saving} onClick={understand}>I understand</Seal>
  </aside>;
}
