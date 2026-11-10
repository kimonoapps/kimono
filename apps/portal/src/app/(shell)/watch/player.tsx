"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref as ReactRef } from "react";
import { airText, clock, deviceOf, labelOf, languageName, longLabel, shownNumber, watchApi, type Episode, type Play, type Ref, type TitleView } from "./api";
import { alike, cx, Img, TitleMark, useTabTitle, useWatch } from "./bits";
import { subtitleClass } from "./settings";
import { InkLoader, InkRing } from "@kimono/ui";
import { Icon, SeekIcon } from "./icons";
import { attach, attachThumb, type Attached } from "./source";
import { correction, PartyLink, positionAt, reactionSet, screenId, together, type ChatLine, type PartyView, type Person, type Reaction } from "./party";

/*
 * The player: the stream fills the screen, the controls come and go, and the
 * end of an episode hands over to the next one. Where someone is goes back to
 * the server every ten seconds and whenever they pause or leave.
 */

export type PlayerHandle = {
  start: (id: string, at?: Ref) => void;
  /** Joins a watch party: this screen loads what the party plays and keeps to its timeline. */
  join: (partyId: string) => void;
  /** Where this screen is, to start a party from here. */
  where: () => { titleId: string; season: number; episode: number; position: number } | null;
};
type Post = "next" | "ask" | "end" | null;
type Sheet = "cc" | "speed" | "eps" | "party" | "react" | null;
type Skip = { label: string; to: number; left: number } | null;
type LocalTrack = { key: string; label: string; language: string };

