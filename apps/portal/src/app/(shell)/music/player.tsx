"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { byline, musicApi, type Person, type Queue, type RatedKind, type Rating, type SongStatus, type Track } from "./api";

/*
 * 音 The player: one audio element for all of Music, kept by the Music layout,
 * so moving between pages never stops the song. It holds the queue (and where
 * it came from), plays it through, and when it runs out keeps going with songs
 * like the last one. Your place is saved, so another device picks up there.
 *
 * What's heard is told to the server when a song ends or you move on: only the
 * seconds actually played count, so seeking to the end isn't a listen.
 */

export type Source = Queue["source"];
export type Repeat = Queue["repeat"];
export type Panel = "queue" | "lyrics" | null;

type Player = {
  /** Who's listening: for the greeting and your space. */
  you: Person;
  /** A song being got for the first time: how far along, for the bar. Null once it plays. */
  arriving: SongStatus | null;
  tracks: Track[];
  index: number;
  current: Track | null;
  source: Source;
  playing: boolean;
  shuffle: boolean;
  repeat: Repeat;
  muted: boolean;
  /** Where the song is now (seconds) and how long it is: read when drawn, not kept in state. */
  position: () => number;
  duration: () => number;
  play(tracks: Track[], start?: number, source?: Source, opts?: { shuffle?: boolean }): void;
  toggle(): void;
  next(): void;
  prev(): void;
  seek(seconds: number): void;
  jump(index: number): void;
  playNext(tracks: Track[]): void;
  addToQueue(tracks: Track[]): void;
  remove(index: number): void;
  move(from: number, to: number): void;
  setShuffle(on: boolean): void;
  cycleRepeat(): void;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  ratingOf(kind: RatedKind, key: string): Rating | null;
  rate(kind: RatedKind, key: string, rating: Rating | null): void;
  panel: Panel;
  setPanel(p: Panel): void;
  nowPlaying: boolean;
  /** Opening or closing the song in full starts it on its lyrics. */
  setNowPlaying(open: boolean): void;
  say(text: string): void;
  /** Held while you're reaching for the toast (its menu is open), so it doesn't go mid-choice. */
  holdToast(held: boolean): void;
  /** In a listen party (./party-ui.tsx): the party's queue shows, and the controls act on it. */
  inParty: boolean;
  setRemote(remote: Remote | null): void;
  /** Takes over a queue without stopping what's playing: what leaving a party leaves you with. */
  adopt(tracks: Track[], index: number, source: Source): void;
  audioElement(): HTMLAudioElement | null;
};

/** Something else holding the queue (a listen party): what it has, and what each control does there. */
export type Remote = {
  tracks: Track[];
  index: number;
  source: Source;
  toggle(): void;
  next(): void;
  prev(): void;
  seek(seconds: number): void;
  jump(index: number): void;
  play(tracks: Track[], start: number): void;
  playNext(tracks: Track[]): void;
  addToQueue(tracks: Track[]): void;
  remove(index: number): void;
  move(from: number, to: number): void;
};

/** A word along the bottom. `playlistFor` offers those songs a playlist: after a like, which already put them in Liked songs. */
export type Toast = { text: string; at: number; playlistFor?: string[]; held?: boolean; /** A song that wouldn't play: offers "Why?". */ why?: string };

const PlayerContext = createContext<Player | null>(null);
/** What changes many times a minute (buffering, the volume slider, the toast), apart, so song lists don't redraw with it. */
export type PlayerLive = { waiting: boolean; volume: number; toast: Toast | null };
const LiveContext = createContext<PlayerLive>({ waiting: false, volume: 1, toast: null });
export const usePlayerLive = () => useContext(LiveContext);
export const usePlayer = () => {
  const p = useContext(PlayerContext);
  if (!p) throw new Error("usePlayer outside MusicProvider");
  return p;
};

