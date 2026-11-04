"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export type ChoiceOption = { value: string; label: ReactNode; detail?: ReactNode; disabled?: boolean };

/**
 * 選 Erabi — picking one of a few. Kimono's own dropdown in place of the
 * browser's: at rest it is a field like any input (a fold in the paper with
 * a hair edge); open, a sheet lifts beside it, above everything, flipping
 * upward when there's no room below. Inside a form it submits like a select
 * (through `name`); outside one, `onChange` hears each pick.
 */
export function Choice({ options, value, defaultValue, onChange, name, placeholder = "Choose", disabled = false, required = false, className, id, "aria-label": ariaLabel }: {
  options: ChoiceOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const current = value ?? own;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; up: boolean; max: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();
  const chosen = options.find((option) => option.value === current);

  function pick(option: ChoiceOption) {
    if (option.disabled) return;
    if (value === undefined) setOwn(option.value);
    setOpen(false);
    button.current?.focus();
    if (option.value !== current) onChange?.(option.value);
  }

  function show() {
    if (disabled) return;
    const at = Math.max(0, options.findIndex((option) => option.value === current));
    setActive(at);
    setOpen(true);
  }

  /* Placed against the button, in the viewport, so no card or scroller can clip it. */
  useLayoutEffect(() => {
    if (!open) return;
    function measure() {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const wanted = Math.min(320, options.length * 44 + 12);
      const up = below < wanted && above > below;
      const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16);
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      setPlace({ left, top: up ? rect.top - 6 : rect.bottom + 6, width, up, max: Math.max(120, Math.min(320, up ? above : below)) });
    }
    measure();
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", close); window.removeEventListener("scroll", measure, true); };
  }, [open, options.length]);

  /* A press anywhere else puts it away. */
  useEffect(() => {
    if (!open) return;
    function away(event: PointerEvent) {
      const target = event.target as Node;
      if (!button.current?.contains(target) && !list.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function step(from: number, by: number) {
    for (let i = 1; i <= options.length; i += 1) {
      const next = (from + by * i + options.length * i) % options.length;
      if (!options[next]?.disabled) return next;
    }
    return from;
  }

  function keys(event: KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); show(); }
      return;
    }
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((a) => step(a, 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((a) => step(a, -1)); }
    else if (event.key === "Home") { event.preventDefault(); setActive(step(-1, 1)); }
    else if (event.key === "End") { event.preventDefault(); setActive(step(options.length, -1)); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); const option = options[active]; if (option) pick(option); }
    else if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); setOpen(false); }
    else if (event.key.length === 1) {
      /* Typing jumps to the first option that starts with what was typed. */
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + event.key.toLowerCase(), at: now };
      const found = options.findIndex((option) => !option.disabled && String(typeof option.label === "string" ? option.label : option.value).toLowerCase().startsWith(typed.current.text));
      if (found >= 0) setActive(found);
    }
  }

  return <span className={cx("k-choice", open && "is-open", className)}>
    <button
      ref={button}
      id={id}
      type="button"
      className="k-choice-button"
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${active}` : undefined}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => (open ? setOpen(false) : show())}
      onKeyDown={keys}
    >
      <span className={cx("k-choice-value", !chosen && "is-placeholder")}>{chosen ? chosen.label : placeholder}</span>
      <i className="k-choice-cue" aria-hidden="true" />
    </button>
    {name ? <input type="hidden" name={name} value={current} /> : null}
    {/* A hidden select makes the form refuse to send while nothing is picked, as a required select would. */}
    {required ? <select className="k-choice-required" tabIndex={-1} aria-hidden="true" required value={current} onChange={() => {}}>
      <option value="" />{current ? <option value={current} /> : null}
    </select> : null}
    {open && place ? <ul
      ref={list}
      id={listId}
      role="listbox"
      className={cx("k-choice-list", place.up && "is-up")}
      style={{ left: place.left, width: place.width, maxHeight: place.max, ...(place.up ? { bottom: window.innerHeight - place.top } : { top: place.top }) }}
    >
      {options.map((option, index) => <li
        key={option.value}
        id={`${listId}-${index}`}
        data-index={index}
        role="option"
        aria-selected={option.value === current}
        aria-disabled={option.disabled || undefined}
        className={cx("k-choice-option", index === active && "is-active", option.value === current && "is-chosen", option.disabled && "is-disabled")}
        onPointerEnter={() => !option.disabled && setActive(index)}
        onClick={() => pick(option)}
      >
        <span>{option.label}{option.detail ? <small>{option.detail}</small> : null}</span>
      </li>)}
    </ul> : null}
  </span>;
}