const speeds = [0.5, 0.75, 1, 1.25, 1.5];
const wide = () => matchMedia("(min-width: 900px)").matches;
/** "[9volt] English (Full) ASS" reads "English (Full)"; a bare group name gets its language in front. */
function trackLabel(label: string, language: string) {
  const name = languageName(language.length === 3 ? ({ eng: "en", jpn: "ja", por: "pt", spa: "es", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it", rus: "ru", ara: "ar", chi: "zh", zho: "zh", kor: "ko" } as Record<string, string>)[language] ?? language : language);
  const clean = label.replace(/\[[^\]]*\]/g, "").replace(/\b(ASS|SSA|SRT|PGS|VTT|WEBVTT|SUP)\b/gi, "").replace(/\s+/g, " ").trim();
  if (!clean) return name || label;
  return clean.toLowerCase().includes(name.toLowerCase()) || !name ? clean : `${name} (${clean.replace(/^\((.*)\)$/, "$1")})`;
}
const two = (code: string) => (/^[a-z]{2}$/.test(code) ? code : null);
const aired = (e: Pick<Episode, "airDate">) => !e.airDate || Date.parse(e.airDate) <= Date.now();
const future = (date: string | null | undefined) => (date && Date.parse(date) > Date.now() ? date : null);

type PlayerProps = {
  ref: ReactRef<PlayerHandle>; onExit: (changed: boolean) => void;
  /** Who's signed in, and everyone in the household, for the party's faces. */
  me: string; people: Person[];
  /** "Watch together" from the player: the app asks who to invite. */
  onTogether: () => void;
  /** The party this screen is in, or none, for the address. */
  onParty: (id: string | null) => void;
};

export function Player({ ref, onExit, me, people, onTogether, onParty }: PlayerProps) {
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
  /* After a few seconds of stalling: whose side is slow, the server's or this connection's. */
  const [slow, setSlow] = useState<"server" | "connection" | null>(null);
  const sk = buffering && !loading && !paused;
  useEffect(() => {
    if (!sk || !titleId) return;
    let gone = false;
    const ask = () => void watchApi.health(titleId, ep?.season ?? 0, ep?.episode ?? 0).then((h) => { if (!gone) setSlow(h.slow ?? "connection"); }, () => { if (!gone) setSlow("connection"); });
    const first = setTimeout(ask, 3000);
    const again = setInterval(ask, 6000);
    return () => { gone = true; clearTimeout(first); clearInterval(again); setSlow(null); };
  }, [sk, titleId, ep?.season, ep?.episode]);
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
  const [audioOn, setAudioOn] = useState<string | null>(null);
  const attached = useRef<Attached | null>(null);
  const thumbDetach = useRef<(() => void) | null>(null);
  const [textTracks, setTextTracks] = useState<LocalTrack[]>([]);
  const [choice, setChoice] = useState<{ audio: string; subtitles: string } | null>(null);

  /* What timers and listeners read: the latest, without waiting for a render. */
  const live = useRef({ titleId: null as string | null, ep: null as Ref | null, play: null as Play | null, view: null as TitleView | null, post: null as Post, sheet: null as Sheet, drag: false, buffering: false, loading: false, creditsDone: false, prepared: false, autoSkipped: false, savedAt: 0, token: 0, tries: 0, changed: false, link: null as PartyLink | null, correcting: false, startTimer: undefined as ReturnType<typeof setTimeout> | undefined });
  useLayoutEffect(() => {
    Object.assign(live.current, { titleId, ep, play, view, post, sheet, drag: drag !== null, buffering, loading });
  });
  const countTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [trackW, setTrackW] = useState(0);
  const [textOn, setTextOn] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);

  /* ───── Watching together ───── */
  const [party, setParty] = useState<PartyView | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [floats, setFloats] = useState<Reaction[]>([]);
  const [online, setOnline] = useState(true);
  const [note, setNote] = useState<{ text: string; at: number } | null>(null);
  const [noteGone, setNoteGone] = useState<number | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNoteGone(note.at), 2400);
    return () => clearTimeout(t);
  }, [note]);
  const [myClient] = useState(screenId);
  const chatOpenRef = useRef(false);
  useLayoutEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  const personOf = useCallback((username: string): Person => people.find((p) => p.username.toLowerCase() === username.toLowerCase()) ?? { username, name: username, picture: null }, [people]);
  const firstOf = useCallback((username: string) => (personOf(username).name.trim() || username).split(" ")[0], [personOf]);
  const isHost = Boolean(party && party.host === me.toLowerCase());
  const canSteer = !party || !party.hostOnly || isHost;

  const movie = view ? !view.seasons : false;
  const episodes: Episode[] = view?.episodes ?? [];
  const episode = ep ? episodes.find((e) => (e.season ?? view?.season) === ep.season && e.number === ep.episode) ?? null : null;
  /* "S2:E3", "E27" or "E3": however the title's layout names it. */
  const epLabel = ep ? episode?.label ?? play?.label ?? labelOf(view, ep.season, ep.episode) : "";

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
  /* A quality picked in the player holds for the rest of this sitting, not beyond. */
  const oneOff = useRef<string | null>(null);
  const loadEpisode = useCallback(async (id: string, at: Ref | null, opts: { version?: number; startAt?: number } = {}) => {
    const v = video.current;
    if (!v) return;
    const token = ++live.current.token;
    Object.assign(live.current, { creditsDone: false, prepared: false, autoSkipped: false, loading: true });
    v.pause();
    setLoading(true); setProblem(null); setPost(null); setPostOut(false); setSkip(null); setCue(""); setPinfo(false); setSheet(null);
    setTime(0); setDuration(0); setBuffered(0); setCtl(true); setEnded(false);
    /* Real stages, not a timer: the title is known; the stream, opening it, then buffering fill the rest. */
    setPct(10);
    clearInterval(pctTimer.current);
    try {
      const device = await deviceOf();
      const p = await watchApi.play({ titleId: id, ...(at ? { season: at.season, episode: at.episode } : {}), ...(opts.version !== undefined ? { version: opts.version } : {}), ...(oneOff.current ? { quality: oneOff.current } : {}), ...(opts.startAt !== undefined ? { startAt: opts.startAt } : {}), device });
      if (token !== live.current.token) return;
      setPlay(p); live.current.play = p;
      setPct(30);
      setChoice(null);
      attached.current?.detach();
      thumbDetach.current?.(); thumbDetach.current = null;
      /* Before it starts, a broken stream counts as this version not playing here (the next is tried); after, it's a stop. */
      const link = live.current.link;
      const sameAsParty = link?.state && link.state.timeline.titleId === id && link.state.timeline.season === (at?.season ?? 0) && link.state.timeline.episode === (at?.episode ?? 0);
      const startAt = sameAsParty ? link!.position() : opts.startAt ?? p.startAt;
      attached.current = await attach(v, p, () => {
        if (token !== live.current.token) return;
        if (live.current.loading) v.dispatchEvent(new Event("kw-fatal"));
        else setProblem("The stream stopped. Try again in a moment.");
      }, startAt);
      if (token !== live.current.token) return;
      await new Promise<void>((resolve, reject) => {
        const ok = () => { cleanup(); resolve(); };
        const bad = () => { cleanup(); reject(new Error("media")); };
        const cleanup = () => { v.removeEventListener("loadedmetadata", ok); v.removeEventListener("error", bad); v.removeEventListener("kw-fatal", bad); };
        v.addEventListener("loadedmetadata", ok, { once: true });
        v.addEventListener("error", bad, { once: true });
        v.addEventListener("kw-fatal", bad, { once: true });
      });
      if (token !== live.current.token) return;
      setPct(50);
      if (startAt > 0 && startAt < v.duration - 5) v.currentTime = startAt;
      v.playbackRate = speed;
      /* The second half: how much of the few seconds it needs to start are in. */
      pctTimer.current = setInterval(() => {
        const t = v.currentTime;
        let ahead = 0;
        for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= t + .5 && v.buffered.end(i) > t) ahead = v.buffered.end(i) - t;
        setPct((now) => Math.max(now, Math.min(99, 50 + 50 * Math.min(1, ahead / 4))));
      }, 150);
      /* In a party the timeline says when to play (the follow loop): here it's ready once it can play. */
      if (!live.current.link) await v.play().catch(() => { /* blocked: the big play button starts it */ });
      else await new Promise<void>((done) => {
        if (v.readyState >= 3) { done(); return; }
        const t = setTimeout(done, 20_000);
        v.addEventListener("canplay", () => { clearTimeout(t); done(); }, { once: true });
      });
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
    live.current.tries = 0; live.current.changed = false; oneOff.current = null;
    setLoading(true); setProblem(null); setView(null); setEp(null); setPlay(null);
    setPct(0); clearInterval(pctTimer.current);
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

  const begin = useCallback((id: string, at?: Ref) => {
    const v = video.current;
    /* Unlock sound inside the tap, so the stream can start with it once it arrives. */
    if (v && v.src) { const m = v.muted; v.muted = true; v.play().then(() => { v.pause(); v.muted = m; }).catch(() => { v.muted = m; }); }
    if (!wide() && root.current?.requestFullscreen) {
      root.current.requestFullscreen().then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape")).catch(() => {});
    }
    setTitleId(id); live.current.titleId = id;
    void open(id, at);
  }, [open]);

  /* ───── Joining a party, and leaving it ───── */
  const chatIds = useRef(new Set<string>());
  const prevParty = useRef<PartyView | null>(null);
  const leaveParty = useCallback((tellServer: boolean) => {
    const link = live.current.link;
    if (!link) return;
    if (tellServer) link.leave(); else link.close();
    live.current.link = null; prevParty.current = null; clearTimeout(live.current.startTimer);
    setParty(null); setChat([]); chatIds.current = new Set(); setChatOpen(false); setUnread(0); setFloats([]); setOnline(true);
    if (video.current) video.current.playbackRate = speed;
    onParty(null);
  }, [onParty, speed]);

  const say = useCallback((text: string) => setNote({ text, at: Date.now() }), []);
  const join = useCallback(async (partyId: string) => {
    if (live.current.link?.id === partyId) return;
    leaveParty(true);
    let first: Awaited<ReturnType<typeof together.peek>>;
    try { first = await together.peek(partyId); } catch (error) { watch.toast(error instanceof Error ? error.message : "That didn't work."); return; }
    const link = new PartyLink(partyId, {
      state: (state) => setParty(state),
      chat: (lines) => {
        const fresh = lines.filter((line) => !chatIds.current.has(line.id));
        if (!fresh.length) return;
        for (const line of fresh) chatIds.current.add(line.id);
        setChat((now) => [...now, ...fresh].slice(-50));
        if (!chatOpenRef.current) setUnread((n) => n + fresh.filter((line) => line.username !== me.toLowerCase()).length);
      },
      react: (r) => {
        setFloats((now) => [...now.slice(-14), r]);
        setTimeout(() => setFloats((now) => now.filter((x) => x.id !== r.id)), 2800);
      },
      ended: () => { say("The watch party has ended"); leaveParty(false); },
      online: setOnline,
    });
    link.seed(first.state);
    live.current.link = link;
    for (const line of first.chat) chatIds.current.add(line.id);
    setChat(first.chat);
    onParty(partyId);
    const t = first.state.timeline;
    const at = t.season || t.episode ? { season: t.season, episode: t.episode } : undefined;
    const l = live.current;
    /* Already on what the party plays (it was started from here): just keep to it. */
    if (l.titleId === t.titleId && (!at || (l.ep?.season === at.season && l.ep?.episode === at.episode))) return;
    begin(t.titleId, at);
  }, [begin, leaveParty, me, onParty, say, watch]);

  useImperativeHandle(ref, () => ({
    start: (id, at) => { leaveParty(true); begin(id, at); },
    join: (partyId) => { void join(partyId); },
    where: () => {
      const l = live.current, v = video.current;
      if (!l.titleId || !v) return null;
      return { titleId: l.titleId, season: l.ep?.season ?? 0, episode: l.ep?.episode ?? 0, position: v.currentTime || 0 };
    },
  }), [begin, join, leaveParty]);

  const exit = useCallback(() => {
    save();
    leaveParty(true);
    live.current.token++;
    clearInterval(pctTimer.current); clearInterval(countTimer.current);
    const v = video.current;
    if (v) v.pause();
    attached.current?.detach(); attached.current = null;
    thumbDetach.current?.(); thumbDetach.current = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const changed = live.current.changed;
    setTitleId(null); live.current.titleId = null;
    setPlay(null); setView(null); setEp(null); setPost(null); setSheet(null); setLoading(false); setProblem(null); setPinfo(false);
    onExit(changed);
  }, [leaveParty, onExit, save]);

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
    const shown = live.current.view;
    /* Only a show laid out by season loads its episodes a season at a time. */
    if (shown && (!shown.layout || shown.layout === "seasons") && shown.season !== to.season) {
      try { const v = await watchApi.title(id, to.season); setView(v); live.current.view = v; } catch { /* the old list will do */ }
    }
    void loadEpisode(id, to, { startAt });
  }, [loadEpisode, save]);
  /* ───── In a party, what this screen does goes to everyone ───── */
  /** The party's line, when this screen may steer it; a note says why not otherwise. */
  const steering = useCallback((): PartyLink | null => {
    const link = live.current.link;
    if (!link?.state) return null;
    if (link.state.hostOnly && link.state.host !== me.toLowerCase()) { say(`Only ${firstOf(link.state.host)} can do that`); return null; }
    return link;
  }, [firstOf, me, say]);
  const inParty = () => Boolean(live.current.link?.state);
  /** An episode chosen here: alone it plays; in a party everyone moves to it. */
  const pickEpisode = useCallback((to: Ref) => {
    if (inParty()) {
      const link = steering();
      if (!link) return;
      void link.command("episode", { season: to.season, episode: to.episode });
    }
    void goTo(to, 0);
  }, [goTo, steering]);
  const playNext = useCallback(() => {
    const next = live.current.link?.state?.countdown?.to ?? live.current.play?.next;
    if (next) pickEpisode({ season: next.season, episode: next.episode });
  }, [pickEpisode]);

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
    /* In a party the countdown is everyone's: the server starts it with what the host would play next. */
    const link = live.current.link;
    if (link?.state) {
      live.current.creditsDone = true;
      void link.command("next").then((a) => { if (a?.ok && a.next === null && !live.current.view?.seasons) return; if (a?.ok && a.next === null) { setPost("end"); live.current.post = "end"; } });
      return;
    }
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

  /** Jumps to a moment: alone, here; in a party, for everyone (a seek someone else beat is undone by the state that won). */
  const seekTo = useCallback((to: number) => {
    const v = video.current;
    if (!v || !v.duration) return;
    const at = Math.min(Math.max(0, to), v.duration);
    const link = live.current.link;
    if (link?.state) {
      if (!steering()) return;
      link.assume({ position: at, at: link.now() });
      void link.command("seek", { position: at }).then((a) => { if (a?.reason === "stale") say("Someone else moved it first"); });
    }
    v.currentTime = at;
  }, [say, steering]);

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
      /* In a party only the host's screen skips by itself, and it skips for everyone. */
      const mine = !l.link?.state || l.link.state.host === me.toLowerCase();
      if (intro && p.skipIntros && mine && !l.autoSkipped && t >= intro[0] && t < intro[1] - 1) { l.autoSkipped = true; seekTo(intro[1]); return; }
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
      /* Pick the tracks the server planned, from the stream's own lists. */
      const p = live.current.play, a = attached.current;
      const want = p?.tracks.subtitles;
      const tags = p?.tracks.audio.tags ?? [];
      const isSigns = (label: string) => (want?.signsTitles ?? []).some((x) => label.toLowerCase().includes(x));
      const choose = <T extends { label: string; language: string }>(list: T[]) => (want
        ? list.find((t) => want.tags.includes(t.language) && (want.kind === "signs" ? isSigns(t.label) : !isSigns(t.label))) ?? list.find((t) => want.tags.includes(t.language)) ?? null
        : null);
      if (a?.kind === "hls-js") {
        const subs = a.subtitles(), auds = a.audio();
        setTextTracks(subs.map((t) => ({ key: String(t.id), label: trackLabel(t.label, t.language), language: t.language })));
        setAudioTracks(auds.length > 1 ? auds.map((t) => ({ key: String(t.id), label: trackLabel(t.label, t.language), language: t.language })) : []);
        const sub = choose(subs);
        a.setSubtitles(sub ? sub.id : -1);
        setTextOn(sub ? String(sub.id) : null);
        const aud = auds.find((t) => tags.includes(t.language));
        if (aud) a.setAudio(aud.id);
        setAudioOn(String(aud?.id ?? a.audioNow()));
        return;
      }
      const texts = Array.from(v.textTracks ?? []).filter((t) => t.kind === "subtitles" || t.kind === "captions");
      setTextTracks(texts.map((t, i) => ({ key: String(i), label: t.label || languageName(t.language) || `Track ${i + 1}`, language: t.language })));
      const pick = choose(texts);
      texts.forEach((t) => { t.mode = t === pick ? "hidden" : "disabled"; });
      setTextOn(pick ? String(texts.indexOf(pick)) : null);
      const audios = (v as HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { language: string; label: string; enabled: boolean } } }).audioTracks;
      if (audios && audios.length > 1) {
        const list: LocalTrack[] = [];
        for (let i = 0; i < audios.length; i++) list.push({ key: String(i), label: audios[i].label || languageName(audios[i].language), language: audios[i].language });
        setAudioTracks(list);
        let found = -1;
        for (let i = 0; i < audios.length; i++) { const hit = found < 0 && tags.includes(audios[i].language); audios[i].enabled = hit; if (hit) found = i; }
        if (found < 0) { audios[0].enabled = true; found = 0; }
        setAudioOn(String(found));
      } else setAudioTracks([]);
    };
    const onEnded = () => {
      const l = live.current;
      if (l.link?.state) {
        if (l.post === "next") return;
        setEnded(true); save();
        if (l.play?.next) { l.creditsDone = true; void l.link.command("next"); } else { setPost("end"); l.post = "end"; }
        return;
      }
      if (l.post === "next") { playNext(); return; }
      if (l.post === "ask") return;
      setEnded(true);
      save();
      if (!l.post) startPost();
    };
    const onCue = () => {
      const shown = Array.from(v.textTracks ?? []).find((t) => t.mode === "hidden");
      const cues = shown?.activeCues ? Array.from(shown.activeCues) as VTTCue[] : [];
      /* Fansub karaoke splits a line into syllables, each its own cue: keep whole lines, once each. */
      const texts = cues.map((c) => c.text.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
      const karaoke = texts.length > 3 && texts.filter((x) => !/\s/.test(x) && x.length <= 5).length > texts.length / 2;
      const lines = [...new Set(karaoke ? texts.filter((x) => /\s/.test(x)) : texts)];
      const text = lines.join("\n");
      setCue((now) => (now === text ? now : text));
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
  }, [endNextUp, playNext, save, showCtl, startPost, me, seekTo]);

  /* ───── Keeping to the party's timeline ───── */
  useLayoutEffect(() => {
    follow.current = () => {
      const l = live.current, link = l.link, s = link?.state, v = video.current;
      if (!link || !s || !v || !l.titleId) return;
      const t = s.timeline, now = link.now(), d = v.duration || 0;
      const atEnd = Boolean(d) && v.currentTime >= d - 0.5;
      link.report(l.loading ? "loading" : atEnd ? "ready" : v.seeking || v.readyState < 3 || (l.buffering && !v.paused) ? "buffering" : "ready");
      if (l.loading) return;
      /* The party moved on to another episode (or title): follow it, landing where it is. */
      if (t.titleId !== l.titleId) { begin(t.titleId, t.season || t.episode ? { season: t.season, episode: t.episode } : undefined); return; }
      if (l.view?.seasons && l.ep && (t.season !== l.ep.season || t.episode !== l.ep.episode)) { void goTo({ season: t.season, episode: t.episode }, positionAt(t, now)); return; }
      const expected = positionAt(t, now);
      const go = t.playing && !s.hold && now >= t.at;
      if (!go) {
        if (!v.paused) v.pause();
        v.playbackRate = t.rate;
        l.correcting = false;
        if (!v.seeking && d && expected < d - 0.5 && Math.abs(v.currentTime - expected) > 0.25) v.currentTime = expected;
        /* A start set a moment ahead: be there on the dot. */
        clearTimeout(l.startTimer);
        if (t.playing && !s.hold && now < t.at) l.startTimer = setTimeout(() => follow.current(), Math.max(0, t.at - now));
        return;
      }
      if (d && expected >= d - 0.5) return;
      if (v.paused && !v.ended) void v.play().catch(() => say("Press play to join in"));
      const c = correction(v.currentTime, expected, l.correcting, t.rate);
      l.correcting = c.correcting;
      /* A seek lands a little after it's asked for: aim that much ahead. */
      if (c.seek !== null && !v.seeking) v.currentTime = c.seek + 0.2;
      if (Math.abs(v.playbackRate - c.rate) > 0.001) v.playbackRate = c.rate;
    };
  });
  const partyId = party?.id ?? null;
  useEffect(() => {
    if (!partyId || !titleId) return;
    const timer = setInterval(() => follow.current(), 200);
    return () => clearInterval(timer);
  }, [partyId, titleId]);

  /* Each new state: kept to at once, and what someone else did is said. */
  useEffect(() => {
    if (!party) return;
    follow.current();
    const before = prevParty.current;
    prevParty.current = party;
    const link = live.current.link;
    if (!before || !link) return;
    const name = (u: string) => firstOf(u);
    const here = (p: PartyView) => new Set(p.members.filter((m) => m.present).map((m) => m.username));
    const was = here(before), now = here(party);
    for (const u of now) if (!was.has(u) && u !== me.toLowerCase()) say(`${name(u)} joined`);
    for (const u of was) if (!now.has(u) && u !== me.toLowerCase()) say(`${name(u)} left`);
    const by = party.by;
    if (party.moved !== before.moved && by && by.client !== link.client) {
      const at = clock(party.timeline.position);
      const text = { play: `${name(by.username)} pressed play`, pause: `${name(by.username)} paused`, seek: `${name(by.username)} jumped to ${at}`, rate: `${name(by.username)} set the speed to ${party.timeline.rate}x`, episode: `${name(by.username)} put on episode ${party.timeline.episode}`, "cancel-countdown": `${name(by.username)} is watching the credits`, "skip-wait": `${name(by.username)} started without waiting`, countdown: "", "host-only": "" }[by.type];
      if (text) say(text);
    }
    if (party.hostOnly !== before.hostOnly) say(party.hostOnly ? `Only ${name(party.host)} can steer now` : "Everyone can steer now");
  }, [party, firstOf, me, say]);

  /* The next-episode countdown is the party's: the same on every screen. */
  const countdownEnds = party?.countdown?.endsAt ?? null;
  useEffect(() => {
    const link = live.current.link;
    if (!link) return;
    if (countdownEnds === null) { if (live.current.post === "next") endNextUp(); return; }
    clearInterval(countTimer.current);
    countTimer.current = setInterval(() => {
      if (live.current.post !== "next") { setSheet(null); setPinfo(false); setPostOut(false); setPost("next"); live.current.post = "next"; }
      const left = countdownEnds - link.now();
      setCountdown(Math.min(1, Math.max(0, 1 - left / 10_000)));
      if (left <= 0) clearInterval(countTimer.current);
    }, 50);
    return () => clearInterval(countTimer.current);
  }, [countdownEnds, endNextUp]);

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
  const follow = useRef<() => void>(() => {});
  const togglePlay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    const link = live.current.link;
    if (!link?.state) { if (v.paused) void v.play().catch(() => {}); else v.pause(); return; }
    if (!steering()) return;
    const s = link.state, now = link.now();
    const wants = s.hold ? s.hold.resume : s.timeline.playing;
    if (!s.hold) link.assume({ playing: !wants, position: v.currentTime, at: now });
    void link.command(wants ? "pause" : "play", { position: v.currentTime });
    if (wants) v.pause();
    follow.current();
  }, [steering]);
  const seek = useCallback((by: number) => { const v = video.current; if (!v || !v.duration) return; seekTo(v.currentTime + by); }, [seekTo]);
  const ripple = (side: "l" | "r") => setRip((r) => ({ ...r, [side]: r[side] + 1 }));
  const toggleFs = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (root.current?.requestFullscreen) void root.current.requestFullscreen().catch(() => watch.toast("Full screen isn’t available here"));
    else watch.toast("Full screen isn’t available here");
  }, [watch]);
  const toggleMute = useCallback(() => { const v = video.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); }, []);
  const doSkip = () => { if (skip) { seekTo(skip.to); setSkip(null); } };
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
      else if (k === "escape") { event.stopPropagation(); if (chatOpenRef.current) setChatOpen(false); else if (live.current.sheet) closeSheet(); else if (!document.fullscreenElement) exit(); }
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
    if ((event.target as HTMLElement).closest("button, .kw-scrub, .kw-psheet, input, .kw-post, .kw-pload, .kw-chat, .kw-hold")) return;
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
    if (!thumbDetach.current) thumbDetach.current = attachThumb(tv, p);
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
    const v = video.current, a = attached.current;
    if (!v) return;
    const chosen = textTracks.find((x) => x.key === key);
    if (a?.kind === "hls-js") a.setSubtitles(key === "off" ? -1 : Number(key));
    else Array.from(v.textTracks).filter((t) => t.kind === "subtitles" || t.kind === "captions").forEach((t, i) => { t.mode = String(i) === key ? "hidden" : "disabled"; });
    setTextOn(key === "off" ? null : key);
    setCue("");
    const sub = key === "off" ? "off" : chosen && (play?.tracks.subtitles?.signsTitles ?? ["signs", "songs", "forced"]).some((x) => chosen.label.toLowerCase().includes(x)) ? "signs" : two(chosen?.language ?? "") ?? "off";
    void setTracks(audioNow, sub, false);
  };
  const pickAudio = (key: string) => {
    const v = video.current as HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { enabled: boolean; language: string } } }, a = attached.current;
    if (!v) return;
    if (a?.kind === "hls-js") a.setAudio(Number(key));
    else if (v.audioTracks) for (let i = 0; i < v.audioTracks.length; i++) v.audioTracks[i].enabled = String(i) === key;
    setAudioOn(key);
    const lang = audioTracks.find((x) => x.key === key)?.language ?? "";
    void setTracks(lang, subsNow, false);
  };

  /* ───── What the screen says ───── */
  const t = view?.title;
  useTabTitle(titleId ? t?.name : null);
  const epLine = ep && episode ? `${epLabel} · ${episode.name}` : "";
  const next = party?.countdown?.to ?? play?.next ?? null;
  const fill = play?.fillerAhead ?? null;
  const recs = t ? alike(watch.known(), t.id, t.shelf, 3) : [];
  const nextAir = future(t?.nextAirDate);
  const reminding = t ? watch.marksOf(t.id).reminding : false;

  return <div ref={root} className={cx("kw-player", ctl && "kw-ctl", loading && "kw-loading", (post === "next" || post === "ask") && "kw-postnext", post === "end" && "kw-postplay")} hidden={!titleId}
    onMouseMove={() => { showCtl(); if (pinfo) setPinfo(false); }} onTouchStart={() => { if (pinfo) setPinfo(false); }} onPointerUp={onPointerUp}>
    <video ref={video} className="kw-pv" playsInline preload="auto" />
    <video ref={thumbVideo} muted playsInline preload="metadata" style={{ display: "none" }} />
    <div className="kw-shade" />
    <div className={cx("kw-subs", subtitleClass(watch.prefs))}>{cue ? <span>{cue}</span> : null}</div>
    {(["l", "r"] as const).map((side) => <div key={`${side}${rip[side]}`} className={cx("kw-ripple", `kw-${side}`, rip[side] > 0 && "kw-go")}>
      <div><Icon name={side === "l" ? "rw" : "ff"} />10 seconds</div>
    </div>)}
    <div className={cx("kw-spin", sk && "kw-on")}>{sk ? <InkLoader ink={watch.accent} label="Buffering" /> : null}</div>
    <div className={cx("kw-slow", sk && slow && "kw-on")} role="status">{slow === "server" ? "The server is slow right now" : slow ? "Your connection is slow" : ""}</div>
    <div className={cx("kw-pload", (loading || problem) && "kw-on")}>
      {problem ? <div className="kw-oops"><p>{problem}</p><div className="kw-btns" style={{ justifyContent: "center" }}>
        <button className="kw-btn kw-tonal" onClick={exit}>Back</button>
        {play && play.versions.length > play.version.index + 1 ? <button className="kw-btn kw-primary" onClick={() => { live.current.tries = 0; void loadEpisode(titleId!, ep, { version: play.version.index + 1 }); }}>Try another version</button> : null}
      </div></div> : <>
        <InkRing className="kw-start" value={pct / 100} percent label="Starting" />
        <div className="kw-lbl"><b>{t?.name ?? ""}</b><span>{epLine}</span></div>
      </>}
    </div>
    <div className={cx("kw-pause-info", pauseCard && "kw-on")}>
      {t ? <div><small>You’re watching</small><TitleMark name={t.name} logo={t.logo} />{!movie && ep && episode ? <p><b>{longLabel(epLabel)} “{episode.name}”</b></p> : null}<p>{(movie ? t.overview : episode?.overview) || t.overview}</p></div> : null}
    </div>
    <div className="kw-p-top">
      <button className="kw-pbtn" aria-label="Back to browse" onClick={exit}><Icon name="back" /></button>
      <div className="kw-ttl">{t ? <><b>{t.name}</b>{!movie && ep && episode ? <>&nbsp; {epLabel} · {episode.name}</> : null}</> : null}</div>
      {party ? <button className="kw-faces" aria-label="Who's watching" onClick={() => openSheet("party")}>
        {!online ? <em>Reconnecting…</em> : null}
        {party.members.filter((m) => m.present).slice(0, 5).map((m) => <Face key={m.client} person={personOf(m.username)} state={m.state} />)}
      </button> : null}
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
        onPointerUp={(event) => { if (drag === null) return; const v = video.current; const f = atX(event.clientX); setDrag(null); setPeekAt(null); if (v && v.duration) { seekTo(f * v.duration); setTime(v.currentTime); } showCtl(); }}>
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
        <div className="kw-name">{t ? <><b>{t.name}</b>{!movie && ep && episode ? <>&nbsp; {epLabel} “{episode.name}”</> : null}</> : null}</div>
        <button className="kw-pbtn kw-lab" aria-label="Speed and quality" onClick={() => openSheet("speed")}><Icon name="speed" /><span>Speed &amp; quality</span></button>
        {!movie ? <button className="kw-pbtn kw-lab" aria-label="Episodes" onClick={() => openSheet("eps")}><Icon name="eps" /><span>Episodes</span></button> : null}
        <button className="kw-pbtn kw-lab" aria-label="Audio and subtitles" onClick={() => openSheet("cc")}><Icon name="cc" /><span>Audio &amp; subtitles</span></button>
        {party ? <>
          <button className="kw-pbtn kw-lab" aria-label="React" onClick={() => openSheet("react")}><Icon name="mood" /><span>React</span></button>
          <button className={cx("kw-pbtn kw-lab", unread > 0 && "kw-dot")} aria-label="Chat" onClick={() => { setChatOpen(!chatOpen); setUnread(0); setSheet(null); showCtl(true); }}><Icon name="chat" /><span>Chat</span></button>
        </> : <button className="kw-pbtn kw-lab" aria-label="Watch together" onClick={() => { if (play) onTogether(); }}><Icon name="group" /><span>Watch together</span></button>}
        {next ? <button className="kw-pbtn kw-lab" aria-label="Next episode" onClick={playNext}><Icon name="next" /><span>Next episode</span></button> : null}
        <button className="kw-pbtn kw-dsk" aria-label="Full screen" onClick={toggleFs}><Icon name={fs ? "fsx" : "fs"} /></button>
      </div>
    </div>
    {party ? <Waiting party={party} client={myClient} loading={loading} firstOf={firstOf} canSteer={canSteer} onSkip={() => void live.current.link?.command("skip-wait")} /> : null}
    <div className="kw-floats" aria-hidden="true">{floats.map((f) => <span key={f.id} style={{ "--x": `${(f.id * 37) % 60}px` } as React.CSSProperties}>{f.emoji}<small>{firstOf(f.username)}</small></span>)}</div>
    {party ? <Chat open={chatOpen} lines={chat} me={me} personOf={personOf} onClose={() => { setChatOpen(false); showCtl(); }} onSend={(text) => void live.current.link?.chat(text)} /> : null}
    <div className={cx("kw-pnote", note && noteGone !== note.at && "kw-on")} role="status" aria-live="polite">{note?.text}</div>
    <button className={cx("kw-skip", skip && "kw-on")} style={{ "--left": `${(skip?.left ?? 0) * 100}%` } as React.CSSProperties} onClick={doSkip}><span>{skip?.label ?? "Skip intro"}</span><Icon name="next" /></button>

    <div className={cx("kw-psheet", sheet && "kw-on")} role="dialog">
      {sheet === "cc" && play ? <div className="kw-cols">
        <div><h4>Audio</h4>
          {audioTracks.length ? audioTracks.map((a) => <button key={a.key} className={cx("kw-opt", audioOn === a.key && "kw-sel")} onClick={() => pickAudio(a.key)}><Icon name="check" />{a.label}</button>)
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
        <button className="kw-opt kw-more kw-span" onClick={() => { exit(); watch.openSettings(); }}>Your defaults<Icon name="right" /></button>
      </div> : null}
      {sheet === "speed" ? <><h4>Playback speed</h4><div className="kw-speeds">{speeds.map((x) => <button key={x} className={cx((party ? party.timeline.rate : speed) === x && "kw-sel")} onClick={() => {
        const link = live.current.link;
        if (link?.state) { if (!steering()) return; const v = video.current; link.assume({ rate: x, position: v?.currentTime ?? link.position(), at: link.now() }); void link.command("rate", { rate: x }); return; }
        setSpeed(x); if (video.current) video.current.playbackRate = x;
      }}><i />{x}x{x === 1 ? " (Normal)" : ""}</button>)}</div>
        {play?.quality && play.quality.options.length > 1 ? <div className="kw-quality"><h4>Quality</h4>{play.quality.options.map((q) => <button key={q.value} className={cx("kw-opt", play.quality!.current === q.value && "kw-sel")} onClick={() => {
          if (play.quality!.current === q.value || !titleId || !video.current) return;
          oneOff.current = q.value;
          void loadEpisode(titleId, live.current.ep, { startAt: video.current.currentTime });
        }}><Icon name="check" />{q.label}</button>)}</div> : null}
        <button className="kw-opt kw-more" onClick={() => { exit(); watch.openSettings(); }}>More settings<Icon name="right" /></button>
      </> : null}
      {sheet === "eps" && ep ? <EpisodeList episodes={episodes} ep={ep} bySeason={!view?.layout || view.layout === "seasons"} season={view?.season ?? ep.season} continuous={view?.layout === "continuous"} progress={time / d} onPick={(to) => { setSheet(null); pickEpisode(to); }} /> : null}
      {sheet === "react" && party ? <div className="kw-reacts">{reactionSet.map((e) => <button key={e} aria-label={`React ${e}`} onClick={() => void live.current.link?.react(e)}>{e}</button>)}</div> : null}
      {sheet === "party" && party ? <PartySheet party={party} me={me} client={myClient} people={people} personOf={personOf}
        onInvite={(u) => { void live.current.link?.invite([u]); say(`Invited ${firstOf(u)}`); }}
        onHostOnly={(on) => void live.current.link?.command("host-only", { on })}
        onCopy={() => { const url = `${location.origin}/watch?party=${party.id}`; navigator.clipboard?.writeText(url).then(() => say("Link copied"), () => say(url)); }}
        onLeave={() => { setSheet(null); leaveParty(true); say("You left the watch party"); }} /> : null}
    </div>

    <div className={cx("kw-post", postOut && "kw-out")}>
      {post === "ask" && fill ? <>
        <div className="kw-vig" />
        <div className="kw-nx kw-ask">
          <div className="kw-ask-tx"><b>{fill.count > 1 ? `Episodes ${shownNumber(fill.first.label, fill.first.episode)}–${shownNumber(fill.first.label, fill.first.episode) + fill.count - 1} are filler` : `${longLabel(fill.first.label ?? `E${fill.first.episode}`)} is filler`}</b><span>Skip fillers automatically?</span></div>
          <div className="kw-ask-btns">
            <button className="kw-btn kw-tonal" onClick={() => { void watchApi.setPrefs({ fillers: "watch" }); void goTo(fill.first, 0); }}>Watch {fill.count > 1 ? "them" : "it"}</button>
            <button className="kw-btn kw-primary" onClick={() => {
              void watchApi.setPrefs({ fillers: "skip" });
              if (fill.canon) { watch.toast(`Skipping to ${longLabel(fill.canon.label ?? `E${fill.canon.episode}`).replace(/^E/, "e")}`); void goTo(fill.canon, 0); }
              else { watch.toast("Fillers will be skipped"); setPost("end"); live.current.post = "end"; }
            }}><Icon name="next" />Skip fillers</button>
          </div>
        </div>
      </> : null}
      {post === "next" && next ? <>
        <div className="kw-vig" />
        <div className="kw-nx">
          {next.skipped ? <span className="kw-nx-note">Skipping {next.skipped} filler episode{next.skipped > 1 ? "s" : ""}</span> : null}
          <button className="kw-btn kw-tonal" onClick={() => { live.current.creditsDone = true; if (live.current.link?.state) { if (!steering()) return; void live.current.link.command("cancel-countdown"); } endNextUp(); showCtl(); }}>Watch credits</button>
          <button className="kw-btn kw-primary kw-countdown" title={(next as { label?: string }).label ?? labelOf(view, next.season, next.episode)} onClick={() => { clearInterval(countTimer.current); playNext(); }}><i style={{ width: `${countdown * 100}%` }} /><Icon name="next" /><span>Next episode</span></button>
        </div>
      </> : null}
      {post === "end" && t ? <>
        <div className="kw-bg"><Img src={t.backdropLarge ?? t.backdrop} eager /></div>
        {!ended ? <button className="kw-credits-btn" aria-label="Watch credits" onClick={() => { live.current.creditsDone = true; setPost(null); live.current.post = null; showCtl(); }}><span>Watch credits</span></button> : null}
        <button className="kw-pbtn kw-back" aria-label="Back to browse" onClick={exit}><Icon name="close" /></button>
        <div className="kw-card-n">
          <small>{movie ? "Up next for you" : !view?.layout || view.layout === "seasons" ? `You finished Season ${ep?.season ?? 1}` : "You’re up to date"}</small>
          <h2>{movie ? "More like this" : nextAir ? `Next episode ${airText(nextAir)}` : "You’re all caught up"}</h2>
          {!movie && nextAir ? <>
            <p>We’ll tell you the moment it lands.</p>
            <div className="kw-btns" style={{ justifyContent: "flex-start" }}>
              <button className="kw-btn kw-primary" onClick={() => watch.remind(t.id, !reminding, t.name)}><Icon name={reminding ? "check" : "bell"} /><span>{reminding ? "Reminding you" : "Remind me"}</span></button>
            </div>
          </> : null}
          {recs.length && !party ? <div className="kw-recs">{recs.map((c) => <button key={c.id} aria-label={`Play ${c.name}`} onClick={() => { save(); setTitleId(c.id); live.current.titleId = c.id; void open(c.id); }}><Img src={c.backdrop ?? c.poster} /><span>{c.name}</span></button>)}</div> : null}
        </div>
      </> : null}
    </div>
  </div>;
}

