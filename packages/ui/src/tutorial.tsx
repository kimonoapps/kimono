"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Seal } from "./seal";

export type TutorialStep = {
  id: string;
  title: string;
  description: string;
  content?: ReactNode;
};

/** Mount to start a flow; unmount to close. Each opening starts at step one. */
export function Tutorial({ title, description, steps, onClose, onSkip, onComplete, skipLabel = "Skip", completeLabel = "Done", footer }: {
  title: string;
  description?: string;
  steps: TutorialStep[];
  onClose: () => void;
  onSkip: () => void;
  onComplete: () => void;
  skipLabel?: string;
  completeLabel?: string;
  footer?: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const modal = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  const previousIndex = useRef(0);
  const id = useId();
  const step = steps[index];

  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = modal.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else {
      dialog.setAttribute("open", "");
      dialog.dataset.fallback = "true";
    }
    dialog.querySelector<HTMLButtonElement>("button")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab") return;
      const targets = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]'));
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    dialog.addEventListener("keydown", handleKey);
    return () => {
      dialog.removeEventListener("keydown", handleKey);
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      delete dialog.dataset.fallback;
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (previousIndex.current === index) return;
    previousIndex.current = index;
    panel.current?.scrollTo(0, 0);
    panel.current?.focus();
  }, [index]);

  if (!step) return null;
  const last = index === steps.length - 1;
  return <>
    <dialog ref={modal} className="k-tutorial" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onClose={() => { if (!modal.current?.open) onClose(); }}>
      <header className="k-tutorial-header">
        <Seal compact tone="quiet" className="k-tutorial-close" aria-label="Close tutorial" onClick={onClose}>×</Seal>
        <h2 id={`${id}-title`}>{title}</h2>
        {description && <p>{description}</p>}
        <p className="k-tutorial-progress" role="status" aria-live="polite">Step {index + 1} of {steps.length}</p>
      </header>
      <section key={step.id} ref={panel} className="k-tutorial-step" tabIndex={-1} aria-labelledby={`${id}-step`}>
        <h3 id={`${id}-step`}>{step.title}</h3>
        <p>{step.description}</p>
        {step.content}
      </section>
      <footer className="k-tutorial-footer">
        {footer}
        <div className="k-tutorial-direction">
          <Seal tone="quiet" disabled={index === 0} onClick={() => setIndex(current => Math.max(0, current - 1))}>Back</Seal>
          <Seal onClick={() => { if (last) onComplete(); else setIndex(current => current + 1); }}>{last ? completeLabel : "Next"}</Seal>
        </div>
        <Seal tone="quiet" className="k-tutorial-skip" onClick={onSkip}>{skipLabel}</Seal>
      </footer>
    </dialog>
    <div className="k-tutorial-backdrop" aria-hidden="true" />
  </>;
}
