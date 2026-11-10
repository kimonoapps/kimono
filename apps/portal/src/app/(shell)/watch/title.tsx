"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { airText, labelOf, minutesText, watchApi, type Episode, type TitleView } from "./api";
import { alike, cx, Img, ListButton, RateButton, TitleMark, Top10, useTabTitle, useWatch } from "./bits";
import { Icon } from "./icons";

const aired = (e: Pick<Episode, "airDate">) => !e.airDate || Date.parse(e.airDate) <= Date.now();

/** A title's page, over whatever opened it: Home, a list, or search. */
export function TitleSheet({ id, onClose, refreshKey }: { id: string; onClose: () => void; refreshKey: number }) {
  const watch = useWatch();
  const [view, setView] = useState<TitleView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [tab, setTab] = useState<"eps" | "more">("eps");
  const [seasonLoading, setSeasonLoading] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const shown = useRef<number | undefined>(undefined);

  const apply = useCallback((next: TitleView) => {
    setView(next); setProblem(null); watch.noteView(next);
    if (!next.seasons) setTab("more");
  }, [watch]);
  const fail = (error: unknown) => setProblem(error instanceof Error ? error.message : "That didn't work.");
  const load = useCallback((season?: number) => watchApi.title(id, season).then(apply, fail), [id, apply]);

  useEffect(() => {
    watchApi.title(id).then(apply, fail);
    const frame = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(frame);
  }, [id, apply]);
  /* Back from the player: where they are has moved on. */
  useEffect(() => { if (refreshKey && shown.current !== refreshKey) { shown.current = refreshKey; void load(view?.season); } }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { setOn(false); setTimeout(onClose, 250); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector(".kw-player:not([hidden])")) close(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });

  const pickSeason = async (season: number) => {
    setSeasonLoading(true);
    await load(season);
    setSeasonLoading(false);
  };
  const setFillers = async (skip: boolean) => {
    try {
      await watchApi.setPrefs({ fillers: skip ? "skip" : "watch" });
      watch.toast(skip ? "Fillers will be skipped" : "Fillers will play");
      await load(view?.season);
    } catch { watch.toast("That didn't work."); }
  };

  const t = view?.title;
  useTabTitle(t?.name);
  const series = view ? Boolean(view.seasons) : false;
  return <div ref={sheet} className={cx("kw-sheet", on && "kw-on")} onClick={(event) => { if (event.target === sheet.current) close(); }}>
    <div className="kw-panel" role="dialog" aria-label={t?.name ?? "Title"}>
      <div className="kw-sh-top">
        {t ? <Img className="kw-hero-img" src={t.backdropLarge ?? t.backdrop ?? t.poster} eager /> : null}
        {t ? <TitleMark name={t.name} logo={t.logo} /> : null}
        <button className="kw-sh-close" aria-label="Close" onClick={close}><Icon name="close" /></button>
      </div>
      <div className="kw-sh-body">
        {problem && !view ? <div className="kw-problem"><p>{problem}</p><button className="kw-btn kw-tonal" onClick={() => void load()}>Try again</button></div>
          : !view || !t ? <SheetSkeleton />
            : <>
              <div className="kw-sh-cols">
                <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
                  <Meta view={view} />
                  <TopRank id={t.id} shelf={t.shelf} />
                  <Resume view={view} />
                  {view.tracker ? <Tracker view={view} /> : null}
                  {t.overview ? <p className="kw-desc">{t.overview}</p> : null}
                  <div className="kw-acts" style={{ position: "relative" }}>
                    <ListButton id={t.id} variant="act" />
                    <RateButton id={t.id} variant="act" />
                    {series && view.hasFillers ? <label className={cx("kw-act kw-switch-act", view.fillers === "skip" && "kw-on")}>
                      <input type="checkbox" checked={view.fillers === "skip"} onChange={(event) => void setFillers(event.target.checked)} /><i /><span>Skip fillers</span>
                    </label> : null}
                  </div>
                </div>
                <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                  {t.cast.length ? <p className="kw-kv">Cast: <span>{t.cast.slice(0, 4).join(", ")}</span></p> : null}
                  {t.genres.length ? <p className="kw-kv">Genres: <span>{t.genres.join(", ")}</span></p> : null}
                  {t.moods.length ? <p className="kw-kv">This {t.kind === "movie" ? "film" : "show"} is: <span>{t.moods.slice(0, 3).join(", ")}</span></p> : null}
                </div>
              </div>
              <div className="kw-tabs" role="tablist">
                {series ? <button role="tab" aria-selected={tab === "eps"} onClick={() => setTab("eps")}>Episodes</button> : null}
                <button role="tab" aria-selected={tab === "more" || !series} onClick={() => setTab("more")}>More like this</button>
              </div>
              <div>{series && tab === "eps" ? <Episodes view={view} loading={seasonLoading} pickSeason={pickSeason} /> : <MoreLikeThis id={t.id} shelf={t.shelf} />}</div>
            </>}
      </div>
    </div>
  </div>;
}

