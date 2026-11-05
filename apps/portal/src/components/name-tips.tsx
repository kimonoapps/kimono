"use client";

import { useEffect, useRef, useState } from "react";

/*
 * 名 Whose face is this: resting on a portrait shows the person's name in a
 * small tag above it. One listener for the whole page reads data-name, so any
 * portrait gets it without wiring; a tag floats free of the round masks that
 * would clip one drawn inside them.
 */
export function NameTips() {
  const [tip, setTip] = useState<{ name: string; x: number; y: number; below: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const find = (target: EventTarget | null) => (target as Element | null)?.closest?.<HTMLElement>("[data-name]") ?? null;
    const show = (event: Event) => {
      const element = find(event.target);
      if (!element) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const box = element.getBoundingClientRect();
        const below = box.top < 44;
        setTip({ name: element.dataset.name ?? "", x: box.left + box.width / 2, y: below ? box.bottom + 8 : box.top - 8, below });
      }, 250);
    };
    const hide = (event: Event) => {
      if (!find(event.target)) return;
      clearTimeout(timer.current);
      setTip(null);
    };
    const away = () => { clearTimeout(timer.current); setTip(null); };
    document.addEventListener("pointerover", show);
    document.addEventListener("pointerout", hide);
    document.addEventListener("focusin", show);
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", away, true);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("pointerout", hide);
      document.removeEventListener("focusin", show);
      document.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", away, true);
      clearTimeout(timer.current);
    };
  }, []);
  if (!tip?.name) return null;
  return <div className={`name-tip${tip.below ? " below" : ""}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.name}</div>;
}
