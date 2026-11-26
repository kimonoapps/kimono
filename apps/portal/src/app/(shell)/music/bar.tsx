"use client";

import { Crossing } from "@/components/crossing";
import { InkSheet } from "@/components/ink-sheet";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cx, InkWave, Seal } from "@kimono/ui";
import { byline, clock, hrefOf, musicApi, share, type Lyrics } from "./api";
import { Asker } from "./ask";
import { Icon } from "./icons";
import { ListenTogether } from "./party-ui";
import { AddToPlaylist, ArtistLinks, Bars, Cover, Menu, MenuRates, MoreButton, playlistItems, RateMarks, songMenuItems, type Item } from "./parts";
import { usePlayer, usePlayerLive, usePosition, type Source } from "./player";

/*
 * What stays on screen while you browse: the bar along the bottom, and the
 * two things it opens: the song in full with its lyrics, and the queue. They
 * live on the body, beside the page rather than in it, so they hold still
 * while pages slide past.
 */
const never = () => () => {};
export function PlayerChrome() {
  /* Only in the browser: it's drawn on the body, which the server doesn't have. */
  const ready = useSyncExternalStore(never, () => true, () => false);
  if (!ready) return null;
  /* In the app's frame, which carries Music's colour, but beside the page that slides. */
  return createPortal(<><NowPlaying /><QueuePanel /><Bar /><Toast /><Asker /></>, document.querySelector(".app-frame") ?? document.body);
}

/* ── A slider: the song's place, and the volume ────────────────────────── */

function Slider({ value, max, onChange, onCommit, label, format, className, wave, still }: {
  value: number; max: number; onChange?: (v: number) => void; onCommit: (v: number) => void; label: string; format?: (v: number) => string; className?: string;
  /** The song's place: drawn as the phone's ink wave (Material's media bar), flat while `still` (paused). */
  wave?: boolean; still?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width)) * max;
  };
  return <div ref={track} className={cx("km-slider", drag !== null && "km-dragging", className)} role="slider" tabIndex={0}
    aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(shown)} aria-valuetext={format?.(shown)}
    style={{ "--km-fill": `${max ? (shown / max) * 100 : 0}%` } as React.CSSProperties}
    onPointerDown={(e) => { if (!max) return; e.currentTarget.setPointerCapture(e.pointerId); const v = at(e.clientX); setDrag(v); onChange?.(v); }}
    onPointerMove={(e) => { if (drag === null) return; const v = at(e.clientX); setDrag(v); onChange?.(v); }}
    onPointerUp={(e) => { if (drag === null) return; const v = at(e.clientX); setDrag(null); onCommit(v); }}
    onPointerCancel={() => setDrag(null)}
    onKeyDown={(e) => {
      const step = max > 2 ? 5 : 0.05;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); onCommit(Math.min(max, value + step)); }
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); onCommit(Math.max(0, value - step)); }
    }}>
    {wave
      ? <span className="km-slider-wave" aria-hidden="true"><InkWave value={max ? shown / max : 0} still={still} glide={false} label="" /></span>
      : <span className="km-slider-rail"><span className="km-slider-fill" /></span>}
    <span className="km-slider-knob" />
  </div>;
}

/* ── Small things the bar and Now Playing share ────────────────────────── */

/* Wider than a phone: Now Playing has room for the lyrics beside the song. */
const wideQuery = "(min-width: 721px)";
function useWide() {
  return useSyncExternalStore(
    (on) => { const m = matchMedia(wideQuery); m.addEventListener("change", on); return () => m.removeEventListener("change", on); },
    () => matchMedia(wideQuery).matches,
    () => true,
  );
}

/* A song's words, fetched once and kept: the bar wants to know whether there are any, Now Playing wants them. */
const lyricsKept = new Map<string, Promise<Lyrics | null>>();
function lyricsOf(key: string) {
  let found = lyricsKept.get(key);
  if (!found) {
    found = musicApi.lyrics(key).then((r) => r.lyrics).catch(() => { lyricsKept.delete(key); return null; });
    lyricsKept.set(key, found);
  }
  return found;
}
/** Undefined while asking; null when there are none. */
function useLyrics(key: string): Lyrics | null | undefined {
  const [got, setGot] = useState<{ key: string; lyrics: Lyrics | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    void lyricsOf(key).then((lyrics) => { if (live) setGot({ key, lyrics }); });
    return () => { live = false; };
  }, [key]);
  return got?.key === key ? got.lyrics : undefined;
}
const hasWords = (l: Lyrics | null | undefined) => l === undefined || Boolean(l && (l.synced?.length || l.plain));

