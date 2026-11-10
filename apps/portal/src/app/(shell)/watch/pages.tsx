"use client";

import { useEffect, useRef, useState } from "react";
import { airText, watchApi, type Card, type TitleView } from "./api";
import { cx, Img, TitleMark, useWatch } from "./bits";
import { PosterCard, viewOf } from "./home";
import { Icon } from "./icons";

/* ───── New & hot: what is coming for the shows this person follows ───── */

type Soon = { view: TitleView; date: string; when: string };

const future = (d: string | null | undefined) => Boolean(d && Date.parse(d) > Date.now());
function soonOf(view: TitleView): Soon | null {
  const season = view.seasons?.find((s) => future(s.airDate));
  if (season?.airDate) return { view, date: season.airDate, when: `Season ${season.number} arrives ${airText(season.airDate)}` };
  const next = view.tracker?.nextAirDate ?? view.title.nextAirDate;
  if (future(next)) return { view, date: next!, when: `New episode ${airText(next!)}` };
  return null;
}

export function HotPage({ ids }: { ids: string[] | null }) {
  const watch = useWatch();
  const [soon, setSoon] = useState<Soon[] | null>(null);
  const key = ids?.join(",") ?? "";
  useEffect(() => {
    if (!ids) return;
    let live = true;
    (async () => {
      const found: Soon[] = [];
      /* Three at a time: each is a title page. */
      const queue = ids.slice(0, 16);
      await Promise.all(Array.from({ length: 3 }, async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          const view = await viewOf(id).catch(() => null);
          if (!view) continue;
          watch.noteView(view);
          const s = soonOf(view);
          if (s) found.push(s);
        }
      }));
      if (live) setSoon(found.sort((a, b) => Date.parse(a.date) - Date.parse(b.date)));
    })();
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return <main className="kw-page">
    <h1>Coming soon</h1>
    {!soon ? <div className="kw-soon">{Array.from({ length: 2 }, (_, i) => <div key={i} style={{ display: "grid", gap: 10 }}>
      <div className="kw-sk" style={{ aspectRatio: "16/9" }} /><div className="kw-sk kw-sk-line" style={{ width: "50%" }} /><div className="kw-sk kw-sk-line" />
    </div>)}</div>
      : !soon.length ? <p className="kw-empty">Nothing announced yet for what you watch.</p>
        : <div className="kw-soon">{soon.map(({ view, date, when }) => {
          const t = view.title;
          const d = new Date(`${date}T12:00:00`);
          const on = watch.marksOf(t.id).reminding;
          return <article key={t.id}>
            <div className="kw-date">{d.toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}<b>{String(d.getDate()).padStart(2, "0")}</b></div>
            <div>
              <button className="kw-shot" aria-label={`${t.name} details`} style={{ display: "block", width: "100%" }} onClick={() => watch.openTitle(t.id)}><Img src={t.backdropLarge ?? t.backdrop} /></button>
              <div className="kw-row1">
                <TitleMark name={t.name} />
                <button className={cx("kw-stack", on && "kw-on")} onClick={() => watch.remind(t.id, !on, t.name)}><Icon name="bell" /><span>{on ? "Reminding" : "Remind me"}</span></button>
                <button className="kw-stack" onClick={() => watch.openTitle(t.id)}><Icon name="info" /><span>Info</span></button>
              </div>
              <div className="kw-when">{when}</div>
              {t.overview ? <p>{t.overview}</p> : null}
              <div className="kw-dots" style={{ marginTop: 8, fontSize: 13 }}>{t.genres.map((g) => <span key={g}>{g}</span>)}</div>
            </div>
          </article>;
        })}</div>}
  </main>;
}

/* ───── My list ───── */

export function ListPage({ cards }: { cards: Card[] | null }) {
  return <main className="kw-page">
    <h1>My list</h1>
    {!cards ? <div className="kw-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="kw-sk" style={{ aspectRatio: "2/3" }} />)}</div>
      : cards.length ? <div className="kw-grid">{cards.map((c) => <PosterCard key={c.id} card={c} poster />)}</div>
        : <p className="kw-empty">Titles you add show up here.</p>}
  </main>;
}

/* ───── Search: titles open on top of it ───── */

export function SearchPage({ onClose }: { onClose: () => void }) {
  const watch = useWatch();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Card[] | null>(null);
  const [asked, setAsked] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const control = new AbortController();
    const t = setTimeout(() => {
      watchApi.search(q.trim(), control.signal).then((r) => { setResults(r.results); setAsked(q.trim()); }).catch(() => { if (!control.signal.aborted) setResults([]); });
    }, q ? 320 : 0);
    return () => { clearTimeout(t); control.abort(); };
  }, [q]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector(".kw-sheet")) onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return <div className="kw-search">
    <div className="kw-sbar"><Icon name="search" /><input ref={input} type="search" placeholder="Titles, people, genres" autoComplete="off" value={q} onChange={(event) => { setQ(event.target.value); setResults(null); }} /><button className="kw-iconbtn" aria-label="Close search" onClick={onClose}><Icon name="close" /></button></div>
    {!results ? <>
      <div className="kw-sk kw-sk-line" style={{ width: "30%", height: 18, marginBottom: 14 }} />
      <div className="kw-slist">{Array.from({ length: 4 }, (_, i) => <div key={i} className="kw-sk" style={{ height: 80 }} />)}</div>
    </> : <>
      <h3>{asked ? (results.length ? "Results" : "Nothing matches that yet") : "Popular searches"}</h3>
      <div className="kw-slist">{results.slice(0, asked ? 30 : 8).map((c) => <button key={c.id} onClick={() => watch.openTitle(c.id)}>
        <Img src={c.backdrop ?? c.poster} />
        <span>{c.name}</span>
        <span className="kw-pl" role="button" aria-label={`Play ${c.name}`} onClick={(event) => { event.stopPropagation(); watch.play(c.id); }}><Icon name="play" /></span>
      </button>)}</div>
    </>}
  </div>;
}