function SheetSkeleton() {
  return <div style={{ display: "grid", gap: 14, paddingTop: 8 }}>
    <div className="kw-sk kw-sk-line" style={{ width: "40%" }} />
    <div className="kw-sk" style={{ height: 44, width: 200 }} />
    <div className="kw-sk kw-sk-line" />
    <div className="kw-sk kw-sk-line" style={{ width: "80%" }} />
    {Array.from({ length: 3 }, (_, i) => <div key={i} className="kw-sk kw-sk-ep" />)}
  </div>;
}

function Meta({ view }: { view: TitleView }) {
  const t = view.title;
  const count = view.episodes?.length ?? 0;
  const length = !view.seasons ? minutesText(t.runtime)
    : view.layout && view.layout !== "seasons" ? `${count} episode${count === 1 ? "" : "s"}`
      : view.seasons.length > 1 ? `${view.seasons.length} seasons` : `${view.seasons[0]?.episodeCount ?? count} episodes`;
  return <div className="kw-meta">
    {view.badge ? <span className="kw-hi">{view.badge}</span> : null}
    {t.year ? <span>{t.year}</span> : null}
    {t.age ? <span className="kw-box">{t.age}</span> : null}
    {length ? <span>{length}</span> : null}
  </div>;
}

function TopRank({ id, shelf }: { id: string; shelf: string }) {
  const watch = useWatch();
  const top = watch.known().find((c) => c.id === id && c.top)?.top;
  if (!top) return null;
  return <div className="kw-rank"><Top10 />#{top} in {shelf === "Film" ? "Films" : shelf} today</div>;
}

function Resume({ view }: { view: TitleView }) {
  const watch = useWatch();
  const t = view.title;
  if (!view.playable) return <div className="kw-resume"><button className="kw-btn kw-primary" disabled style={{ opacity: .5 }}><Icon name="play" />Not available yet</button></div>;
  if (!view.seasons) {
    const r = view.resume && "fraction" in view.resume ? view.resume : null;
    const left = r && t.runtime ? Math.max(1, Math.round(t.runtime - r.position / 60)) : null;
    return <div className="kw-resume">
      <button className="kw-btn kw-primary" onClick={() => watch.play(t.id)}><Icon name="play" />{r ? "Resume" : "Play"}</button>
      <button className="kw-btn kw-tonal" onClick={() => watch.together(t.id, { season: 0, episode: 0, position: r?.position ?? 0 })}><Icon name="group" />Watch together</button>
      {r ? <small><span className="kw-bar"><i style={{ width: `${r.fraction * 100}%` }} /></span>{left ? `${left}m left` : null}</small> : null}
    </div>;
  }
  const r = view.resume && "season" in view.resume ? view.resume : null;
  const ep = r ? view.episodes?.find((e) => (e.season ?? view.season) === r.season && e.number === r.episode) : null;
  const label = r ? r.label ?? labelOf(view, r.season, r.episode) : "E1";
  const fraction = ep && r && ep.runtime ? Math.min(1, r.position / (ep.runtime * 60)) : 0;
  const at = r ? { season: r.season, episode: r.episode } : undefined;
  return <div className="kw-resume">
    <button className="kw-btn kw-primary" onClick={() => watch.play(t.id, at)}><Icon name="play" />{r?.started ? "Resume" : `Play ${label}`}</button>
    <button className="kw-btn kw-tonal" onClick={() => watch.together(t.id, { season: r?.season ?? 1, episode: r?.episode ?? 1, position: r?.started ? r.position : 0 })}><Icon name="group" />Watch together</button>
    {r?.started && ep ? <small>{label} “{ep.name}” {fraction > 0 ? <span className="kw-bar"><i style={{ width: `${fraction * 100}%` }} /></span> : null}{ep.runtime ? ` ${Math.max(1, Math.round(ep.runtime * (1 - fraction)))}m left` : ""}</small> : null}
  </div>;
}

function Tracker({ view }: { view: TitleView }) {
  const tr = view.tracker!;
  const later = view.seasons?.find((s) => s.number === tr.season + 1);
  const nextAir = tr.nextAirDate ?? view.title.nextAirDate;
  const after = later && aired(later) ? `Season ${later.number} is ready after that`
    : later?.airDate ? `Season ${later.number} arrives ${airText(later.airDate)}`
      : nextAir ? `Next episode ${airText(nextAir)}`
        : "That’s the end of the series so far";
  return <div className="kw-tracker">
    <div className="kw-lab"><b>{tr.left === 1 ? "Last episode" : tr.left === 0 ? "All caught up" : `${tr.left} episodes left`}{!view.layout || view.layout === "seasons" ? ` in Season ${tr.season}` : ""}</b><span>{after}</span></div>
    <div className="kw-segs">{tr.marks.map((m) => <i key={m.episode} className={cx(m.state === "done" && "kw-fin", m.state === "skip" && "kw-skip", m.state === "upcoming" && "kw-upcoming")}>
      {m.state === "open" && m.fraction > 0 ? <b style={{ width: `${m.fraction * 100}%` }} /> : null}
    </i>)}</div>
  </div>;
}

