"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cx, InkLoader } from "@kimono/ui";
import { Icon } from "./icons";

/*
 * An artifact's sandboxed frame and an animation's controls: shared by the
 * chat (code-app.tsx) and a link's page (link-views.tsx), which needs nothing else.
 */

/** The frame, and the conversation with it: the text as it arrives, its height back. */
export type SceneParam = { name: string; label: string; min: number; max: number; step: number; value: number; unit?: string };
/** voiced: it narrates; muted: its sound is off; blocked: the browser wants a tap before it plays sound. */
export type SceneState = { t: number; end: number; playing: boolean; complete: boolean; count: number; params: SceneParam[]; voiced?: boolean; muted?: boolean; blocked?: boolean; volume?: number; held?: boolean };
export type SceneControl = { n: number; action: "play" | "pause" | "replay" | "seek" | "set" | "sound-on" | "sound-off" | "volume"; t?: number; name?: string; value?: number };

export function ArtifactFrame({ content, final, title, media, control, onHeight, onScene }: { content: string; final: boolean; title: string; media?: string; control: SceneControl | null; onHeight?: (height: number) => void; onScene?: (state: SceneState) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const latest = useRef({ content, final, media });
  const heightTo = useRef(onHeight);
  const sceneTo = useRef(onScene);
  useEffect(() => { heightTo.current = onHeight; sceneTo.current = onScene; }, [onHeight, onScene]);
  const post = useCallback(() => {
    if (!ready.current) return;
    frame.current?.contentWindow?.postMessage({ kimono: "artifact", type: "render", content: latest.current.content, final: latest.current.final, media: latest.current.media }, "*");
  }, []);
  /* A finished animation starts by itself the first time it's in view, once: one paused, watched or
     already playing (as it was written) is left as it is. Not when the person asks for less motion. */
  const scene = useRef<{ t: number; end: number; playing: boolean; complete: boolean } | null>(null);
  const seen = useRef(false);
  const begun = useRef(false);
  const begin = useCallback(() => {
    const s = scene.current;
    if (!s || begun.current) return;
    if (s.playing || s.t > 0.01) { begun.current = true; return; }
    if (!seen.current || !s.complete || s.end <= 0) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { begun.current = true; return; }
    begun.current = true;
    frame.current?.contentWindow?.postMessage({ kimono: "artifact", type: "scene-control", action: "play" }, "*");
  }, []);
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver(([entry]) => { seen.current = entry.isIntersecting; begin(); }, { threshold: 0.5 });
    watch.observe(el);
    return () => watch.disconnect();
  }, [begin]);
  useEffect(() => {
    const hear = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const m = event.data as { kimono?: string; type?: string; height?: number } & Partial<SceneState>;
      if (m?.kimono !== "artifact") return;
      if (m.type === "ready") { ready.current = true; post(); }
      if (m.type === "size" && typeof m.height === "number") heightTo.current?.(m.height);
      if (m.type === "error") console.warn("Artifact:", (m as { message?: string }).message);
      if (m.type === "scene" && typeof m.t === "number" && typeof m.end === "number") { scene.current = { t: m.t, end: m.end, playing: Boolean(m.playing), complete: Boolean(m.complete) }; begin(); }
      if (m.type === "scene" && typeof m.t === "number" && typeof m.end === "number") sceneTo.current?.({ t: m.t, end: m.end, playing: Boolean(m.playing), complete: Boolean(m.complete), count: m.count ?? 1, voiced: Boolean(m.voiced), muted: Boolean(m.muted), blocked: Boolean(m.blocked), held: Boolean(m.held), volume: typeof m.volume === "number" ? m.volume : 1, params: Array.isArray(m.params) ? m.params.filter((p): p is SceneParam => typeof p?.name === "string" && typeof p.min === "number" && typeof p.max === "number" && typeof p.value === "number").slice(0, 8) : [] });
    };
    window.addEventListener("message", hear);
    return () => window.removeEventListener("message", hear);
  }, [post, begin]);
  useEffect(() => { latest.current = { content, final, media }; post(); }, [content, final, media, post]);
  /* A frame sent with the page (a link's page) may have loaded, and said it's ready, before this listened: speak first. Posting to one still loading is lost, and its own "ready" asks again. */
  useEffect(() => { frame.current?.contentWindow?.postMessage({ kimono: "artifact", type: "render", content: latest.current.content, final: latest.current.final, media: latest.current.media }, "*"); }, []);
  useEffect(() => { if (control) frame.current?.contentWindow?.postMessage({ kimono: "artifact", type: "scene-control", action: control.action, t: control.t, name: control.name, value: control.value }, "*"); }, [control]);
  /* The frame says it's ready as it loads, which can be before this page listens: its first load counts too.
     Only the first: the frame fires load again each time it finishes writing a page, and posting then would make it start over. */
  /* autoplay: a narrated scene speaks as it plays, as this page may; without it the frame asks for a tap first */
  return <iframe ref={frame} className="cd-artifact-frame" src="/ai/frame" title={title} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" allow="autoplay"
    onLoad={() => { if (ready.current) return; ready.current = true; post(); }} />;
}

const volumeKey = "kimono.scene-volume";
const savedVolume = () => { try { const v = Number(localStorage.getItem(volumeKey)); return localStorage.getItem(volumeKey) != null && v >= 0 && v <= 1 ? v : null; } catch { return null; } };

