"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref as ReactRef } from "react";
import { airText, clock, deviceOf, languageName, watchApi, type Episode, type Play, type Ref, type TitleView } from "./api";
import { alike, cx, Img, TitleMark, useWatch } from "./bits";
import { Icon, SeekIcon, Wavy } from "./icons";
import { attach, thumbSource } from "./source";

/*
 * The player: the stream fills the screen, the controls come and go, and the
 * end of an episode hands over to the next one. Where someone is goes back to
 * the server every ten seconds and whenever they pause or leave.
 */

export type PlayerHandle = { start: (id: string, at?: Ref) => void };
type Post = "next" | "ask" | "end" | null;
type Sheet = "cc" | "speed" | "eps" | null;
type Skip = { label: string; to: number; left: number } | null;
type LocalTrack = { key: string; label: string; language: string };

const speeds = [0.5, 0.75, 1, 1.25, 1.5];
const wide = () => matchMedia("(min-width: 900px)").matches;
const two = (code: string) => (/^[a-z]{2}$/.test(code) ? code : null);
const aired = (e: Pick<Episode, "airDate">) => !e.airDate || Date.parse(e.airDate) <= Date.now();
const future = (date: string | null | undefined) => (date && Date.parse(date) > Date.now() ? date : null);

export function Player({ ref, onExit }: { ref: ReactRef<PlayerHandle>; onExit: (changed: boolean) => void }) {
  const watch = useWatch();
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const thumbVideo = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const track = useRef<HTMLDivElement>(null);

  const [titleId, setTitleId] = useState<string | null>(null);
  const [view, setView] = useState<TitleView | null>(null);
  const [ep, setEp] = useState<Ref | null>(null);
  const [play, setPlay] = useState<Play | null>(null);
  const [loading, setLoading] = useState(false);
  const [pct, setPct] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [ctl, setCtl] = useState(true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [post, setPost] = useState<Post>(null);
  const [postOut, setPostOut] = useState(false);
  const [pinfo, setPinfo] = useState(false);
  const [skip, setSkip] = useState<Skip>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fs, setFs] = useState(false);
  const [cue, setCue] = useState("");
  const [drag, setDrag] = useState<number | null>(null);
  const [peekAt, setPeekAt] = useState<number | null>(null);
  const [rip, setRip] = useState<{ l: number; r: number }>({ l: 0, r: 0 });
  const [countdown, setCountdown] = useState(0);
  const [audioTracks, setAudioTracks] = useState<LocalTrack[]>([]);
  const [textTracks, setTextTracks] = useState<LocalTrack[]>([]);
  const [choice, setChoice] = useState<{ audio: string; subtitles: string } | null>(null);

  /* What timers and listeners read: the latest, without waiting for a render. */
  const live = useRef({ titleId: null as string | null, ep: null as Ref | null, play: null as Play | null, view: null as TitleView | null, post: null as Post, sheet: null as Sheet, drag: false, buffering: false, loading: false, creditsDone: false, prepared: false, autoSkipped: false, savedAt: 0, token: 0, tries: 0, changed: false });
  useLayoutEffect(() => {
    Object.assign(live.current, { titleId, ep, play, view, post, sheet, drag: drag !== null, buffering, loading });
  });
  const countTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [trackW, setTrackW] = useState(0);
  const [textOn, setTextOn] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);

  const movie = view ? !view.seasons : false;
  const episodes: Episode[] = view?.episodes ?? [];
  const episode = ep ? episodes.find((e) => e.number === ep.episode) ?? null : null;

  /* ───── Controls that come and go ───── */
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showCtl = useCallback((hold?: boolean) => {
    setCtl(true);
    clearTimeout(hideTimer.current);
    if (!hold) hideTimer.current = setTimeout(() => {
      const v = video.current;
      if (v && !v.paused && !live.current.sheet && !live.current.drag) setCtl(false);
    }, 3200);
  }, []);

  /* ───── Where they are, back to the server ───── */
  const save = useCallback(() => {
    const v = video.current, l = live.current;
    if (!v || !l.titleId || !v.duration || !isFinite(v.duration) || l.loading) return;
    l.savedAt = Date.now(); l.changed = true;
    void watchApi.progress({ titleId: l.titleId, season: l.ep?.season ?? 0, episode: l.ep?.episode ?? 0, position: Math.floor(v.currentTime), duration: Math.floor(v.duration) });
  }, []);

  /* ───── Loading an episode or a film ───── */
  const pctTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const retry = useRef<((id: string, at: Ref | null, opts?: { version?: number; startAt?: number }) => Promise<void>) | null>(null);
  const loadEpisode = useCallback(async (id: string, at: Ref | null, opts: { version?: number; startAt?: number } = {}) => {
    const v = video.current;
    if (!v) return;
    const token = ++live.current.token;
    Object.assign(live.current, { creditsDone: false, prepared: false, autoSkipped: false, loading: true });
    v.pause();
    setLoading(true); setProblem(null); setPost(null); setPostOut(false); setSkip(null); setCue(""); setPinfo(false); setSheet(null);
    setTime(0); setDuration(0); setBuffered(0); setPct(0); setCtl(true); setEnded(false);
    clearInterval(pctTimer.current);
    pctTimer.current = setInterval(() => setPct((p) => p + (90 - p) * 0.05), 60);
    try {
      const device = await deviceOf();
      const p = await watchApi.play({ titleId: id, ...(at ? { season: at.season, episode: at.episode } : {}), ...(opts.version !== undefined ? { version: opts.version } : {}), device });
      if (token !== live.current.token) return;
      setPlay(p); live.current.play = p;
      setChoice(null);
      attach(v, p);
      if (thumbVideo.current) { thumbVideo.current.removeAttribute("src"); thumbVideo.current.dataset.src = ""; }
      const startAt = opts.startAt ?? p.startAt;
      await new Promise<void>((resolve, reject) => {
        const ok = () => { cleanup(); resolve(); };
        const bad = () => { cleanup(); reject(new Error("media")); };
        const cleanup = () => { v.removeEventListener("loadedmetadata", ok); v.removeEventListener("error", bad); };
        v.addEventListener("loadedmetadata", ok, { once: true });
        v.addEventListener("error", bad, { once: true });
      });
      if (token !== live.current.token) return;
      setPct(96);
      if (startAt > 0 && startAt < v.duration - 5) v.currentTime = startAt;
      v.playbackRate = speed;
      await v.play().catch(() => { /* blocked: the big play button starts it */ });
      if (token !== live.current.token) return;
      clearInterval(pctTimer.current); setPct(100);
      setTimeout(() => { if (token === live.current.token) { setLoading(false); live.current.loading = false; showCtl(); } }, 180);
    } catch (error) {
      if (token !== live.current.token) return;
      clearInterval(pctTimer.current);
      const p = live.current.play;
      /* A file the browser can't open: try the next version once or twice before giving up. */
      if (error instanceof Error && error.message === "media" && p && p.versions.length > p.version.index + 1 && live.current.tries < 2) {
        live.current.tries++;
        void retry.current?.(id, at, { version: p.version.index + 1, startAt: opts.startAt });
        return;
      }
      setProblem(error instanceof Error && error.message !== "media" ? error.message : "This one doesn't play in a browser yet.");
    }
  }, [showCtl, speed]);

  useLayoutEffect(() => { retry.current = loadEpisode; }, [loadEpisode]);

  const open = useCallback(async (id: string, at?: Ref) => {
    live.current.tries = 0; live.current.changed = false;
    setLoading(true); setProblem(null); setView(null); setEp(null); setPlay(null);
    setPct(0); clearInterval(pctTimer.current);
    pctTimer.current = setInterval(() => setPct((p) => p + (60 - p) * 0.04), 60);
    try {
      let v = await watchApi.title(id, at?.season);
      watch.noteView(v);
      let where: Ref | null = null;
      if (v.seasons) {
        const r = v.resume && "season" in v.resume ? v.resume : null;
        where = at ?? (r ? { season: r.season, episode: r.episode } : { season: v.season ?? 1, episode: 1 });
        if (where.season !== v.season) v = await watchApi.title(id, where.season);
      }
      if (live.current.titleId !== id) return;
      setView(v); setEp(where);
      live.current.view = v; live.current.ep = where;
      await loadEpisode(id, where);
    } catch (error) {
      clearInterval(pctTimer.current);
      setProblem(error instanceof Error ? error.message : "That didn't work.");
    }
  }, [loadEpisode, watch]);

  useImperativeHandle(ref, () => ({
    start: (id, at) => {
      const v = video.current;
      /* Unlock sound inside the tap, so the stream can start with it once it arrives. */
      if (v && v.src) { const m = v.muted; v.muted = true; v.play().then(() => { v.pause(); v.muted = m; }).catch(() => { v.muted = m; }); }
      if (!wide() && root.current?.requestFullscreen) {
        root.current.requestFullscreen().then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape")).catch(() => {});
      }
      setTitleId(id); live.current.titleId = id;
      void open(id, at);
    },
  }), [open]);

  const exit = useCallback(() => {
    save();
    live.current.token++;
    clearInterval(pctTimer.current); clearInterval(countTimer.current);
    const v = video.current;
    if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const changed = live.current.changed;
    setTitleId(null); live.current.titleId = null;
    setPlay(null); setView(null); setEp(null); setPost(null); setSheet(null); setLoading(false); setProblem(null); setPinfo(false);
    onExit(changed);
  }, [onExit, save]);

  /* Leaving the page still saves where they were. */
  useEffect(() => {
    const away = () => { if (live.current.titleId) save(); };
    const hidden = () => { if (document.visibilityState === "hidden") away(); };
    window.addEventListener("pagehide", away);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("pagehide", away); document.removeEventListener("visibilitychange", hidden); };
  }, [save]);

  /* ───── Going to another episode ───── */
  const goTo = useCallback(async (to: Ref, startAt?: number) => {
    const id = live.current.titleId;
    if (!id) return;
    save();
    live.current.tries = 0;
    setEp(to); live.current.ep = to;
    if (live.current.view && live.current.view.season !== to.season) {
      try { const v = await watchApi.title(id, to.season); setView(v); live.current.view = v; } catch { /* the old list will do */ }
    }
    void loadEpisode(id, to, { startAt });
  }, [loadEpisode, save]);
  const playNext = useCallback(() => {
    const next = live.current.play?.next;
    if (next) void goTo({ season: next.season, episode: next.episode }, 0);
  }, [goTo]);

  /* ───── After the episode: next one, the filler question, or the end card ───── */
  const endNextUp = useCallback(() => {
    clearInterval(countTimer.current);
    setPostOut(true);
    setTimeout(() => { if (live.current.post !== "end") { setPost(null); setPostOut(false); } }, 350);
    live.current.post = null;
  }, []);
  const startPost = useCallback(() => {
    const p = live.current.play;
    if (!p) return;
    setSheet(null); setPinfo(false); setPostOut(false);
    if (p.fillerAhead) { setPost("ask"); live.current.post = "ask"; return; }
    if (p.next) {
      setPost("next"); live.current.post = "next";
      clearInterval(countTimer.current); setCountdown(0);
      if (p.autoplayNext) {
        const started = performance.now(), total = 8;
        countTimer.current = setInterval(() => {
          if (live.current.buffering) return;
          const gone = (performance.now() - started) / 1000;
          setCountdown(Math.min(1, gone / total));
          if (gone >= total) { clearInterval(countTimer.current); playNext(); }
        }, 50);
      }
      return;
    }
    setPost("end"); live.current.post = "end";
  }, [playNext]);

  /* ───── The video's own events ───── */
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onTime = () => {
      const t = v.currentTime, d = v.duration || 0, l = live.current, p = l.play;
      if (!l.drag) setTime(t);
      if (!p || l.loading || !d) return;
      /* Skip intro, skip recap; skipped by itself for people who asked. */
      const { intro, recap, credits } = p.markers;
      if (intro && p.skipIntros && !l.autoSkipped && t >= intro[0] && t < intro[1] - 1) { l.autoSkipped = true; v.currentTime = intro[1]; return; }
      const span = recap && t >= recap[0] && t < recap[1] ? { label: "Skip recap", s: recap } : intro && t >= intro[0] && t < intro[1] ? { label: "Skip intro", s: intro } : null;
      setSkip(span && !l.post ? { label: span.label, to: span.s[1], left: (t - span.s[0]) / (span.s[1] - span.s[0]) } : null);
      /* Credits: the corner vignette for what's next, or the end card. */
      const series = Boolean(l.view?.seasons);
      const creditsAt = credits ?? (series ? d - 20 : Infinity);
      if (t < creditsAt - 1) { l.creditsDone = false; if (l.post === "next" || l.post === "ask") endNextUp(); }
      if (t >= creditsAt && !l.creditsDone && !l.post && !l.buffering) startPost();
      /* Most of the way in: get the next one ready. */
      if (series && !l.prepared && t / d >= 0.7 && l.titleId && l.ep) {
        l.prepared = true;
        void deviceOf().then((device) => watchApi.prepare({ titleId: l.titleId!, season: l.ep!.season, episode: l.ep!.episode, device })).catch(() => {});
      }
      if (!v.paused && Date.now() - l.savedAt > 10_000) save();
    };
    const onPlay = () => { setPaused(false); setPinfo(false); };
    const onPause = () => { setPaused(true); if (!live.current.loading) { save(); showCtl(true); } };
    const onWaiting = () => setBuffering(true);
    const onGoing = () => setBuffering(false);
    const onProgress = () => { if (v.buffered.length && v.duration) setBuffered(v.buffered.end(v.buffered.length - 1) / v.duration); };
    const onMeta = () => {
      setDuration(v.duration || 0);
      /* Tracks the file carries itself: pick the ones the server planned. */
      const p = live.current.play;
      const texts = Array.from(v.textTracks ?? []).filter((t) => t.kind === "subtitles" || t.kind === "captions");
      setTextTracks(texts.map((t, i) => ({ key: String(i), label: t.label || languageName(t.language) || `Track ${i + 1}`, language: t.language })));
      const want = p?.tracks.subtitles;
      const signs = (t: TextTrack) => (want?.signsTitles ?? []).some((s) => t.label.toLowerCase().includes(s));
      const pick = want ? texts.find((t) => want.tags.includes(t.language) && (want.kind === "signs" ? signs(t) : !signs(t))) ?? texts.find((t) => want.tags.includes(t.language)) : null;
      texts.forEach((t) => { t.mode = t === pick ? "hidden" : "disabled"; });
      setTextOn(pick ? String(texts.indexOf(pick)) : null);
      const audios = (v as HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { language: string; label: string; enabled: boolean } } }).audioTracks;
      if (audios && audios.length > 1) {
        const list: LocalTrack[] = [];
        for (let i = 0; i < audios.length; i++) list.push({ key: String(i), label: audios[i].label || languageName(audios[i].language), language: audios[i].language });
        setAudioTracks(list);
        const tags = p?.tracks.audio.tags ?? [];
        let found = false;
        for (let i = 0; i < audios.length; i++) { const hit: boolean = !found && tags.includes(audios[i].language); audios[i].enabled = hit; found ||= hit; }
        if (!found) audios[0].enabled = true;
      } else setAudioTracks([]);
    };
    const onEnded = () => {
      const l = live.current;
      if (l.post === "next") { playNext(); return; }
      if (l.post === "ask") return;
      setEnded(true);
      save();
      if (!l.post) startPost();
    };
    const onCue = () => {
      const shown = Array.from(v.textTracks ?? []).find((t) => t.mode === "hidden");
      const cues = shown?.activeCues ? Array.from(shown.activeCues) as VTTCue[] : [];
      setCue(cues.map((c) => c.text.replace(/<[^>]+>/g, "")).join("\n"));
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay); v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWaiting); v.addEventListener("playing", onGoing); v.addEventListener("canplay", onGoing); v.addEventListener("seeked", onGoing);
    v.addEventListener("progress", onProgress); v.addEventListener("loadedmetadata", onMeta); v.addEventListener("ended", onEnded);
    v.textTracks?.addEventListener("change", onCue);
    const cueTimer = setInterval(onCue, 250);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay); v.removeEventListener("pause", onPause);
      v.removeEventListener("waiting", onWaiting); v.removeEventListener("playing", onGoing); v.removeEventListener("canplay", onGoing); v.removeEventListener("seeked", onGoing);
      v.removeEventListener("progress", onProgress); v.removeEventListener("loadedmetadata", onMeta); v.removeEventListener("ended", onEnded);
      v.textTracks?.removeEventListener("change", onCue);
      clearInterval(cueTimer);
    };
  }, [endNextUp, playNext, save, showCtl, startPost]);

  /* "You're watching": a long pause shows what this is. */
  const [pausedAt, setPausedAt] = useState(0);
  useEffect(() => {
    if (!paused || post || sheet || loading || !titleId) return;
    const t = setTimeout(() => { setPinfo(true); setCtl(false); setPausedAt(Date.now()); }, 5000);
    return () => clearTimeout(t);
  }, [paused, post, sheet, loading, titleId]);
  const pauseCard = pinfo && pausedAt > 0 && paused && !post && !sheet && !loading;

  useEffect(() => {
    const change = () => setFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  /* ───── Actions ───── */
  const togglePlay = useCallback(() => { const v = video.current; if (!v) return; if (v.paused) void v.play().catch(() => {}); else v.pause(); }, []);
  const seek = useCallback((by: number) => { const v = video.current; if (!v || !v.duration) return; v.currentTime = Math.min(Math.max(0, v.currentTime + by), v.duration); }, []);
  const ripple = (side: "l" | "r") => setRip((r) => ({ ...r, [side]: r[side] + 1 }));
  const toggleFs = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (root.current?.requestFullscreen) void root.current.requestFullscreen().catch(() => watch.toast("Full screen isn’t available here"));
    else watch.toast("Full screen isn’t available here");
  }, [watch]);
  const toggleMute = useCallback(() => { const v = video.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); }, []);
  const doSkip = () => { const v = video.current; if (v && skip) { v.currentTime = skip.to; setSkip(null); } };
  const openSheet = (kind: Sheet) => { setSheet((s) => (s === kind ? null : kind)); showCtl(true); };
  const closeSheet = useCallback(() => { setSheet(null); showCtl(); }, [showCtl]);

  /* Keyboard: space or K, arrows or J/L, F, M, S to skip, N for next, Esc. */
  useEffect(() => {
    if (!titleId) return;
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches?.("input, textarea")) return;
      const k = event.key.toLowerCase();
      if (k === " " || k === "k") { event.preventDefault(); togglePlay(); }
      else if (k === "arrowleft" || k === "j") { seek(-10); ripple("l"); }
      else if (k === "arrowright" || k === "l") { seek(10); ripple("r"); }
      else if (k === "f") toggleFs();
      else if (k === "m") toggleMute();
      else if (k === "s" && skip) doSkip();
      else if (k === "n" && live.current.play?.next) playNext();
      else if (k === "escape") { event.stopPropagation(); if (live.current.sheet) closeSheet(); else if (!document.fullscreenElement) exit(); }
      else return;
      showCtl();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  });

  /* Taps: a mouse click plays or pauses; a touch shows the controls; a double tap on a side seeks. */
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onPointerUp = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest("button, .kw-scrub, .kw-psheet, input, .kw-post, .kw-pload")) return;
    if (event.pointerType === "mouse") { if (sheet) { closeSheet(); return; } togglePlay(); showCtl(); return; }
    const now = Date.now(), side = event.clientX < innerWidth * 0.38 ? "l" : event.clientX > innerWidth * 0.62 ? "r" : null;
    if (now - lastTap.current < 300 && side) { clearTimeout(tapTimer.current); seek(side === "l" ? -10 : 10); ripple(side); lastTap.current = 0; return; }
    lastTap.current = now; clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => { if (ctl && !sheet) setCtl(false); else showCtl(); }, 260);
  };

  /* ───── The scrubber, with a picture of where you'd land ───── */
  const atX = (x: number) => { const r = track.current!.getBoundingClientRect(); return Math.min(Math.max(0, (x - r.left) / r.width), 1); };
  const pending = useRef<number | null>(null);
  const drawAt = useCallback((t: number) => {
    const tv = thumbVideo.current, p = live.current.play, v = video.current;
    if (!tv || !p || !v) return;
    const src = thumbSource(v, p);
    if (tv.dataset.src !== src) { tv.src = src; tv.dataset.src = src; }
    if (tv.seeking || tv.readyState < 1) { pending.current = t; return; }
    pending.current = null;
    tv.currentTime = t;
  }, []);
  useEffect(() => {
    const tv = thumbVideo.current;
    if (!tv) return;
    const drawn = () => {
      const c = canvas.current;
      if (c) c.getContext("2d")?.drawImage(tv, 0, 0, c.width, c.height);
      if (pending.current !== null) { const t = pending.current; pending.current = null; tv.currentTime = t; }
    };
    const ready = () => { if (pending.current !== null) { const t = pending.current; pending.current = null; tv.currentTime = t; } };
    tv.addEventListener("seeked", drawn);
    tv.addEventListener("loadedmetadata", ready);
    return () => { tv.removeEventListener("seeked", drawn); tv.removeEventListener("loadedmetadata", ready); };
  }, []);
  const peek = (f: number) => { setPeekAt(f); setTrackW(track.current?.getBoundingClientRect().width ?? 0); drawAt(f * (duration || 0)); };

  const d = duration || 1;
  const shownT = drag !== null ? drag * d : time;
  const peekF = drag ?? peekAt;
  const peekT = peekF !== null ? peekF * d : 0;
  const markers = play?.markers ?? {};
  const chapter = peekF === null ? "" : markers.intro && peekT >= markers.intro[0] && peekT < markers.intro[1] ? "Intro" : markers.recap && peekT >= markers.recap[0] && peekT < markers.recap[1] ? "Recap" : markers.credits && peekT >= markers.credits ? "Credits" : "";
  const thumbLeft = peekF !== null ? Math.min(Math.max(peekF * trackW, 88), Math.max(88, trackW - 88)) : 0;
  const segs: [number, number][] = [];
  if (duration) {
    if (markers.recap) segs.push(markers.recap);
    if (markers.intro) segs.push(markers.intro);
    if (markers.credits) segs.push([markers.credits, duration]);
  }

  /* ───── Audio and subtitles ───── */
  const audioNow = choice?.audio ?? play?.tracks.audio.language ?? "";
  const subsNow = choice?.subtitles ?? (play?.tracks.subtitles ? (play.tracks.subtitles.kind === "signs" ? "signs" : play.tracks.subtitles.language) : "off");
  const setTracks = async (audio: string, subtitles: string, reload: boolean) => {
    const id = live.current.titleId, v = video.current;
    if (!id || !v) return;
    setChoice({ audio, subtitles });
    const a = two(audio) ?? two(play?.tracks.audio.language ?? "") ?? "en";
    void watchApi.mark(id, { tracks: { audio: a, subtitles } }).catch(() => {});
    if (reload) { setSheet(null); void loadEpisode(id, live.current.ep, { startAt: v.currentTime }); }
  };
  const pickText = (key: string) => {
    const v = video.current;
    if (!v) return;
    const texts = Array.from(v.textTracks).filter((t) => t.kind === "subtitles" || t.kind === "captions");
    texts.forEach((t, i) => { t.mode = String(i) === key ? "hidden" : "disabled"; });
    setTextOn(key === "off" ? null : key);
    const chosen = texts[Number(key)];
    void setTracks(audioNow, key === "off" ? "off" : two(chosen?.language ?? "") ?? "off", false);
    setChoice({ audio: audioNow, subtitles: key === "off" ? "off" : `t:${key}` });
    setCue("");
  };
  const pickAudio = (key: string) => {
    const v = video.current as HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { enabled: boolean; language: string } } };
    if (!v?.audioTracks) return;
    for (let i = 0; i < v.audioTracks.length; i++) v.audioTracks[i].enabled = String(i) === key;
    const lang = v.audioTracks[Number(key)]?.language ?? "";
    void setTracks(lang, subsNow.startsWith("t:") ? "off" : subsNow, false);
    setChoice((c) => ({ audio: `a:${key}`, subtitles: c?.subtitles ?? subsNow }));
  };

  /* ───── What the screen says ───── */
  const t = view?.title;
  const epLine = ep && episode ? `S${ep.season}:E${ep.episode} · ${episode.name}` : "";
  const next = play?.next ?? null;
  const fill = play?.fillerAhead ?? null;
  const recs = t ? alike(watch.known(), t.id, t.shelf, 3) : [];
  const nextAir = future(t?.nextAirDate);
  const reminding = t ? watch.marksOf(t.id).reminding : false;
  const sk = buffering && !loading;

  return <div ref={root} className={cx("kw-player", ctl && "kw-ctl", loading && "kw-loading", (post === "next" || post === "ask") && "kw-postnext", post === "end" && "kw-postplay")} hidden={!titleId}
    onMouseMove={() => { showCtl(); if (pinfo) setPinfo(false); }} onTouchStart={() => { if (pinfo) setPinfo(false); }} onPointerUp={onPointerUp}>
    <video ref={video} className="kw-pv" playsInline preload="auto" />
    <video ref={thumbVideo} muted playsInline preload="metadata" style={{ display: "none" }} />
    <div className="kw-shade" />
    <div className="kw-subs">{cue ? <span>{cue}</span> : null}</div>
    {(["l", "r"] as const).map((side) => <div key={`${side}${rip[side]}`} className={cx("kw-ripple", `kw-${side}`, rip[side] > 0 && "kw-go")}>
      <div><Icon name={side === "l" ? "rw" : "ff"} />10 seconds</div>
    </div>)}
    <div className={cx("kw-spin", sk && "kw-on")}><Wavy r={30} amp={2.6} waves={10} width={5} /></div>
    <div className={cx("kw-pload", (loading || problem) && "kw-on")}>
      {problem ? <div className="kw-oops"><p>{problem}</p><div className="kw-btns" style={{ justifyContent: "center" }}>
        <button className="kw-btn kw-tonal" onClick={exit}>Back</button>
        {play && play.versions.length > play.version.index + 1 ? <button className="kw-btn kw-primary" onClick={() => { live.current.tries = 0; void loadEpisode(titleId!, ep, { version: play.version.index + 1 }); }}>Try another version</button> : null}
      </div></div> : <>
        <div className="kw-ring"><Wavy r={30} amp={2.4} waves={10} width={4} /><span className="kw-pct">{Math.floor(pct)}%</span></div>
        <div className="kw-lbl"><b>{t?.name ?? ""}</b><span>{epLine}</span></div>
      </>}
    </div>
    <div className={cx("kw-pause-info", pauseCard && "kw-on")}>
      {t ? <div><small>You’re watching</small><TitleMark name={t.name} logo={t.logo} />{!movie && ep && episode ? <p><b>Season {ep.season}: Episode {ep.episode} “{episode.name}”</b></p> : null}<p>{(movie ? t.overview : episode?.overview) || t.overview}</p></div> : null}
    </div>
    <div className="kw-p-top">
      <button className="kw-pbtn" aria-label="Back to browse" onClick={exit}><Icon name="back" /></button>
      <div className="kw-ttl">{t ? <><b>{t.name}</b>{!movie && ep && episode ? <>&nbsp; E{ep.episode} · {episode.name}</> : null}</> : null}</div>
      <button className="kw-pbtn" aria-label="Full screen" onClick={toggleFs}><Icon name={fs ? "fsx" : "fs"} /></button>
    </div>
    <div className="kw-p-mid">
      <button className="kw-pbtn kw-seek" aria-label="Back 10 seconds" onClick={() => { seek(-10); ripple("l"); }}><SeekIcon name="rw" /></button>
      <button className="kw-pbtn kw-big" aria-label={paused ? "Play" : "Pause"} onClick={togglePlay}><Icon name={paused ? "play" : "pause"} /></button>
      <button className="kw-pbtn kw-seek" aria-label="Forward 10 seconds" onClick={() => { seek(10); ripple("r"); }}><SeekIcon name="ff" /></button>
    </div>
    <div className="kw-p-bot">
      <div className={cx("kw-scrub", drag !== null && "kw-drag", peekAt !== null && drag === null && "kw-peek")}
        onPointerMove={(event) => { if (drag !== null) { const f = atX(event.clientX); setDrag(f); peek(f); } else if (event.pointerType === "mouse") peek(atX(event.clientX)); }}
        onPointerLeave={() => setPeekAt(null)}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const f = atX(event.clientX); setDrag(f); peek(f); showCtl(true); }}
        onPointerUp={(event) => { if (drag === null) return; const v = video.current; const f = atX(event.clientX); setDrag(null); setPeekAt(null); if (v && v.duration) { v.currentTime = f * v.duration; setTime(v.currentTime); } showCtl(); }}>
        <div className="kw-track" ref={track}>
          <div className="kw-buf" style={{ width: `${buffered * 100}%` }} />
          <div className="kw-fill" style={{ width: `${(shownT / d) * 100}%` }} />
          {segs.map(([a, b]) => <div key={a} className="kw-seg" style={{ left: `${(a / d) * 100}%`, width: `${((b - a) / d) * 100}%` }} />)}
          <div className="kw-knob" style={{ left: `${(shownT / d) * 100}%` }} />
          <div className="kw-thumb" style={{ left: thumbLeft }}>
            <em>{chapter}</em>
            <div className="kw-img"><canvas ref={canvas} width={192} height={108} /></div>
            <span>{clock(peekT)}</span>
          </div>
        </div>
        <span className="kw-time">-{clock(Math.max(0, d - shownT))}</span>
      </div>
      <div className="kw-p-row">
        <button className="kw-pbtn kw-dsk" aria-label={paused ? "Play" : "Pause"} onClick={togglePlay}><Icon name={paused ? "play" : "pause"} /></button>
        <button className="kw-pbtn kw-dsk" aria-label="Back 10 seconds" onClick={() => seek(-10)}><SeekIcon name="rw" /></button>
        <button className="kw-pbtn kw-dsk" aria-label="Forward 10 seconds" onClick={() => seek(10)}><SeekIcon name="ff" /></button>
        <div className="kw-vol kw-dsk">
          <button className="kw-pbtn" aria-label="Mute" onClick={toggleMute}><Icon name={muted || volume === 0 ? "mute" : "vol"} /></button>
          <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Volume" onChange={(event) => { const v = video.current; if (!v) return; v.volume = Number(event.target.value); v.muted = v.volume === 0; setVolume(v.volume); setMuted(v.muted); }} />
        </div>
        <div className="kw-name">{t ? <><b>{t.name}</b>{!movie && ep && episode ? <>&nbsp; S{ep.season}:E{ep.episode} “{episode.name}”</> : null}</> : null}</div>
        <button className="kw-pbtn kw-lab" aria-label="Playback speed" onClick={() => openSheet("speed")}><Icon name="speed" /><span>Speed</span></button>
        {!movie ? <button className="kw-pbtn kw-lab" aria-label="Episodes" onClick={() => openSheet("eps")}><Icon name="eps" /><span>Episodes</span></button> : null}
        <button className="kw-pbtn kw-lab" aria-label="Audio and subtitles" onClick={() => openSheet("cc")}><Icon name="cc" /><span>Audio &amp; subtitles</span></button>
        {next ? <button className="kw-pbtn kw-lab" aria-label="Next episode" onClick={playNext}><Icon name="next" /><span>Next episode</span></button> : null}
        <button className="kw-pbtn kw-dsk" aria-label="Full screen" onClick={toggleFs}><Icon name={fs ? "fsx" : "fs"} /></button>
      </div>
    </div>
    <button className={cx("kw-skip", skip && "kw-on")} style={{ "--left": `${(skip?.left ?? 0) * 100}%` } as React.CSSProperties} onClick={doSkip}><span>{skip?.label ?? "Skip intro"}</span><Icon name="next" /></button>

    <div className={cx("kw-psheet", sheet && "kw-on")} role="dialog">
      {sheet === "cc" && play ? <div className="kw-cols">
        <div><h4>Audio</h4>
          {audioTracks.length ? audioTracks.map((a) => <button key={a.key} className={cx("kw-opt", audioNow === `a:${a.key}` || (!audioNow.startsWith("a:") && play.tracks.audio.tags.includes(a.language)) ? "kw-sel" : null)} onClick={() => pickAudio(a.key)}><Icon name="check" />{a.label}</button>)
            : (play.languages.audio.filter(two).length ? play.languages.audio.filter(two) : [audioNow]).map((lang) => <button key={lang} className={cx("kw-opt", lang === audioNow && "kw-sel")} onClick={() => { if (lang !== audioNow) void setTracks(lang, subsNow, true); }}><Icon name="check" />{languageName(lang)}</button>)}
        </div>
        <div><h4>Subtitles</h4>
          <button className={cx("kw-opt", (textTracks.length ? textOn === null : subsNow === "off") && "kw-sel")} onClick={() => (textTracks.length ? pickText("off") : void setTracks(audioNow, "off", true))}><Icon name="check" />Off</button>
          {textTracks.length ? textTracks.map((s) => <button key={s.key} className={cx("kw-opt", textOn === s.key && "kw-sel")} onClick={() => pickText(s.key)}><Icon name="check" />{s.label}</button>)
            : <>
              {play.languages.subtitles.filter(two).map((lang) => <button key={lang} className={cx("kw-opt", subsNow === lang && "kw-sel")} onClick={() => { if (lang !== subsNow) void setTracks(audioNow, lang, true); }}><Icon name="check" />{languageName(lang)}</button>)}
              <button className={cx("kw-opt", subsNow === "signs" && "kw-sel")} onClick={() => { if (subsNow !== "signs") void setTracks(audioNow, "signs", true); }}><Icon name="check" />Signs &amp; songs</button>
            </>}
        </div>
      </div> : null}
      {sheet === "speed" ? <><h4>Playback speed</h4><div className="kw-speeds">{speeds.map((x) => <button key={x} className={cx(speed === x && "kw-sel")} onClick={() => { setSpeed(x); if (video.current) video.current.playbackRate = x; }}><i />{x}x{x === 1 ? " (Normal)" : ""}</button>)}</div></> : null}
      {sheet === "eps" && ep ? <EpisodeList episodes={episodes} ep={ep} progress={time / d} onPick={(n) => { setSheet(null); void goTo({ season: ep.season, episode: n }); }} /> : null}
    </div>

    <div className={cx("kw-post", postOut && "kw-out")}>
      {post === "ask" && fill ? <>
        <div className="kw-vig" />
        <div className="kw-nx kw-ask">
          <div className="kw-ask-tx"><b>{fill.count > 1 ? `Episodes ${fill.first.episode}–${fill.first.episode + fill.count - 1} are filler` : `Episode ${fill.first.episode} is filler`}</b><span>Skip fillers automatically?</span></div>
          <div className="kw-ask-btns">
            <button className="kw-btn kw-tonal" onClick={() => { void watchApi.setPrefs({ fillers: "watch" }); void goTo(fill.first, 0); }}>Watch {fill.count > 1 ? "them" : "it"}</button>
            <button className="kw-btn kw-primary" onClick={() => {
              void watchApi.setPrefs({ fillers: "skip" });
              if (fill.canon) { watch.toast(`Skipping to episode ${fill.canon.episode}`); void goTo(fill.canon, 0); }
              else { watch.toast("Fillers will be skipped"); setPost("end"); live.current.post = "end"; }
            }}><Icon name="next" />Skip fillers</button>
          </div>
        </div>
      </> : null}
      {post === "next" && next ? <>
        <div className="kw-vig" />
        <div className="kw-nx">
          {next.skipped ? <span className="kw-nx-note">Skipping {next.skipped} filler episode{next.skipped > 1 ? "s" : ""}</span> : null}
          <button className="kw-btn kw-tonal" onClick={() => { live.current.creditsDone = true; endNextUp(); showCtl(); }}>Watch credits</button>
          <button className="kw-btn kw-primary kw-countdown" title={`S${next.season}:E${next.episode}`} onClick={() => { clearInterval(countTimer.current); playNext(); }}><i style={{ width: `${countdown * 100}%` }} /><Icon name="next" /><span>Next episode</span></button>
        </div>
      </> : null}
      {post === "end" && t ? <>
        <div className="kw-bg"><Img src={t.backdropLarge ?? t.backdrop} eager /></div>
        {!ended ? <button className="kw-credits-btn" aria-label="Watch credits" onClick={() => { live.current.creditsDone = true; setPost(null); live.current.post = null; showCtl(); }}><span>Watch credits</span></button> : null}
        <button className="kw-pbtn kw-back" aria-label="Back to browse" onClick={exit}><Icon name="close" /></button>
        <div className="kw-card-n">
          <small>{movie ? "Up next for you" : `You finished Season ${ep?.season ?? 1}`}</small>
          <h2>{movie ? "More like this" : nextAir ? `Next episode ${airText(nextAir)}` : "You’re all caught up"}</h2>
          {!movie && nextAir ? <>
            <p>We’ll tell you the moment it lands.</p>
            <div className="kw-btns" style={{ justifyContent: "flex-start" }}>
              <button className="kw-btn kw-primary" onClick={() => watch.remind(t.id, !reminding, t.name)}><Icon name={reminding ? "check" : "bell"} /><span>{reminding ? "Reminding you" : "Remind me"}</span></button>
            </div>
          </> : null}
          {recs.length ? <div className="kw-recs">{recs.map((c) => <button key={c.id} aria-label={`Play ${c.name}`} onClick={() => { save(); setTitleId(c.id); live.current.titleId = c.id; void open(c.id); }}><Img src={c.backdrop ?? c.poster} /><span>{c.name}</span></button>)}</div> : null}
        </div>
      </> : null}
    </div>
  </div>;
}

function EpisodeList({ episodes, ep, progress, onPick }: { episodes: Episode[]; ep: Ref; progress: number; onPick: (n: number) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector(".kw-now")?.scrollIntoView({ block: "center" }); }, []);
  return <div ref={list}><h4>Season {ep.season}</h4>
    {episodes.filter(aired).map((e) => {
      const now = e.number === ep.episode;
      const f = now ? progress : e.fraction;
      return <button key={e.number} className={cx("kw-pep", now && "kw-now")} onClick={() => { if (!now) onPick(e.number); }}>
        <div className="kw-th"><Img src={e.still} />{f > 0 ? <div className="kw-bar"><i style={{ width: `${f * 100}%` }} /></div> : null}</div>
        <div><b>{e.number}. {e.name}</b><span>{e.runtime ? `${e.runtime}m` : ""}{e.filler ? " · Filler" : e.recap ? " · Recap" : ""}</span></div>
      </button>;
    })}
  </div>;
}