/* Where the queue came from, as somewhere to go back to. */
function sourceHref(s: NonNullable<Source>): string | null {
  switch (s.kind) {
    case "album": return hrefOf.album(s.id);
    case "artist": return hrefOf.artist(s.id);
    case "playlist": return hrefOf.playlist(s.id);
    case "genre": return hrefOf.genre(Number(s.id));
    case "mix": return hrefOf.mix(s.id);
    case "liked": return "/music/liked";
    case "history": return "/music/history";
    case "radio": case "song": return hrefOf.song(s.id);
    case "search": return `/music/search?q=${encodeURIComponent(s.id)}`;
    default: return null;
  }
}

/** Shuffle, previous, play, next, repeat. Shuffle and repeat are pressed stamps when on. */
function Transport({ large = false }: { large?: boolean }) {
  const p = usePlayer();
  const live = usePlayerLive();
  const repeatLabel = p.repeat === "one" ? "Repeating this song" : p.repeat === "all" ? "Repeating the queue" : "Repeat";
  return <div className={cx("km-transport", large && "km-transport-lg")}>
    <button type="button" className={cx("km-iconbtn km-small km-order", p.shuffle && "km-on")} aria-pressed={p.shuffle} aria-label="Shuffle" title="Shuffle" onClick={() => p.setShuffle(!p.shuffle)}><Icon name="shuffle" /></button>
    <button type="button" className="km-iconbtn" aria-label="Previous" title="Previous" onClick={p.prev}><Icon name="prev" /></button>
    <button type="button" className={cx("km-playbtn", large && "km-playbtn-lg", live.waiting && "km-waiting")} aria-label={p.playing ? "Pause" : "Play"} onClick={p.toggle}>
      <Icon name={p.playing ? "pause" : "play"} />
    </button>
    <button type="button" className="km-iconbtn" aria-label="Next" title="Next" onClick={p.next}><Icon name="next" /></button>
    <button type="button" className={cx("km-iconbtn km-small km-order", p.repeat !== "off" && "km-on")} aria-pressed={p.repeat !== "off"} aria-label={repeatLabel} title={repeatLabel} onClick={p.cycleRepeat}>
      <Icon name={p.repeat === "one" ? "repeatOne" : "repeat"} />
    </button>
  </div>;
}

/** The song's place: a rail between its times, or (phone Now Playing) a rail with the times under it. */
function SongPlace({ under = false }: { under?: boolean }) {
  const p = usePlayer();
  const live = usePlayerLive();
  const { position, duration } = usePosition();
  const [scrub, setScrub] = useState<number | null>(null);
  const rail = <Slider label="Place in the song" value={position} max={duration} format={(v) => `${clock(v)} of ${clock(duration)}`} onChange={setScrub} onCommit={(v) => { setScrub(null); p.seek(v); }}
    wave still={!p.playing || live.waiting} className="km-slider-is-wave" />;
  if (under) return <div className="km-seek km-seek-under">{rail}<span className="km-time">{clock(scrub ?? position)}</span><span className="km-time">{clock(duration)}</span></div>;
  return <div className="km-seek"><span className="km-time">{clock(scrub ?? position)}</span>{rail}<span className="km-time">{clock(duration)}</span></div>;
}

/**
 * Lyrics and Queue, worded, seated while open. In the bar, Lyrics opens the song
 * in full and Queue the queue beside the page, or, with the song open, its Up next.
 */
function BarViews({ words }: { words: boolean }) {
  const p = usePlayer();
  const lyricsOn = p.nowPlaying && p.panel !== "queue";
  const queueOn = p.panel === "queue";
  return <span className="km-leaves" role="group" aria-label="Views">
    <button type="button" className={cx("km-leaf", lyricsOn && "km-on", !words && "km-lifted")} aria-pressed={lyricsOn} title={words ? "Lyrics" : "No lyrics for this song"}
      onClick={() => { if (!p.nowPlaying) p.setNowPlaying(true); else if (p.panel === "queue") p.setPanel("lyrics"); else p.setNowPlaying(false); }}>
      <Icon name="lyrics" /><span>Lyrics</span>
    </button>
    <button type="button" className={cx("km-leaf", queueOn && "km-on")} aria-pressed={queueOn} title="Queue"
      onClick={() => p.setPanel(queueOn ? (p.nowPlaying ? "lyrics" : null) : "queue")}>
      <Icon name="queue" /><span>Queue</span>
    </button>
  </span>;
}