/** A narrated animation's sound: the speaker turns it on or off, the slider sets how loud; while the browser holds it back, a tap lets it play. */
function SoundControl({ scene, send }: { scene: SceneState; send: (action: SceneControl["action"], t?: number, name?: string, value?: number) => void }) {
  const volume = scene.volume ?? 1;
  const off = Boolean(scene.muted || scene.blocked || volume === 0);
  /* a new narrated animation starts at the volume last chosen */
  const restored = useRef(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = savedVolume();
    if (saved != null && Math.abs(saved - volume) > .001) send("volume", undefined, undefined, saved);
  }, [send, volume]);
  const label = scene.blocked ? "Turn sound on" : off ? "Unmute" : "Mute";
  const toggle = () => {
    if (scene.blocked && !scene.playing) send("play");
    if (off && volume === 0) send("volume", undefined, undefined, savedVolume() || .8);
    send(off ? "sound-on" : "sound-off");
  };
  if (scene.blocked) return <button type="button" className="cd-scene-sound is-asking" aria-label={label} title={label} onClick={toggle}><Icon name="sound-off" /><span>Tap for sound</span></button>;
  const shown = off ? 0 : volume;
  /* With a mouse the slider rises on hover and the speaker mutes; on a touch screen the speaker opens it, and mute sits inside. */
  const touch = typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches;
  return <div className={cx("cd-scene-volume", open && "is-open")} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
    <button type="button" className="cd-scene-sound" aria-label={touch ? "Volume" : label} title={touch ? "Volume" : label} aria-pressed={touch ? undefined : off} aria-expanded={touch ? open : undefined}
      onClick={() => { if (touch) setOpen(!open); else toggle(); }}><Icon name={off ? "sound-off" : "sound"} /></button>
    <div className="cd-scene-volume-pop" role="group" aria-label="Volume">
      <output>{Math.round(shown * 100)}</output>
      <input type="range" className="cd-scene-volume-range" min={0} max={100} value={Math.round(shown * 100)} aria-label="Volume" aria-orientation="vertical"
        style={{ ["--p" as string]: `${shown * 100}%` }}
        onChange={(event) => {
          const v = +event.target.value / 100;
          try { localStorage.setItem(volumeKey, String(v)); } catch { /* not kept */ }
          send("volume", undefined, undefined, v);
          if (v > 0 && scene.muted) send("sound-on");
        }} />
      {touch ? <button type="button" className="cd-scene-sound cd-scene-mute" aria-label={label} title={label} aria-pressed={off} onClick={toggle}><Icon name={off ? "sound-off" : "sound"} /></button> : null}
    </div>
  </div>;
}

export function SceneBar({ scene, send }: { scene: SceneState; send: (action: SceneControl["action"], t?: number, name?: string, value?: number) => void }) {
  const ended = scene.complete && scene.t >= scene.end - 0.01;
  /* playing, but not all there yet (still being written, or waiting on what it needs): the seal shows it loading, not a pause */
  const loading = scene.playing && (!scene.complete || Boolean(scene.held));
  const label = loading ? "Loading" : scene.playing ? "Pause" : ended ? "Play again" : "Play";
  return <div className="cd-scene-controls">
  {scene.params.length ? <div className="cd-scene-params">{scene.params.map((p) => <label key={p.name} className="cd-scene-param">
    <span className="cd-scene-param-head"><span>{p.label}</span><output>{+p.value.toFixed(4)}{p.unit ?? ""}</output></span>
    <input type="range" className="cd-scene-scrub" min={p.min} max={p.max} step={p.step || "any"} value={p.value}
      style={{ ["--p" as string]: `${(p.value - p.min) / (p.max - p.min || 1) * 100}%` }}
      onChange={(event) => send("set", undefined, p.name, +event.target.value)} />
  </label>)}</div> : null}
  <div className="cd-scenebar">
    <button type="button" className={cx("cd-scene-play", scene.playing && "is-playing")} aria-label={label} title={label} onClick={() => send(scene.playing ? "pause" : ended ? "replay" : "play")}>
      {/* the carved ring, inked as far as the animation has played */}
      <svg className="cd-scene-ring" viewBox="0 0 44 44" aria-hidden="true">
        <rect x="4.5" y="4.5" width="35" height="35" rx="7.5" pathLength="1" />
        <rect x="4.5" y="4.5" width="35" height="35" rx="7.5" pathLength="1" className="is-done" strokeDasharray="1 1" strokeDashoffset={scene.end ? 1 - Math.min(1, scene.t / scene.end) : 1} />
      </svg>
      {loading ? <InkLoader tone="plain" label="Loading" className="cd-scene-loading" />
        : scene.playing ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5.5" width="4" height="13" rx="1.5" /><rect x="13.5" y="5.5" width="4" height="13" rx="1.5" /></svg>
        : ended ? <Icon name="restart" /> : <Icon name="play" />}
    </button>
    {scene.voiced ? <SoundControl scene={scene} send={send} /> : null}
    <input type="range" className="cd-scene-scrub" min={0} max={1000} value={scene.end ? Math.round(scene.t / scene.end * 1000) : 0} aria-label="Time"
      style={{ ["--p" as string]: `${scene.end ? scene.t / scene.end * 100 : 0}%` }}
      onChange={(event) => send("seek", (+event.target.value / 1000) * scene.end)} />
    <span className="cd-scene-time">{scene.t.toFixed(1)} / {scene.end.toFixed(1)}s</span>
    {!scene.complete && !loading ? <InkLoader tone="plain" label="Still being written" className="cd-morph cd-scene-writing" /> : null}
  </div>
  </div>;
}