function Episodes({ view, loading, pickSeason }: { view: TitleView; loading: boolean; pickSeason: (season: number) => void }) {
  const watch = useWatch();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const drop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setShown(true));
    const away = (event: PointerEvent) => { if (!drop.current?.contains(event.target as Node)) { setOpen(false); setShown(false); } };
    document.addEventListener("pointerdown", away, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", away, true); };
  }, [open]);
  const seasons = view.seasons ?? [];
  const season = view.season ?? 1;
  const episodes = view.episodes ?? [];
  const r = view.resume && "season" in view.resume ? view.resume : null;
  const last = seasons[seasons.length - 1]?.number;
  const ended = /ended|canceled/i.test(view.title.status);
  const wide = typeof window !== "undefined" && matchMedia("(min-width: 900px)").matches;
  /* Only a show laid out by season has a picker; one season, or one long list, has none. */
  const picker = (!view.layout || view.layout === "seasons") && seasons.length > 0;
  const numberOf = (e: Episode) => (view.layout === "continuous" ? e.absolute ?? e.number : e.number);
  return <>
    <div className="kw-eps-head">
      {picker ? <div className="kw-sdrop" ref={drop}>
        <button className="kw-sbtn" aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen(!open); setShown(false); }}>Season {season}<Icon name="more" /></button>
        {open ? <div className={cx("kw-smenu", shown && "kw-on")} role="listbox">
          {seasons.map((s) => <button key={s.number} role="option" aria-selected={s.number === season} onClick={() => { setOpen(false); setShown(false); if (s.number !== season) pickSeason(s.number); }}>
            <Icon name="check" /><b>Season {s.number}</b><span>{s.episodeCount} episodes</span>
          </button>)}
        </div> : null}
      </div> : <h3>Episodes</h3>}
      <span className="kw-eps-count">{episodes.length} episodes</span>
    </div>
    <div>{loading ? Array.from({ length: 4 }, (_, i) => <div key={i} className="kw-sk kw-sk-ep" />) : episodes.map((e, i) => {
      const at = e.season ?? season;
      const now = r?.season === at && r.episode === e.number;
      const skipped = view.fillers === "skip" && e.filler;
      const out = aired(e);
      /* The last of a season; in one list, wherever a season ends. */
      const closes = i === episodes.length - 1 || (episodes[i + 1].season ?? season) !== at;
      const final = i === episodes.length - 1 && (picker ? at === last : true);
      const finale = closes && out && episodes.length > 1 ? (final && ended ? "FINALE" : "SEASON FINALE") : null;
      const go = () => { if (out) watch.play(view.title.id, { season: at, episode: e.number }); };
      return <div key={`${at}:${e.number}`} className={cx("kw-ep", now && "kw-now", skipped && "kw-skipped")} role="button" tabIndex={out ? 0 : -1} aria-disabled={!out} onClick={go} onKeyDown={(event) => { if (event.key === "Enter") go(); }}>
        <span className="kw-no">{numberOf(e)}</span>
        <div className="kw-th">
          <Img src={e.still ?? view.title.backdrop} />
          {e.fraction > 0 ? <div className="kw-bar"><i style={{ width: `${e.fraction * 100}%` }} /></div> : null}
          {out ? <span className="kw-pl"><Icon name="play" /></span> : null}
        </div>
        <div className="kw-tx">
          <b><em className="kw-et">{wide ? "" : `${numberOf(e)}. `}{e.name}{e.filler ? <span className="kw-ftag">Filler</span> : e.recap ? <span className="kw-ftag kw-mixed">Recap</span> : null}</em>
            <span>{skipped ? "Skipped" : !out && e.airDate ? airText(e.airDate) : e.runtime ? `${e.runtime}m` : ""}</span></b>
          {finale ? <span className="kw-flag">{finale}</span> : null}
          {e.overview ? <p>{e.overview}</p> : null}
        </div>
        <span />
      </div>;
    })}</div>
  </>;
}

function MoreLikeThis({ id, shelf }: { id: string; shelf: TitleView["title"]["shelf"] }) {
  const watch = useWatch();
  const cards = alike(watch.known(), id, shelf, 9);
  if (!cards.length) return <p className="kw-empty">Nothing like it yet.</p>;
  return <div className="kw-mlt">{cards.map((c) => <article key={c.id}>
    <button className="kw-shot" aria-label={c.name} onClick={() => watch.openTitle(c.id)}><Img src={c.backdrop ?? c.poster} /><span className="kw-t">{c.name}</span></button>
    <div className="kw-b"><div className="kw-top"><span className="kw-meta">{c.age ? <span className="kw-box">{c.age}</span> : null}{c.year}</span><ListButton id={c.id} variant="ring" /></div></div>
  </article>)}</div>;
}