function EpisodeList({ episodes, ep, bySeason, season, continuous, progress, onPick }: {
  episodes: Episode[]; ep: Ref; bySeason: boolean; season: number; continuous: boolean; progress: number; onPick: (to: Ref) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector(".kw-now")?.scrollIntoView({ block: "center" }); }, []);
  return <div ref={list}><h4>{bySeason ? `Season ${ep.season}` : "Episodes"}</h4>
    {episodes.filter(aired).map((e) => {
      const at = e.season ?? season;
      const now = at === ep.season && e.number === ep.episode;
      const f = now ? progress : e.fraction;
      return <button key={`${at}:${e.number}`} className={cx("kw-pep", now && "kw-now")} onClick={() => { if (!now) onPick({ season: at, episode: e.number }); }}>
        <div className="kw-th"><Img src={e.still} />{f > 0 ? <div className="kw-bar"><i style={{ width: `${f * 100}%` }} /></div> : null}</div>
        <div><b>{continuous ? e.absolute ?? e.number : e.number}. {e.name}</b><span>{e.runtime ? `${e.runtime}m` : ""}{e.filler ? " · Filler" : e.recap ? " · Recap" : ""}</span></div>
      </button>;
    })}
  </div>;
}

/* ───── Watching together: faces, the wait, the party's sheet, and chat ───── */

