"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { labelOf, watchApi, minutesText, type Card, type ContinueCard, type Home, type Shelf, type TitleView } from "./api";
import { CardArt, cx, Img, ListButton, RateButton, Rail, SkeletonRows, tagClass, TitleMark, Top10, useWatch } from "./bits";
import { Icon } from "./icons";

const chips: [Shelf, string][] = [["Series", "Series"], ["Film", "Films"], ["Anime", "Anime"]];

export function HomePage({ home, filter, setFilter, chipsAway, more, onMore, friends }: {
  /** The friends row, first under the hero. */
  friends?: ReactNode;
  home: Home | null; filter: Shelf | null; setFilter: (shelf: Shelf | null) => void; chipsAway: boolean;
  /** The next page of rows is on its way; `onMore` asks for it. */
  more: boolean; onMore: () => void;
}) {
  const watch = useWatch();
  const top = home?.rows.find((r) => r.kind === "top");
  const featured = home?.featured ?? null;
  const rank = featured ? top?.items.findIndex((c) => c.id === featured.id) ?? -1 : -1;
  const resumable = featured ? home?.rows.find((r) => r.kind === "continue")?.items.some((c) => c.id === featured.id) : false;
  return <main>
    <div className={cx("kw-chips", chipsAway && "kw-away")}>
      {chips.map(([shelf, label]) => <button key={shelf} className="kw-chip" aria-pressed={filter === shelf} onClick={() => setFilter(filter === shelf ? null : shelf)}>{label}</button>)}
    </div>
    <section className="kw-hero">
      {featured ? <>
        <div className="kw-backdrop-bleed"><Img src={featured.backdrop} eager /></div>
        <div className="kw-hero-card">
          <picture>
            {featured.poster ? <source media="(max-width: 899px)" srcSet={featured.poster} /> : null}
            <img src={featured.backdropLarge ?? featured.backdrop ?? ""} alt="" />
          </picture>
          <div className="kw-hero-body">
            <TitleMark name={featured.name} logo={featured.logo} />
            {rank >= 0 ? <div className="kw-rank"><Top10 />#{rank + 1}{filter ? ` in ${filter === "Film" ? "Films" : filter}` : ""} today</div> : null}
            <p className="kw-tagline">{featured.overview}</p>
            <div className="kw-btns">
              <button className="kw-btn kw-primary" onClick={() => watch.play(featured.id)}><Icon name="play" />{resumable ? "Resume" : "Play"}</button>
              <button className="kw-btn kw-tonal" onClick={() => watch.openTitle(featured.id)}><Icon name="info" />More info</button>
            </div>
          </div>
          {featured.age ? <div className="kw-hero-side"><span className="kw-maturity">{featured.age}</span></div> : null}
        </div>
      </> : <div className="kw-hero-card"><div className="kw-sk" style={{ position: "absolute", inset: 0, borderRadius: 0 }} /></div>}
    </section>
    <div className="kw-rows">
      {friends}
      {!home ? <SkeletonRows count={4} /> : home.rows.map((row, i) => <section key={row.id} className="kw-row" style={{ animationDelay: `${i * 70}ms` }}>
        <h2>{row.kind === "continue" ? `Continue watching for ${watch.firstName}` : row.title}</h2>
        <Rail label={row.title}>
          {row.items.map((card) => row.kind === "continue"
            ? <ContinueTile key={card.id} card={card as ContinueCard} />
            : row.kind === "top"
              ? <div key={card.id} className="kw-t10"><span className="kw-n">{card.top}</span><PosterCard card={card} plain poster /></div>
              : <PosterCard key={card.id} card={card} />)}
        </Rail>
      </section>)}
      {home && !home.rows.length ? <p className="kw-empty" style={{ paddingInline: "var(--gutter-l)" }}>Nothing here yet.</p> : null}
      {home?.next ? <>
        {more ? <SkeletonRows count={2} /> : null}
        <MoreRows key={`${filter ?? "all"}:${home.rows.length}`} onMore={onMore} />
      </> : null}
    </div>
    <HoverCard />
  </main>;
}

export function PosterCard({ card, plain, poster }: { card: Card; plain?: boolean; poster?: boolean }) {
  const watch = useWatch();
  return <button className="kw-card" data-card={card.id} aria-label={card.name} onClick={() => watch.openTitle(card.id)}>
    {card.badge && !plain ? <span className={tagClass(card.badge)}>{card.badge}</span> : null}
    {card.top && !plain ? <Top10 /> : null}
    <CardArt card={card} poster={poster} />
    <span className="kw-t">{card.name}</span>
  </button>;
}

function ContinueTile({ card }: { card: ContinueCard }) {
  const watch = useWatch();
  const series = card.kind === "series";
  const label = series ? `${card.label ?? `S${card.season}:E${card.episode}`} · ${card.left}m left` : `${card.left}m left`;
  return <div className="kw-cw">
    <button className="kw-shot" aria-label={card.name} onClick={() => watch.openTitle(card.id)}>
      <Img src={card.backdrop ?? card.poster} />
    </button>
    <div className="kw-bar"><i style={{ width: `${Math.max(4, card.fraction * 100)}%` }} /></div>
    <div className="kw-meta"><div><b>{card.name}</b>{label}</div><button className="kw-iconbtn" aria-label={`Resume ${card.name}`} onClick={() => watch.play(card.id, series ? { season: card.season, episode: card.episode } : undefined)}><Icon name="play" /></button></div>
  </div>;
}

/* ───── The hover card: wide screens with a mouse, after a moment on a card ───── */

const views = new Map<string, Promise<TitleView>>();
export const viewOf = (id: string) => {
  let known = views.get(id);
  if (!known) { known = watchApi.title(id); views.set(id, known); known.catch(() => views.delete(id)); setTimeout(() => views.delete(id), 60_000); }
  return known;
};

function HoverCard() {
  const watch = useWatch();
  const [at, setAt] = useState<{ card: Card; style: CSSProperties } | null>(null);
  const [on, setOn] = useState(false);
  const [view, setView] = useState<TitleView | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const capable = matchMedia("(hover: hover) and (min-width: 900px)");
    const hide = () => { clearTimeout(timer.current); setOn(false); };
    const over = (event: MouseEvent) => {
      if (!capable.matches) return;
      const target = event.target as HTMLElement;
      if (box.current?.contains(target)) return;
      const el = target.closest<HTMLElement>(".kw-rows .kw-card");
      clearTimeout(timer.current);
      if (!el) return;
      timer.current = setTimeout(() => {
        const id = el.dataset.card;
        const card = watch.known().find((c) => c.id === id);
        if (!card) return;
        const r = el.getBoundingClientRect();
        const w = Math.max(300, r.width * 1.45);
        const x = Math.min(Math.max(r.left + r.width / 2 - w / 2, 12), innerWidth - w - 12);
        setView(null);
        setAt({ card, style: { width: w, left: x, top: Math.max(12, r.top + r.height / 2 - (w * 9) / 16 / 2 - 30) } });
        setOn(true);
        viewOf(card.id).then((v) => { setView((now) => now ?? (v.title.id === card.id ? v : null)); watch.noteView(v); }).catch(() => {});
      }, 520);
    };
    const root = document.querySelector(".kw");
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) hide(); };
    document.addEventListener("mouseover", over);
    document.addEventListener("click", away);
    root?.addEventListener("scroll", hide, { passive: true });
    return () => { document.removeEventListener("mouseover", over); document.removeEventListener("click", away); root?.removeEventListener("scroll", hide); clearTimeout(timer.current); };
  }, [watch]);

  const card = at?.card;
  const v = view && card && view.title.id === card.id ? view : null;
  const count = v?.episodes?.length ?? 0;
  const meta = !v ? "" : !v.seasons ? minutesText(v.title.runtime)
    : v.layout && v.layout !== "seasons" ? `${count} episode${count === 1 ? "" : "s"}`
      : v.seasons.length > 1 ? `${v.seasons.length} seasons` : `${v.seasons[0]?.episodeCount ?? count} episodes`;
  const resume = v && v.tracker && v.resume && "season" in v.resume ? v.resume : null;
  const resumeEp = resume && v?.episodes?.find((e) => e.number === resume.episode && (e.season ?? v.season) === resume.season);
  return <div ref={box} className={cx("kw-hover", on && "kw-on")} style={at?.style} role="dialog" aria-label="Preview" onMouseLeave={() => setOn(false)}>
    {card ? <>
      <button className="kw-shot" aria-label={card.name} onClick={() => { setOn(false); watch.openTitle(card.id); }}><Img src={card.backdrop ?? card.poster} /><span className="kw-t">{card.name}</span></button>
      <div className="kw-body">
        <div className="kw-acts">
          <button className="kw-ringbtn kw-go" aria-label="Play" onClick={() => { setOn(false); watch.play(card.id); }}><Icon name="play" /></button>
          <ListButton id={card.id} variant="ring" />
          <RateButton id={card.id} variant="ring" />
          <span className="kw-spacer" />
          <button className="kw-ringbtn" aria-label="More info" onClick={() => { setOn(false); watch.openTitle(card.id); }}><Icon name="more" /></button>
        </div>
        <div className="kw-info">{card.badge ? <span className="kw-hi">{card.badge}</span> : null}{card.age ? <span className="kw-box">{card.age}</span> : null}{meta ? <span>{meta}</span> : card.year ? <span>{card.year}</span> : null}</div>
        {resume && resumeEp ? <>
          <div className="kw-info"><span>{resume.label ?? labelOf(v, resume.season, resume.episode)} “{resumeEp.name}”</span></div>
          <div className="kw-bar"><i style={{ width: `${resumeEp.fraction * 100}%` }} /></div>
        </> : null}
        {v ? <div className="kw-dots">{[...v.title.genres, ...v.title.moods].slice(0, 3).map((g) => <span key={g}>{g}</span>)}</div> : <div className="kw-sk kw-sk-line" style={{ width: "60%" }} />}
      </div>
    </> : null}
  </div>;
}

/* Watches the end of Home: when the last rows come within a couple of rows' height, the next page is asked for. */
function MoreRows({ onMore }: { onMore: () => void }) {
  const mark = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mark.current;
    if (!el) return;
    const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) onMore(); }, { root: el.closest(".kw"), rootMargin: "0px 0px 700px 0px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [onMore]);
  return <div ref={mark} aria-hidden="true" style={{ height: 1 }} />;
}
