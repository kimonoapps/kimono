"use client";

import { petalSvg } from "@kimono/ui";

/* Petals are for moments, not navigation: a few fall from the button when something important is done. */
export function celebrate(from: HTMLElement, colour = "#c75f78") {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = from.getBoundingClientRect();
  for (let i = 0; i < 6; i++) {
    const petal = document.createElement("span");
    petal.className = "k-ink-petal";
    petal.innerHTML = petalSvg(Math.floor(Math.random() * 1e6), colour);
    Object.assign(petal.style, { position: "fixed", left: "0", top: "0", zIndex: "80", width: `${14 + Math.random() * 10}px`, height: `${14 + Math.random() * 10}px` });
    document.body.appendChild(petal);
    const x = r.left + Math.random() * r.width, y = r.top;
    petal.animate([
      { transform: `translate(${x}px, ${y}px) rotate(0deg)`, opacity: 0 },
      { opacity: 1, offset: .15 },
      { transform: `translate(${x + Math.random() * 60 - 30}px, ${y + 70 + Math.random() * 60}px) rotate(${Math.random() * 300 - 150}deg)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 400, delay: i * 70, easing: "cubic-bezier(.2,.6,.4,1)", fill: "both" });
    setTimeout(() => petal.remove(), 2000);
  }
}
