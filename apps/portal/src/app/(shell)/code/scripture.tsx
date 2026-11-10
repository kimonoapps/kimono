"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Seal } from "@kimono/ui";
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
  return <div ref={ref} role="tooltip" className="cd-verse-tip" data-below={place?.below || undefined} onMouseEnter={onEnter} onMouseLeave={onLeave}
    style={{ left: place?.left ?? -9999, top: place?.top ?? -9999, visibility: place ? "visible" : "hidden" }}>{tip.body}</div>;
}

function LangSwitch({ lang, set, has = ["en", "fr"] }: { lang: Lang; set: (l: Lang) => void; has?: Lang[] }) {
  if (has.length < 2) return null;
  return <div className="cd-scrip-lang" role="radiogroup" aria-label="Translation">
    {has.map((l) => <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => set(l)}>{l.toUpperCase()}</button>)}
  </div>;
}

/* ── Quran ──────────────────────────────────────────────────────────────── */

function TafsirPanel({ id, verseKey, label }: { id: number; verseKey: string; label: string }) {
  const { data, failed } = useLoad<Tafsir>(`/api/v1/code/scripture/tafsir?id=${id}&key=${encodeURIComponent(verseKey)}`);
  if (failed) return <div className="cd-tafsir is-empty">The tafsir couldn&apos;t be loaded.</div>;
  if (!data) return <div className="cd-tafsir is-loading" aria-busy="true"><span /><span /><span /></div>;
  const covers = data.covers.length > 1 ? `${data.covers[0]}–${data.covers[data.covers.length - 1].split(":")[1]}` : data.covers[0] ?? label;
  if (!data.parts.length) return <div className="cd-tafsir is-empty">{data.name} has nothing on {covers}.</div>;
  const rtl = data.lang === "ar";
  return <div className="cd-tafsir" dir={rtl ? "rtl" : "ltr"} lang={data.lang}>
    <div className="cd-tafsir-head" dir="ltr">{data.name} on {covers}</div>
    {data.parts.map((part, n) => part.kind === "h" ? <h5 key={n}>{part.text}</h5>
      : part.kind === "ar" ? <p key={n} className="cd-ar" dir="rtl" lang="ar">{part.text}</p>
      : <p key={n} className={rtl ? "cd-ar is-prose" : undefined}>{part.text}</p>)}
  </div>;
}

export function QuranBlock({ source }: { source: string }) {
  const [ref, option] = source.trim().split(/\s+/);
  const { data, failed } = useLoad<Passage>(ref ? `/api/v1/code/scripture/quran?ref=${encodeURIComponent(ref)}` : null);
  const [lang, setLang] = useState<Lang>(() => firstLang(option));
  const [open, setOpen] = useState<number | null>(null);
  const tip = useTip();
  const label = data ? data.ref.replace("-", "–") : ref;

  const verse = useCallback((v: Verse, context: boolean) => <span key={v.key}
    className={`cd-verse${context ? " is-context" : ""}${tip.open === v.key ? " is-open" : ""}`}
    {...tip.bind(v.key, () => <><p lang={lang}>{v.translation[lang]}</p><small>{v.key} · {translators[lang]}</small></>)}>
    {v.arabic} <span className="cd-ayah" aria-label={`verse ${v.number}`}>{"۝"}{arabicDigits(v.number)}</span>{" "}
  </span>, [lang, tip]);

  if (failed) return <div className="cd-scrip is-failed">
    <div className="cd-scrip-head"><span className="cd-scrip-title">Quran {label}</span></div>
    <p className="cd-scrip-note">This passage couldn&apos;t be loaded.</p>
  </div>;
  if (!data) return <div className="cd-scrip is-loading" aria-busy="true">
    <div className="cd-scrip-head"><span className="cd-scrip-title">Quran {label}</span></div>
    <div className="cd-scrip-bars"><span /><span /></div>
  </div>;

  const [s, a] = data.ref.split(":");
  return <figure className="cd-scrip" lang="ar">
    <figcaption className="cd-scrip-head" lang={lang}>
      <button type="button" className="cd-scrip-title" title="Open on quran.com" onClick={() => window.open(`https://quran.com/${s}/${a}`, "_blank", "noopener,noreferrer")}>{data.chapter.name} <span>{label}</span></button>
      <span className="cd-scrip-name" lang="ar">{data.chapter.arabic}</span>
      <LangSwitch lang={lang} set={setLang} />
    </figcaption>
    <blockquote className="cd-ar cd-quran" dir="rtl">
      {data.before.map((v) => verse(v, true))}
      {data.verses.map((v) => verse(v, false))}
      {data.after.map((v) => verse(v, true))}
    </blockquote>
    <div className="cd-scrip-tafsirs" lang="en">
      <span>Tafsir</span>
      {data.tafsirs.map((t) => <button key={t.id} type="button" aria-pressed={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>{t.name}</button>)}
    </div>
    {open !== null ? <TafsirPanel id={open} verseKey={data.verses[0].key} label={label} /> : null}
    {tip.node}
  </figure>;
}

/* ── Hadith ─────────────────────────────────────────────────────────────── */

export function HadithBlock({ source }: { source: string }) {
  const [book, number, option] = source.trim().split(/\s+/);
  const n = Number(number);
  const { data, failed } = useLoad<Hadith>(book && n ? `/api/v1/code/scripture/hadith?book=${encodeURIComponent(book)}&n=${n}` : null);
  const [lang, setLang] = useState<Lang>(() => firstLang(option));
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
      <LangSwitch lang={shown} set={setLang} has={has} />
      {data.chapter ? <span className="cd-scrip-chapter">{data.chapter}</span> : null}
    </figcaption>
    {data.arabic
      ? <blockquote className="cd-ar cd-hadith" dir="rtl" lang="ar">
          <span className={`cd-verse${tip.open === "h" ? " is-open" : ""}`} {...tip.bind("h", () => <p lang={shown}>{translation}</p>)}>{data.arabic}</span>
        </blockquote>
      : <blockquote className="cd-hadith-text" lang={shown}>{translation}</blockquote>}
    {data.grades.length ? <ul className="cd-scrip-grades" aria-label="Grades">
      {data.grades.map((g) => <li key={g.name}><b>{g.grade}</b> {g.name}</li>)}
    </ul> : null}
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
