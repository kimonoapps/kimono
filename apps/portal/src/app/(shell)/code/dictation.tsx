"use client";

/*
 * Speaking a message instead of typing it. The mic on the writing bar records
 * until you're done (or cancel); only then is the recording sent, once, to be
 * written down (api/v1/code/dictation, OpenAI's gpt-transcribe). The words land
 * in the message box, where they can be read over and sent like typed ones.
 * While it listens, the bar becomes one line: cancel, your voice drawn as ink
 * as you speak, the time, and a seal to say you're done.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cx, InkLoader, Seal } from "@kimono/ui";
import { code } from "./api";
import { Icon } from "./icons";

type Phase = "idle" | "asking" | "listening" | "writing";

/* Whether it's set up here, asked once per page. */
let known: Promise<boolean> | null = null;
function useDictationOn() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return;
    known ??= code.dictationOn().catch(() => { known = null; return false; });
    void known.then((value) => { if (live) setOn(value); });
    return () => { live = false; };
  }, []);
  return on;
}

/* What this browser records best that OpenAI reads: Opus in WebM, or AAC in MP4 on Safari. */
const kinds = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"];
const pickKind = () => kinds.find((k) => MediaRecorder.isTypeSupported?.(k)) ?? "";

/* Ten minutes is plenty for one message; it stops itself there. */
const longest = 10 * 60 * 1000;

const clock = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Puts [said] after [typed], with a space between unless one is already there. */
export const joinSaid = (typed: string, said: string) => !typed.trim() ? said : /\s$/.test(typed) ? typed + said : `${typed} ${said}`;