const faces = ["#7E3448", "#3E5236", "#5B3F45", "#8A5A2B", "#3F4A5B", "#5A4A2B"];
const faceOf = (username: string) => faces[[...username].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % faces.length];

function Face({ person, state }: { person: Person; state?: "loading" | "ready" | "buffering" }) {
  const label = `${person.name}${state === "buffering" ? " (buffering)" : state === "loading" ? " (getting ready)" : ""}`;
  return <span className={cx("kw-face-s", state && state !== "ready" && "kw-wait-ring")} style={{ background: faceOf(person.username) }} title={label}>
    {person.picture
      // eslint-disable-next-line @next/next/no-img-element -- the Portal's own portrait
      ? <img src={person.picture} alt="" /> : (person.name.trim() || person.username).charAt(0).toUpperCase()}
  </span>;
}

/** "Waiting for Sami…": who the party is holding for, and a way to go on without them. */
function Waiting({ party, client, loading, firstOf, canSteer, onSkip }: { party: PartyView; client: string; loading: boolean; firstOf: (u: string) => string; canSteer: boolean; onSkip: () => void }) {
  const hold = party.hold;
  const others = hold ? hold.waitingFor.filter((c) => c !== client).map((c) => party.members.find((m) => m.client === c)?.username).filter((u): u is string => Boolean(u)) : [];
  const names = [...new Set(others.map(firstOf))];
  const on = Boolean(hold && names.length && !loading);
  const text = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.length} people`;
  return <div className={cx("kw-hold", on && "kw-on")} role="status" aria-live="polite">
    {on ? <>
      <b>Waiting for {text}…</b>
      {canSteer ? <button className="kw-btn kw-tonal" onClick={onSkip}>Start without {names.length === 1 ? "them" : "everyone"}</button> : null}
    </> : null}
  </div>;
}

function PartySheet({ party, me, client, people, personOf, onInvite, onHostOnly, onCopy, onLeave }: {
  party: PartyView; me: string; client: string; people: Person[]; personOf: (u: string) => Person;
  onInvite: (username: string) => void; onHostOnly: (on: boolean) => void; onCopy: () => void; onLeave: () => void;
}) {
  const here = party.members.filter((m) => m.present);
  const watching = new Set(here.map((m) => m.username));
  const others = people.filter((p) => p.username.toLowerCase() !== me.toLowerCase() && !watching.has(p.username.toLowerCase()));
  const host = party.host === me.toLowerCase();
  return <div className="kw-party">
    <h4>Watching together</h4>
    {here.map((m) => {
      const p = personOf(m.username);
      return <div key={m.client} className="kw-member"><Face person={p} state={m.state} /><b>{p.name}{m.client === client ? " (you)" : ""}</b>
        <span>{m.username === party.host ? "Host" : m.state === "buffering" ? "Buffering" : m.state === "loading" ? "Getting ready" : ""}</span></div>;
    })}
    {others.length ? <><h4>Invite</h4>{others.map((p) => {
      const asked = party.invited.includes(p.username.toLowerCase());
      return <button key={p.username} className="kw-member" disabled={asked} onClick={() => onInvite(p.username)}><Face person={p} /><b>{p.name}</b><span>{asked ? "Invited" : <Icon name="add" />}</span></button>;
    })}</> : null}
    <div className="kw-party-acts">
      <button className="kw-opt" onClick={onCopy}><Icon name="link" />Copy link</button>
      {host ? <button className={cx("kw-opt", party.hostOnly && "kw-sel")} role="switch" aria-checked={party.hostOnly} onClick={() => onHostOnly(!party.hostOnly)}><Icon name="check" />Only I can steer</button> : null}
      <button className="kw-opt" onClick={onLeave}><Icon name="close" />Leave the party</button>
    </div>
  </div>;
}

function Chat({ open, lines, me, personOf, onClose, onSend }: { open: boolean; lines: ChatLine[]; me: string; personOf: (u: string) => Person; onClose: () => void; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [lines, open]);
  useEffect(() => { if (open) input.current?.focus({ preventScroll: true }); }, [open]);
  return <aside className={cx("kw-chat", open && "kw-on")} aria-label="Chat" aria-hidden={!open}>
    <header><b>Chat</b><button className="kw-pbtn" aria-label="Close chat" onClick={onClose}><Icon name="close" /></button></header>
    <div className="kw-lines" ref={list}>
      {lines.length ? lines.map((line) => {
        const p = personOf(line.username);
        return <div key={line.id} className={cx("kw-line", line.username === me.toLowerCase() && "kw-mine")}><Face person={p} /><div><b>{(p.name.trim() || p.username).split(" ")[0]}</b><p>{line.text}</p></div></div>;
      }) : <p className="kw-empty">Say hello.</p>}
    </div>
    <form onSubmit={(event) => { event.preventDefault(); const t = text.trim(); if (!t) return; onSend(t); setText(""); }}>
      <input ref={input} value={text} maxLength={300} placeholder="Message" aria-label="Message" tabIndex={open ? 0 : -1} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }} />
      <button className="kw-pbtn" aria-label="Send" tabIndex={open ? 0 : -1}><Icon name="send" /></button>
    </form>
  </aside>;
}
