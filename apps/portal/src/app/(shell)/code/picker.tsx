"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cx } from "@kimono/ui";
import { Icon } from "./icons";

/*
 * A field you choose from: its name small above, the choice large below, the
 * way the phone draws it. Opening it lays a sheet of choices beneath, with a
 * filter once there are more than a handful.
 */

export type PickerOption = { value: string; label: string; detail?: string; note?: string };

export function Picker({ label, value, options, onChange, disabled, placeholder = "Choose", mono, action }: {
  label: string; value: string; options: PickerOption[]; onChange: (value: string) => void;
  disabled?: boolean; placeholder?: string; mono?: boolean;
  /** One thing to do instead of choosing, at the foot of the list: "New project". */
  action?: { label: string; onAction: () => void };
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const chosen = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.detail ?? ""} ${o.note ?? ""}`.toLowerCase().includes(q)) : options;
  }, [filter, options]);
  const filtering = options.length > 6;

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active, open]);

  const show = () => { setFilter(""); setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const pick = (option: PickerOption | undefined) => { if (!option) return; onChange(option.value); setOpen(false); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); };
  const keys = (event: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); show(); }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setActive((n) => Math.min(shown.length - 1, n + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((n) => Math.max(0, n - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); pick(shown[active]); }
  };

  return <div className={cx("cd-picker", open && "is-open")} ref={root} onKeyDown={keys}>
    <button type="button" className="cd-picker-field" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`}
      onClick={() => (open ? setOpen(false) : show())}>
      <span className="cd-picker-label">{label}</span>
      <span className={cx("cd-picker-value", mono && "is-mono", !chosen && "is-empty")}>{chosen?.label ?? placeholder}</span>
      <Icon name="chevron" />
    </button>
    {open ? <div className="cd-picker-sheet">
      {filtering ? <input autoFocus className="cd-picker-filter" placeholder={`Find a ${label.toLowerCase()}`} value={filter} aria-label={`Find a ${label.toLowerCase()}`}
        onChange={(event) => { setFilter(event.target.value); setActive(0); }} /> : null}
      <ul ref={list} id={`${id}-list`} role="listbox" aria-label={label} tabIndex={filtering ? -1 : 0} autoFocus={!filtering}>
        {shown.map((option, n) => <li key={option.value} role="option" data-index={n} aria-selected={option.value === value}
          className={cx(n === active && "is-active")} onPointerEnter={() => setActive(n)} onClick={() => pick(option)}>
          <span className={cx("cd-picker-name", mono && "is-mono")}>{option.label}</span>
          {option.detail ? <small>{option.detail}</small> : null}
          {option.note ? <em>{option.note}</em> : null}
          {option.value === value ? <Icon name="check" /> : null}
        </li>)}
        {!shown.length ? <li className="cd-picker-none">Nothing matches.</li> : null}
      </ul>
      {action ? <button type="button" className="cd-picker-action" onClick={() => { setOpen(false); action.onAction(); }}><Icon name="plus" />{action.label}</button> : null}
    </div> : null}
  </div>;
}
