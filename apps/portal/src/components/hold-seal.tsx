"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { petalSvg } from "@kimono/ui";

/*
 * Hold to confirm, as on the phone: hold for 1.4s while ink petals pile up and
 * the face deepens; let go early and they scatter. When the hold completes it
 * submits the form it sits in. Screen readers and keyboards get the same hold
 * on Space or Enter.
 */
export function HoldSeal({ label, holdingLabel = "Keep holding" }: { label: string; holdingLabel?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(label);
  const state = useRef({ raf: 0, start: 0, petals: [] as HTMLElement[], done: false });

  function tick(now: number) {
    const s = state.current, el = button.current!, p = Math.min((now - s.start) / 1400, 1);
    if (fill.current) fill.current.style.opacity = (p * p).toFixed(3);
    el.style.color = p > .55 ? "#fff" : "";
    if (s.petals.length < 14 && Math.random() < .3 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const petal = document.createElement("span");
      petal.className = "k-ink-petal hold-petal";
      petal.innerHTML = petalSvg(Math.floor(Math.random() * 1e6), "#d77b8c");
      petal.style.left = `${12 + Math.random() * (el.clientWidth - 24)}px`;
      petal.style.top = `${el.clientHeight - 14 - Math.random() * 10 * p}px`;
      petal.style.rotate = `${Math.random() * 360}deg`;
      petal.animate([{ translate: "0 -40px", opacity: 0 }, { translate: "0 0", opacity: .92 }], { duration: 380, easing: "cubic-bezier(.2,.8,.3,1)" });
      el.appendChild(petal); s.petals.push(petal);
    }
    if (p < 1) { s.raf = requestAnimationFrame(tick); return; }
    s.done = true; s.raf = 0;
    setText("Done");
    s.petals.forEach((petal) => petal.remove()); s.petals = [];
    el.form?.requestSubmit();
  }
  function begin() {
    const s = state.current; if (s.done || s.raf) return;
    setText(holdingLabel); s.start = performance.now(); s.raf = requestAnimationFrame(tick);
  }
  function cancel() {
    const s = state.current; if (s.done || !s.raf) return;
    cancelAnimationFrame(s.raf); s.raf = 0;
    if (fill.current) fill.current.style.opacity = "0";
    if (button.current) button.current.style.color = "";
    setText(label);
    s.petals.forEach((petal) => { petal.animate([{ opacity: .92 }, { translate: `${Math.random() * 80 - 40}px -50px`, opacity: 0 }], { duration: 420, easing: "ease-out" }).onfinish = () => petal.remove(); });
    s.petals = [];
  }
  const key = (event: KeyboardEvent, down: boolean) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (down && !event.repeat) begin(); else if (!down) cancel();
  };
  return <button ref={button} type="button" className="k-seal hold full"
    onPointerDown={begin} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
    onKeyDown={(event) => key(event, true)} onKeyUp={(event) => key(event, false)}>
    <span ref={fill} className="fill" />
    <span className="label-wrap"><span>{text}</span></span>
  </button>;
}