/* A tick for things drawn from the song's position (the bar, the lyrics): four a second, or every frame for lyrics. */
export function usePosition(fine = false) {
  const p = usePlayer();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (fine) {
      let frame = 0;
      const step = () => { setTick((t) => t + 1); frame = requestAnimationFrame(step); };
      frame = requestAnimationFrame(step);
      return () => cancelAnimationFrame(frame);
    }
    const timer = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(timer);
  }, [fine]);
  return { position: p.position(), duration: p.duration() || p.current?.duration || 0 };
}

const stored = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v) as T; } catch { return fallback; }
};
const store = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window */ } };

const streamOf = (t: Track) => `/api/v1/music/stream?key=${encodeURIComponent(t.key)}`;

export function MusicProvider({ you, children }: { you: Person; children: ReactNode }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [source, setSource] = useState<Source>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [shuffle, setShuffleState] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>("off");
  /* Kept on this device. Nothing drawn on the server shows it, so reading storage at once is safe. */
  const [volume, setVolumeState] = useState(() => stored("km-volume", 1));
  const [muted, setMutedState] = useState(() => stored("km-muted", false));
  const [panel, setPanel] = useState<Panel>(null);
  const [nowPlaying, setNowPlayingState] = useState(false);
  const setNowPlaying = useCallback((open: boolean) => { setNowPlayingState(open); setPanel(null); }, []);
  const [toast, setToast] = useState<Toast | null>(null);
  const [rated, setRated] = useState<Map<string, Rating>>(new Map());
  const [arriving, setArriving] = useState<SongStatus | null>(null);

  /* The order before shuffling, so turning it off puts the songs back. */
  const unshuffled = useRef<Track[] | null>(null);
  /* Seconds heard of the song now playing, and where it last was (a jump isn't hearing). */
  const heard = useRef({ key: "", seconds: 0, last: 0 });
  /* Where to start once the song loads: a resumed place, or a seek before it loaded. */
  const startAt = useRef(0);
  const failures = useRef(0);
  const live = useRef({ tracks, index, repeat, shuffle, source });
  /* A listen party, while you're in one: it holds the queue (see setRemote). */
  const remoteRef = useRef<Remote | null>(null);
  useLayoutEffect(() => { live.current = { tracks, index, repeat, shuffle, source }; });
  const current = tracks[index] ?? null;

  const say = useCallback((text: string) => setToast({ text, at: Date.now() }), []);
  const holdToast = useCallback((held: boolean) => setToast((t) => (t ? { ...t, held } : t)), []);
  useEffect(() => {
    if (!toast || toast.held) return;
    const t = setTimeout(() => setToast(null), toast.playlistFor || toast.why ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [toast]);

  /* ── The audio element ─────────────────────────────────────────────── */
  /* Kept off the page: the page is copied while it slides between pages, and a copied player would play twice. */
  const getAudio = () => {
    if (!audio.current) { audio.current = new Audio(); audio.current.preload = "auto"; }
    return audio.current;
  };

  const report = useCallback(() => {
    const h = heard.current;
    if (h.key && h.seconds >= 1) void musicApi.played(h.key, Math.round(h.seconds)).catch(() => null);
    heard.current = { key: "", seconds: 0, last: 0 };
  }, []);

  /* Loads the song at `i` of `list`, and plays it unless told not to. */
  const load = useCallback((list: Track[], i: number, autoplay: boolean, at = 0) => {
    const audioEl = getAudio();
    const t = list[i];
    if (!t) return;
    report();
    heard.current = { key: t.key, seconds: 0, last: at };
    startAt.current = at;
    audioEl.src = streamOf(t);
    if (autoplay) { setWaiting(true); void audioEl.play().catch(() => setWaiting(false)); }
    /* The next two get ready now, so they start the moment this one ends. */
    const upcoming = list.slice(i + 1, i + 3).map((x) => x.key);
    if (upcoming.length && autoplay) void musicApi.ready(upcoming).catch(() => null);
  }, [report]);

  const advance = useCallback(async (byUser: boolean) => {
    const { tracks: list, index: i, repeat: r } = live.current;
    if (r === "one" && !byUser) { load(list, i, true); return; }
    if (i + 1 < list.length) { setIndex(i + 1); load(list, i + 1, true); return; }
    if (r === "all" && list.length) { setIndex(0); load(list, 0, true); return; }
    /* The end of the queue: carry on with songs like the last one. */
    const last = list[i];
    if (!last) return;
    try {
      const { tracks: more } = await musicApi.radio(last.key, list.map((t) => t.key));
      if (!more.length) { audio.current?.pause(); return; }
      const grown = [...list, ...more];
      setTracks(grown);
      setSource({ kind: "radio", id: last.key, title: `Like ${last.title}` });
      setIndex(i + 1);
      load(grown, i + 1, true);
    } catch { audio.current?.pause(); say("Nothing more to play right now."); }
  }, [load, say]);

  useEffect(() => {
    const el = getAudio();
    const onPlay = () => setPlaying(true);
    const onPause = () => { setPlaying(false); setWaiting(false); };
    const onWaiting = () => setWaiting(true);
    const onPlaying = () => { setWaiting(false); failures.current = 0; };
    const onLoaded = () => { if (startAt.current > 0 && startAt.current < el.duration - 1) el.currentTime = startAt.current; startAt.current = 0; };
    const onTime = () => {
      const h = heard.current;
      const step = el.currentTime - h.last;
      /* Small forward steps are listening; anything else was a jump. */
      if (!el.paused && step > 0 && step < 1.5) h.seconds += step;
      h.last = el.currentTime;
    };
    /* In a party, the party says what's next (its clock), not this player. */
    const onEnded = () => { if (!remoteRef.current) void advance(false); };
    const onError = () => {
      if (!el.src || !el.getAttribute("src")) return;
      setWaiting(false);
      /* In a party a song that won't play here is said, and the party carries on. */
      if (remoteRef.current) { say("That song won't play here; the party carries on."); return; }
      failures.current += 1;
      const t = live.current.tracks[live.current.index];
      if (t) setToast({ text: `“${t.title}” won't play right now.`, at: Date.now(), why: t.key });
      else say("That won't play right now.");
      /* One song failing moves on; several in a row is the server, and waits for you. */
      if (failures.current < 3) setTimeout(() => void advance(true), 1200);
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, [advance, say]);

  /* Leaving Music stops it (the layout goes), and says what was heard. */
  useEffect(() => () => { report(); audio.current?.pause(); audio.current?.removeAttribute("src"); }, [report]);

  /* ── Volume, kept on this device ───────────────────────────────────── */
  useEffect(() => { if (audio.current) { audio.current.volume = volume; audio.current.muted = muted; } }, [volume, muted]);
  const setVolume = useCallback((v: number) => { const c = Math.max(0, Math.min(1, v)); setVolumeState(c); store("km-volume", c); if (c > 0) { setMutedState(false); store("km-muted", false); } }, []);
  const setMuted = useCallback((m: boolean) => { setMutedState(m); store("km-muted", m); }, []);

  /* ── Your place, on every device ───────────────────────────────────── */
  const restored = useRef(false);
  useEffect(() => {
    musicApi.queue().then(({ queue }) => {
      restored.current = true;
      if (!queue?.tracks.length || live.current.tracks.length) return;
      setTracks(queue.tracks); setIndex(queue.index); setSource(queue.source); setShuffleState(queue.shuffle); setRepeat(queue.repeat);
      /* Ready to carry on, but it doesn't start by itself. */
      const el = audio.current;
      if (el && queue.tracks[queue.index]) { startAt.current = queue.position; el.preload = "metadata"; el.src = streamOf(queue.tracks[queue.index]); heard.current = { key: queue.tracks[queue.index].key, seconds: 0, last: queue.position }; }
    }).catch(() => { restored.current = true; });
    musicApi.ratings().then(({ ratings }) => setRated(new Map(ratings.map((r) => [`${r.kind}:${r.key}`, r.rating])))).catch(() => null);
  }, []);

  const save = useCallback(() => {
    if (!restored.current || remoteRef.current) return;
    const { tracks: list, index: i, shuffle: s, repeat: r, source: src } = live.current;
    if (!list.length) return;
    /* The queue around where you are: what's played long ago needn't travel. */
    const from = Math.max(0, i - 50);
    void musicApi.saveQueue({ keys: list.slice(from, from + 500).map((t) => t.key), index: i - from, position: audio.current?.currentTime ?? 0, shuffle: s, repeat: r, source: src, playing: Boolean(audio.current && !audio.current.paused), at: Date.now() }).catch(() => null);
  }, []);
  useEffect(() => { const t = setTimeout(save, 1200); return () => clearTimeout(t); }, [tracks, index, shuffle, repeat, source, save]);
  useEffect(() => {
    /* Saved as it starts and stops too, so friends see what's on now. */
    save();
    if (!playing) return;
    const t = setInterval(save, 15_000);
    return () => clearInterval(t);
  }, [playing, save]);
  useEffect(() => {
    const away = () => { save(); report(); };
    addEventListener("pagehide", away);
    return () => removeEventListener("pagehide", away);
  }, [save, report]);

  /* ── Controls ──────────────────────────────────────────────────────── */
  const play = useCallback((list: Track[], start = 0, src: Source = null, opts: { shuffle?: boolean } = {}) => {
    if (!list.length) return;
    failures.current = 0;
    unshuffled.current = null;
    let order = list, at = start;
    if (opts.shuffle !== undefined) { setShuffleState(opts.shuffle); live.current.shuffle = opts.shuffle; }
    if (live.current.shuffle) {
      /* Shuffle on: the song chosen first, the rest in any order. */
      unshuffled.current = list;
      const rest = list.filter((_, i) => i !== start);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      order = [list[start], ...rest]; at = 0;
    }
    setTracks(order); setIndex(at); setSource(src);
    load(order, at, true);
  }, [load]);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el || !live.current.tracks.length) return;
    if (el.paused) {
      if (!el.getAttribute("src")) load(live.current.tracks, live.current.index, true, startAt.current);
      else { setWaiting(el.readyState < 3); void el.play().catch(() => setWaiting(false)); }
    } else el.pause();
  }, [load]);

  const next = useCallback(() => void advance(true), [advance]);
  const prev = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    const { tracks: list, index: i } = live.current;
    if (el.currentTime > 3 || i === 0) { el.currentTime = 0; heard.current.last = 0; return; }
    setIndex(i - 1); load(list, i - 1, true);
  }, [load]);

  const seek = useCallback((seconds: number) => {
    const el = audio.current;
    if (!el) return;
    if (!el.getAttribute("src") || el.readyState === 0) { startAt.current = seconds; return; }
    el.currentTime = Math.max(0, Math.min(seconds, (el.duration || seconds) - 0.25));
    heard.current.last = el.currentTime;
  }, []);

  const jump = useCallback((i: number) => { setIndex(i); load(live.current.tracks, i, true); }, [load]);

  const playNext = useCallback((more: Track[]) => {
    const { tracks: list, index: i } = live.current;
    if (!list.length) { play(more); return; }
    setTracks([...list.slice(0, i + 1), ...more, ...list.slice(i + 1)]);
    say(more.length === 1 ? `“${more[0].title}” plays next` : `${more.length} songs play next`);
  }, [play, say]);

  const addToQueue = useCallback((more: Track[]) => {
    const { tracks: list } = live.current;
    if (!list.length) { play(more); return; }
    setTracks([...list, ...more]);
    say(more.length === 1 ? `“${more[0].title}” added to the queue` : `${more.length} songs added to the queue`);
  }, [play, say]);

  const remove = useCallback((at: number) => {
    const { tracks: list, index: i } = live.current;
    if (at === i) return;
    setTracks(list.filter((_, j) => j !== at));
    if (at < i) setIndex(i - 1);
  }, []);

  const move = useCallback((from: number, to: number) => {
    const { tracks: list, index: i } = live.current;
    if (from === to || from === i) return;
    const out = [...list];
    const [t] = out.splice(from, 1);
    out.splice(to, 0, t);
    setTracks(out);
    setIndex(out.indexOf(list[i]));
  }, []);

  const setShuffle = useCallback((on: boolean) => {
    const { tracks: list, index: i } = live.current;
    setShuffleState(on);
    if (!list.length) return;
    const playingNow = list[i];
    if (on) {
      unshuffled.current = list;
      const rest = list.slice(i + 1);
      for (let k = rest.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [rest[k], rest[j]] = [rest[j], rest[k]]; }
      setTracks([...list.slice(0, i + 1), ...rest]);
    } else if (unshuffled.current) {
      const original = unshuffled.current;
      unshuffled.current = null;
      setTracks(original);
      setIndex(Math.max(0, original.findIndex((t) => t.key === playingNow.key)));
    }
  }, []);

  const cycleRepeat = useCallback(() => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")), []);

  const ratingOf = useCallback((kind: RatedKind, key: string) => rated.get(`${kind}:${key}`) ?? null, [rated]);
  const rate = useCallback((kind: RatedKind, key: string, rating: Rating | null) => {
    const id = `${kind}:${key}`;
    const before = rated.get(id) ?? null;
    setRated((m) => { const n = new Map(m); if (rating) n.set(id, rating); else n.delete(id); return n; });
    /* Up and love keep a song in Liked songs: the first time, say so, and offer a playlist too. */
    const likes = (r: Rating | null) => r === "up" || r === "love";
    if (kind === "track" && likes(rating) && !likes(before)) setToast({ text: "In Liked songs", at: Date.now(), playlistFor: [key] });
    musicApi.rate(kind, key, rating).catch(() => {
      setRated((m) => { const n = new Map(m); if (before) n.set(id, before); else n.delete(id); return n; });
      say("That rating didn't save.");
    });
  }, [rated, say]);

  /* ── A song's first time: how far it has got, while it's on its way ── */
  useEffect(() => {
    if (!waiting || !current) return;
    let live = true;
    const key = current.key;
    const ask = async () => {
      while (live) {
        /* Something already playing (it was kept) needs no bar. */
        if ((audio.current?.currentTime ?? 0) > 0.2) break;
        const s = await musicApi.status(key).catch(() => null);
        if (!live) return;
        if (s?.stage === "ready") break;
        if (s) setArriving(s);
        await new Promise((ok) => setTimeout(ok, 500));
      }
      if (live) setArriving(null);
    };
    /* Kept songs start at once: only a wait longer than a moment shows the bar. */
    const start = setTimeout(() => void ask(), 400);
    return () => { live = false; clearTimeout(start); };
  }, [waiting, current]);
  useEffect(() => { if (!waiting && arriving) { const t = setTimeout(() => setArriving(null), 0); return () => clearTimeout(t); } }, [waiting, arriving]);

  /* ── The lock screen, headphones and media keys ────────────────────── */
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!ms) return;
    if (!current) { ms.metadata = null; return; }
    const art = current.album?.cover;
    ms.metadata = new MediaMetadata({ title: current.title, artist: byline(current), album: current.album?.title ?? "", artwork: art ? [{ src: art, sizes: "1000x1000", type: "image/jpeg" }] : [] });
  }, [current]);
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!ms) return;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => { try { ms.setActionHandler(action, handler); } catch { /* not offered here */ } };
    set("play", () => toggle());
    set("pause", () => audio.current?.pause());
    set("nexttrack", () => next());
    set("previoustrack", () => prev());
    set("seekto", (d) => { if (d.seekTime !== undefined) seek(d.seekTime); });
    set("seekbackward", (d) => seek((audio.current?.currentTime ?? 0) - (d.seekOffset ?? 10)));
    set("seekforward", (d) => seek((audio.current?.currentTime ?? 0) + (d.seekOffset ?? 10)));
    return () => { for (const a of ["play", "pause", "nexttrack", "previoustrack", "seekto", "seekbackward", "seekforward"] as MediaSessionAction[]) set(a, null); };
  }, [toggle, next, prev, seek]);
  useEffect(() => { if (navigator.mediaSession) navigator.mediaSession.playbackState = current ? (playing ? "playing" : "paused") : "none"; }, [playing, current]);

  /* ── Keys: space plays and pauses, arrows seek (shift: songs), M mutes ─ */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " && !(el instanceof HTMLButtonElement)) { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); if (e.shiftKey) next(); else seek((audio.current?.currentTime ?? 0) + 10); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); if (e.shiftKey) prev(); else seek((audio.current?.currentTime ?? 0) - 10); }
      else if (e.key === "m" || e.key === "M") setMuted(!(audio.current?.muted ?? false));
      else if (e.key === "Escape") { setNowPlaying(false); setPanel(null); }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [toggle, next, prev, seek, setMuted, setNowPlaying]);

  /* ── A listen party holding the queue ─────────────────────────────── */
  const [remote, setRemoteState] = useState<Remote | null>(null);
  const setRemote = useCallback((r: Remote | null) => { remoteRef.current = r; setRemoteState(r); }, []);
  const adopt = useCallback((list: Track[], i: number, src: Source) => {
    setTracks(list); setIndex(Math.max(0, Math.min(i, list.length - 1))); setSource(src);
    const t = list[i];
    if (t) heard.current = { key: t.key, seconds: 0, last: audio.current?.currentTime ?? 0 };
  }, []);
  const audioElement = useCallback(() => getAudio(), []);

  const value = useMemo<Player>(() => {
    const r = remote;
    const notInParty = () => say("Shuffle and repeat are off while you listen together.");
    return {
      you, arriving,
      tracks: r ? r.tracks : tracks, index: r ? r.index : index, current: r ? r.tracks[r.index] ?? null : current, source: r ? r.source : source,
      playing, shuffle: r ? false : shuffle, repeat: r ? "off" : repeat, muted,
      position: () => audio.current?.currentTime ?? 0,
      duration: () => (Number.isFinite(audio.current?.duration) ? audio.current!.duration : 0),
      play: r ? (list: Track[], start = 0) => r.play(list, start) : play,
      toggle: r ? r.toggle : toggle, next: r ? r.next : next, prev: r ? r.prev : prev, seek: r ? r.seek : seek, jump: r ? r.jump : jump,
      playNext: r ? r.playNext : playNext, addToQueue: r ? r.addToQueue : addToQueue, remove: r ? r.remove : remove, move: r ? r.move : move,
      setShuffle: r ? notInParty : setShuffle, cycleRepeat: r ? notInParty : cycleRepeat, setVolume, setMuted,
      ratingOf, rate, panel, setPanel, nowPlaying, setNowPlaying, say, holdToast,
      inParty: Boolean(r), setRemote, adopt, audioElement,
    };
  }, [remote, you, arriving, tracks, index, current, source, playing, shuffle, repeat, muted, play, toggle, next, prev, seek, jump, playNext, addToQueue, remove, move, setShuffle, cycleRepeat, setVolume, setMuted, ratingOf, rate, panel, setPanel, nowPlaying, setNowPlaying, say, holdToast, setRemote, adopt, audioElement]);
  const liveValue = useMemo<PlayerLive>(() => ({ waiting, volume, toast }), [waiting, volume, toast]);

  return <PlayerContext.Provider value={value}><LiveContext.Provider value={liveValue}>{children}</LiveContext.Provider></PlayerContext.Provider>;
}