export function Dictation({ disabled, onText, onProblem }: { disabled?: boolean; onText: (said: string) => void; onProblem: (problem: string | null) => void }) {
  const on = useDictationOn();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const levels = useRef<number[]>([]);
  const parts = useRef<{ stream: MediaStream; recorder: MediaRecorder; audio: AudioContext; chunks: Blob[]; started: number; keep: boolean } | null>(null);
  const done = useRef<HTMLButtonElement>(null);
  const mic = useRef<HTMLButtonElement>(null);

  const release = useCallback(() => {
    const p = parts.current;
    if (!p) return;
    p.stream.getTracks().forEach((t) => t.stop());
    void p.audio.close().catch(() => {});
  }, []);
  useEffect(() => () => { if (parts.current) { parts.current.keep = false; if (parts.current.recorder.state !== "inactive") parts.current.recorder.stop(); release(); } }, [release]);

  async function start() {
    if (phase !== "idle") return;
    onProblem(null);
    setPhase("asking");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (error) {
      setPhase("idle");
      const name = error instanceof DOMException ? error.name : "";
      onProblem(name === "NotAllowedError" || name === "SecurityError" ? "Kimono can't hear you. Allow the microphone for this site, then try again."
        : name === "NotFoundError" ? "There's no microphone to use." : "The microphone didn't start. Try again.");
      return;
    }
    const type = pickKind();
    const recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 64_000 } : undefined);
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    audio.createMediaStreamSource(stream).connect(analyser);
    const p = { stream, recorder, audio, chunks: [] as Blob[], started: performance.now(), keep: true };
    parts.current = p;
    levels.current = [];
    recorder.ondataavailable = (event) => { if (event.data.size) p.chunks.push(event.data); };
    recorder.onstop = () => void finished(p);
    recorder.start(1000);
    setElapsed(0);
    setPhase("listening");

    /* How loud, a few times a second, for the ink to draw. */
    const samples = new Uint8Array(analyser.fftSize);
    let last = 0;
    const listen = (now: number) => {
      if (parts.current !== p || p.recorder.state === "inactive") return;
      if (now - last > 55) {
        last = now;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const s of samples) { const v = (s - 128) / 128; sum += v * v; }
        levels.current.push(Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.7));
        if (levels.current.length > 400) levels.current.splice(0, levels.current.length - 400);
        const took = now - p.started;
        setElapsed(took);
        if (took >= longest) { finish(); return; }
      }
      requestAnimationFrame(listen);
    };
    requestAnimationFrame(listen);
  }

  async function finished(p: NonNullable<typeof parts.current>) {
    release();
    if (parts.current === p) parts.current = null;
    if (!p.keep) { setPhase("idle"); return; }
    const blob = new Blob(p.chunks, { type: (p.recorder.mimeType || p.chunks[0]?.type || "audio/webm") });
    if (blob.size < 1200) { setPhase("idle"); onProblem("Nothing was heard."); return; }
    try {
      const { text } = await code.transcribe(blob);
      if (text) onText(text); else onProblem("Nothing was heard.");
    } catch (error) {
      onProblem(error instanceof Error ? error.message : "Couldn't turn that into words. Try again.");
    } finally {
      setPhase("idle");
    }
  }

  function finish() {
    const p = parts.current;
    if (!p || p.recorder.state === "inactive") return;
    setPhase("writing");
    p.recorder.stop();
  }
  function cancel() {
    const p = parts.current;
    if (!p) return;
    p.keep = false;
    if (p.recorder.state !== "inactive") p.recorder.stop(); else { release(); setPhase("idle"); }
    requestAnimationFrame(() => mic.current?.focus());
  }

  /* While it listens: Enter is done, Escape lets it go. */
  useEffect(() => {
    if (phase !== "listening") return;
    done.current?.focus({ focusVisible: false } as FocusOptions);
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); cancel(); }
      else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); finish(); }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancel and finish read refs only
  }, [phase]);

  if (!on) return null;
  const live = phase === "listening" || phase === "writing";
  return <>
    <button ref={mic} type="button" className={cx("cd-iconbutton cd-mic", phase === "asking" && "is-on")} aria-label="Speak a message" title="Speak a message"
      disabled={disabled || phase !== "idle"} onClick={() => void start()}><Icon name="mic" /></button>
    {live ? <div className={cx("cd-dictating", phase === "writing" && "is-writing")} role="group" aria-label={phase === "writing" ? "Writing down what you said" : "Listening"}>
      <button type="button" className="cd-iconbutton cd-dict-cancel" aria-label="Cancel" title="Cancel (Esc)" disabled={phase === "writing"} onClick={cancel}><Icon name="close" /></button>
      <VoiceInk levels={levels} still={phase === "writing"} />
      <span className="cd-dict-time" aria-live="polite">{phase === "writing" ? <InkLoader tone="plain" label="Writing it down" className="cd-morph" /> : <><i aria-hidden="true" />{clock(elapsed)}</>}</span>
      <Seal ref={done} compact className="cd-dict-done" busy={phase === "writing"} aria-label="Done" title="Done (↵)" onClick={finish}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5 10 17l8.5-9.5" /></svg>
      </Seal>
    </div> : null}
  </>;
}

/**
 * The voice as it's heard: a stroke for each moment, newest at the right,
 * older ones drifting left and paling as ink does when the brush runs dry.
 */
function VoiceInk({ levels, still }: { levels: React.RefObject<number[]>; still: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const w = el.clientWidth, h = el.clientHeight;
      if (el.width !== Math.round(w * ratio) || el.height !== Math.round(h * ratio)) { el.width = Math.round(w * ratio); el.height = Math.round(h * ratio); }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const ink = getComputedStyle(el).color;
      const step = 5, stroke = 3;
      const fit = Math.floor(w / step);
      const shown = levels.current.slice(-fit);
      const quiet = h * 0.08;
      for (let i = 0; i < fit; i++) {
        const fromRight = fit - 1 - i;
        const level = shown[shown.length - 1 - fromRight];
        const x = w - (fromRight + 1) * step + (step - stroke) / 2;
        /* before anything was said: a faint dotted line, the paper waiting */
        const size = level === undefined ? 2 : Math.max(stroke, quiet + level * (h - quiet) * 0.92);
        ctx.globalAlpha = level === undefined ? 0.18 : Math.max(0.28, 1 - (fromRight / fit) * 0.75);
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.roundRect(x, (h - size) / 2, stroke, size, stroke / 2);
        ctx.fill();
      }
      if (!still) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [levels, still]);
  return <canvas ref={canvas} className="cd-dict-ink" aria-hidden="true" />;
}