/** Volume: a rail beside the speaker; where there's no room, a tap mutes and holding brings the rail up. */
function Volume() {
  const p = usePlayer();
  const live = usePlayerLive();
  const [raised, setRaised] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const hold = useRef<number | undefined>(undefined);
  const held = useRef(false);
  useEffect(() => {
    if (!raised) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setRaised(false); };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [raised]);
  const label = p.muted ? "Unmute" : "Mute";
  return <span ref={box} className={cx("km-volume", raised && "km-volume-raised")}>
    <button type="button" className="km-iconbtn km-small" aria-label={label} title={label}
      onPointerDown={() => { held.current = false; hold.current = window.setTimeout(() => { held.current = true; setRaised(true); }, 450); }}
      onPointerUp={() => clearTimeout(hold.current)} onPointerLeave={() => clearTimeout(hold.current)}
      onContextMenu={(e) => { e.preventDefault(); setRaised(true); }}
      onClick={() => { if (held.current) { held.current = false; return; } p.setMuted(!p.muted); }}>
      <Icon name={p.muted || live.volume === 0 ? "muted" : "volume"} />
    </button>
    <Slider label="Volume" value={p.muted ? 0 : live.volume} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={p.setVolume} onCommit={p.setVolume} className="km-volume-slider" />
  </span>;
}

/* ── The bar ───────────────────────────────────────────────────────────── */

/*
 * Three groups, each with one meaning: the song and how you feel about it;
 * playing; and what's around the song (its views, the volume, its menu).
 * Nothing sits beside the marks.
 */
function Bar() {
  const p = usePlayer();
  const { position, duration } = usePosition();
  const t = p.current;
  const lyrics = useLyrics(t?.key ?? "");
  if (!t) return null;
  const arriving = p.arriving;
  const arrivingText = arriving?.stage === "finding" ? "Finding the song" : "Getting it ready";
  return <div className={cx("km-bar", p.nowPlaying && "km-bar-open", arriving && "km-bar-arriving")} role="region" aria-label="Player">
    <div className="km-bar-song">
      <button type="button" className="km-bar-art" aria-label={p.nowPlaying ? "Close the song" : "Open the song"} onClick={() => p.setNowPlaying(!p.nowPlaying)}>
        <Cover src={t.album?.cover} size={52} />
        <Icon name={p.nowPlaying ? "collapse" : "expand"} className="km-bar-art-mark" />
      </button>
      <div className="km-bar-name">
        <button type="button" className="km-bar-title" onClick={() => p.setNowPlaying(!p.nowPlaying)}>{t.title}</button>
        <span className="km-bar-by">{arriving ? <span className="km-arriving-short">{arrivingText}…</span> : null}<span className="km-bar-artists"><ArtistLinks artists={t.artists} /></span></span>
      </div>
      <RateMarks kind="track" keyOf={t.key} className="km-bar-rate" />
    </div>

    <div className="km-bar-middle">
      <Transport />
      {arriving
        /* The first time anyone plays a song, the server fetches it: the wave fills as it comes in. */
        ? <div className="km-seek km-arriving" role="status">
          <span className="km-arriving-label">{arrivingText}</span>
          <InkWave value={arriving.stage === "fetching" && arriving.fraction > 0 ? arriving.fraction : undefined} label={arrivingText} className="km-arriving-wave" />
        </div>
        : <SongPlace />}
    </div>

    <div className="km-bar-end">
      <BarViews words={hasWords(lyrics)} />
      <Volume />
      {/* The song's own menu, last and away from the marks; where the marks don't fit, they're in it. */}
      <MoreButton label={`More for ${t.title}`} className="km-bar-more" head={() => (matchMedia("(max-width: 900px)").matches ? <MenuRates t={t} /> : null)} items={() => songMenuItems(t, p)} />
    </div>
    {/* Narrower, the song's place runs along the bar's top edge: a rail you can take hold of. A phone draws it as a line. */}
    {arriving
      ? <span className="km-bar-line km-bar-line-arriving" style={{ width: `${arriving.stage === "fetching" ? Math.max(4, arriving.fraction * 100) : 4}%` }} />
      : <>
        <Slider label="Place in the song" value={position} max={duration} format={(v) => `${clock(v)} of ${clock(duration)}`} onCommit={(v) => p.seek(v)} className="km-bar-seekline" />
        <span className="km-bar-line" style={{ width: `${duration ? (position / duration) * 100 : 0}%` }} />
      </>}
  </div>;
}

/* ── The song in full ──────────────────────────────────────────────────── */

/*
 * Each of the song's actions has its own place: the marks under its name, alone;
 * the artist and album are its byline; Add to playlist and Share in the header,
 * worded; the queue is Up next, beside the lyrics. On a phone it's the whole
 * player, and Lyrics and Up next take the art's place.
 */
function NowPlaying() {
  const p = usePlayer();
  const wide = useWide();
  const t = p.current;
  const open = p.nowPlaying && Boolean(t);
  /* Kept drawn a moment after closing, so it can slide away. */
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => { if (open) return; const timer = setTimeout(() => setShown(false), 220); return () => clearTimeout(timer); }, [open]);
  const lyrics = useLyrics(t?.key ?? "");
  if (!shown || !t) return null;
  const view = p.panel === "queue" ? "queue" : p.panel === "lyrics" ? "lyrics" : "song";
  const from = p.source ? sourceHref(p.source) : null;
  const words = hasWords(lyrics);
  /* On a phone the lyrics and Up next take the art's place; wider, the bar's own Lyrics and Queue switch them. */
  const leaves = <span className="km-leaves" role="group" aria-label="Views">
    <button type="button" className={cx("km-leaf", view === "lyrics" && "km-on", !words && "km-lifted")} aria-pressed={view === "lyrics"} title={words ? "Lyrics" : "No lyrics for this song"}
      onClick={() => p.setPanel(view === "lyrics" ? null : "lyrics")}><Icon name="lyrics" /><span>Lyrics</span></button>
    <button type="button" className={cx("km-leaf", view === "queue" && "km-on")} aria-pressed={view === "queue"} title="Up next"
      onClick={() => p.setPanel(view === "queue" ? null : "queue")}><Icon name="queue" /><span>Up next</span></button>
  </span>;
  return <section className={cx("km-np", open ? "km-np-in" : "km-np-out", `km-np-view-${view}`)} aria-label="Now playing">
    <header className="km-np-head">
      <button type="button" className="km-iconbtn km-np-close" aria-label="Close" title="Close" onClick={() => p.setNowPlaying(false)}><Icon name="collapse" /></button>
      <span className="km-np-from">
        {p.source ? <><span className="k-label">Playing from</span>
          {from ? <Crossing kind="kakejiku" href={from} onClick={() => p.setNowPlaying(false)}>{p.source.title}</Crossing> : <span>{p.source.title}</span>}</> : null}
      </span>
      <span className="km-np-tools">
        <ListenTogether className="km-np-worded" />
        <ListenTogether labelled={false} className="km-np-phone-only" />
        <AddToPlaylist keys={[t.key]} className="km-np-worded" />
        <Seal tone="quiet" compact className="km-seal-icon km-np-worded" onClick={async () => { const said = await share(hrefOf.song(t.key), `${t.title} · ${byline(t)}`); if (said) p.say(said); }}><Icon name="share" />Share</Seal>
        <MoreButton label={`More for ${t.title}`} items={() => songMenuItems(t, p)} />
      </span>
    </header>
    <div className="km-np-song">
      <Cover src={t.album?.cover} quality="full" className="km-np-art" alt={t.album?.title ?? ""} />
      <div className="km-np-name">
        <div className="km-np-said">
          <h2 className="km-np-title"><Crossing kind="kakejiku" href={hrefOf.song(t.key)} onClick={() => p.setNowPlaying(false)}>{t.title}</Crossing></h2>
          <p className="km-np-by"><ArtistLinks artists={t.artists} />{t.album?.key ? <> · <Crossing kind="kakejiku" href={hrefOf.album(t.album.key)} onClick={() => p.setNowPlaying(false)}>{t.album.title}</Crossing></> : t.album?.title ? <> · {t.album.title}</> : null}</p>
        </div>
        <RateMarks kind="track" keyOf={t.key} size={wide ? "lg" : "md"} />
      </div>
    </div>
    <div className="km-np-side">
      {view === "queue" ? <QueueList /> : <LyricsView key={t.key} lyrics={lyrics} />}
    </div>
    {wide ? null : <div className="km-np-controls">
      <SongPlace under />
      <Transport large />
      {leaves}
    </div>}
  </section>;
}

function LyricsView({ lyrics }: { lyrics: Lyrics | null | undefined }) {
  const p = usePlayer();
  const lines = lyrics?.synced ?? null;
  const { position } = usePosition(Boolean(lines));
  const here = useMemo(() => {
    if (!lines) return -1;
    let i = -1;
    /* A touch early, so the line lights as it's sung rather than after. */
    for (let k = 0; k < lines.length; k++) { if (lines[k].at <= position + 0.25) i = k; else break; }
    return i;
  }, [lines, position]);
  const box = useRef<HTMLDivElement>(null);
  /* The sung line keeps to a third of the way down, unless you've scrolled to read ahead. */
  const reading = useRef(0);
  /* A seek (the bar, the keys, a line) is someone following the song again: the sung line comes straight back, without the glide. */
  const jumped = useRef(false);
  useEffect(() => {
    const el = p.audioElement();
    if (!el) return;
    const onSeek = () => { reading.current = 0; jumped.current = true; };
    el.addEventListener("seeking", onSeek);
    return () => el.removeEventListener("seeking", onSeek);
  }, [p.audioElement]);
  const shownAt = useRef(-1);
  useEffect(() => {
    if (here < 0 || Date.now() - reading.current < 4000) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-line="${here}"]`);
    const far = jumped.current || Math.abs(here - shownAt.current) > 2;
    jumped.current = false; shownAt.current = here;
    const b = box.current;
    if (el && b) b.scrollTo({ top: b.scrollTop + el.getBoundingClientRect().top - b.getBoundingClientRect().top - b.clientHeight / 3, behavior: far ? "instant" : "smooth" });
  }, [here]);

  if (lyrics === undefined) return <div className="km-lyrics km-lyrics-quiet" />;
  if (!lyrics || (!lines && !lyrics.plain)) return <div className="km-lyrics km-lyrics-quiet"><p>{lyrics?.instrumental ? "Instrumental" : "No lyrics for this song."}</p></div>;
  if (!lines) return <div className="km-lyrics km-lyrics-plain">{lyrics.plain!.split(/\n/).map((l, i) => <p key={i}>{l || " "}</p>)}</div>;
  return <div ref={box} className="km-lyrics" onWheel={() => { reading.current = Date.now(); }} onTouchMove={() => { reading.current = Date.now(); }}>
    {lines.map((l, i) => <button type="button" key={i} data-line={i} className={cx("km-line", i === here && "km-line-now", i < here && "km-line-past", !l.line && "km-line-gap")}
      onClick={() => { reading.current = 0; p.seek(l.at); if (!p.playing) p.toggle(); }}>
      {l.line || <Bars />}
    </button>)}
  </div>;
}

/* ── The queue ─────────────────────────────────────────────────────────── */

/** What plays next, and in what order: shuffle and repeat live here, worded, beside it. */
function QueueList() {
  const p = usePlayer();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const next = p.tracks.slice(p.index + 1).map((t, k) => ({ t, at: p.index + 1 + k }));
  const repeatLabel = p.repeat === "one" ? "Repeat this song" : p.repeat === "all" ? "Repeat all" : "Repeat";
  return <div className="km-queue-body">
    <div className="km-queue-order">
      <button type="button" className={cx("km-ordertoggle", p.shuffle && "km-on")} aria-pressed={p.shuffle} onClick={() => p.setShuffle(!p.shuffle)}><Icon name="shuffle" /><span>Shuffle</span></button>
      <button type="button" className={cx("km-ordertoggle", p.repeat !== "off" && "km-on")} aria-pressed={p.repeat !== "off"} onClick={p.cycleRepeat}><Icon name={p.repeat === "one" ? "repeatOne" : "repeat"} /><span>{repeatLabel}</span></button>
    </div>
    {p.current ? <>
      <h3 className="k-label km-queue-label">Now playing</h3>
      <div className="km-qrow km-now">
        <Cover src={p.current.album?.cover} size={44} />
        <span className="km-qrow-name"><span>{p.current.title}</span><span className="km-qrow-by">{byline(p.current)}</span></span>
        {p.playing ? <Bars /> : null}
      </div>
    </> : null}
    <h3 className="k-label km-queue-label">{p.source ? `Next from ${p.source.title}` : "Next"}</h3>
    {next.length ? <ol className="km-queue-list">
      {next.map(({ t, at }) => <li key={`${t.key}-${at}`} className={cx("km-qrow", drag === at && "km-dragging", over === at && drag !== null && drag !== at && "km-over")}
        draggable onDragStart={(e) => { setDrag(at); e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(e) => { e.preventDefault(); setOver(at); }}
        onDrop={(e) => { e.preventDefault(); if (drag !== null) p.move(drag, at); setDrag(null); setOver(null); }}
        onDragEnd={() => { setDrag(null); setOver(null); }}>
        <Icon name="drag" className="km-qrow-grip" />
        <button type="button" className="km-qrow-main" onClick={() => p.jump(at)} aria-label={`Play ${t.title}`}>
          <Cover src={t.album?.cover} size={44} />
          <span className="km-qrow-name"><span>{t.title}</span><span className="km-qrow-by">{byline(t)}</span></span>
        </button>
        <button type="button" className="km-iconbtn km-small" aria-label={`Take ${t.title} out of the queue`} title="Take out of the queue" onClick={() => p.remove(at)}><Icon name="close" /></button>
      </li>)}
    </ol> : <p className="km-queue-empty">When this ends, songs like it play on.</p>}
  </div>;
}

/** The queue beside the page, while the song isn't open (open, it's the song's Up next). */
function QueuePanel() {
  const p = usePlayer();
  if (p.panel !== "queue" || p.nowPlaying) return null;
  return <aside className="km-queue" aria-label="Queue">
    <header>
      <h2 className="k-heading">Queue</h2>
      <button type="button" className="km-iconbtn" aria-label="Close the queue" title="Close" onClick={() => p.setPanel(null)}><Icon name="close" /></button>
    </header>
    <QueueList />
  </aside>;
}

/** Why a song won't play, step by step as the server sees it (/api/v1/music/why): to read, copy and send on. */
function WhySheet({ songKey, onClose }: { songKey: string; onClose: () => void }) {
  const [steps, setSteps] = useState<{ step: string; ok: boolean; said: string }[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    fetch(`/api/v1/music/why?key=${encodeURIComponent(songKey)}`).then(async (r) => {
      const b = await r.json().catch(() => ({})) as { steps?: { step: string; ok: boolean; said: string }[]; error?: string };
      if (!r.ok) setProblem(b.error || "Music didn't answer."); else setSteps(b.steps ?? []);
    }).catch(() => setProblem("Music didn't answer."));
  }, [songKey, tries]);
  const text = steps?.map((s) => `${s.ok ? "✓" : "✗"} ${s.step}: ${s.said}`).join("\n") ?? "";
  return <InkSheet title="Why it won't play" icon="search" tint="#946c25" onClose={onClose} actions={<>
    <Seal tone="quiet" compact onClick={() => { setSteps(null); setProblem(null); setTries((n) => n + 1); }} disabled={!steps && !problem}>Check again</Seal>
    <Seal compact disabled={!steps} onClick={() => void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied" : "Copy"}</Seal>
  </>}>
    {problem ? <p className="km-why-problem">{problem}</p> : !steps ? <p className="km-why-wait">Trying each way to get it…</p>
      : <ol className="km-why">{steps.map((s, i) => <li key={i} className={s.ok ? "is-ok" : "is-off"}><b>{s.ok ? "✓" : "✗"} {s.step}</b><code>{s.said}</code></li>)}</ol>}
  </InkSheet>;
}

/** A word along the bottom. After a like it says where the song went, and offers a playlist then and there. */
function Toast() {
  const p = usePlayer();
  const live = usePlayerLive();
  const [menu, setMenu] = useState<{ at: HTMLElement; items: Item[] } | null>(null);
  const t = live.toast;
  const offer = t?.playlistFor;
  const [why, setWhy] = useState<string | null>(null);
  const acts = offer || t?.why;
  return <>
    <div className={cx("km-toast", t && "km-on", acts && "km-toast-offer")} role="status" aria-live="polite"
      onPointerEnter={() => { if (acts) p.holdToast(true); }} onPointerLeave={() => { if (acts && !menu) p.holdToast(false); }}>
      <span>{t?.text}</span>
      {offer ? <button type="button" className="km-toast-action" aria-haspopup="menu" aria-expanded={Boolean(menu)}
        onClick={async (e) => { const at = e.currentTarget; p.holdToast(true); setMenu({ at, items: await playlistItems(offer, p.say)() }); }}>Add to playlist</button> : null}
      {t?.why ? <button type="button" className="km-toast-action" onClick={() => { setWhy(t.why!); p.holdToast(false); }}>Why?</button> : null}
    </div>
    {menu ? <Menu anchor={menu.at} items={menu.items} onClose={() => { setMenu(null); p.holdToast(false); }} /> : null}
    {why ? <WhySheet songKey={why} onClose={() => setWhy(null)} /> : null}
  </>;
}
