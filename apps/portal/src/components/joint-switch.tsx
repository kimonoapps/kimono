"use client";

import { useRef, useState } from "react";

/**
 * The M3 switch with Kata's half-lap joint thumb. Posts as `name=on` (or empty)
 * so server actions read it like a checkbox. `form` lets it sit outside its
 * form, as the run switch does in an app's top bar; `submit` sends its form
 * the moment it's flipped, for a setting that saves on its own.
 *
 * Flipping it on seats the joint: the block winds back, drives home, and a
 * small suō burst shows where it lands. Flipping it off draws it back out.
 */
export function JointSwitch({ name, defaultChecked, label, form, disabled, submit }: {
  name: string;
  defaultChecked: boolean;
  label: string;
  form?: string;
  disabled?: boolean;
  submit?: boolean;
}) {
  const [on, setOn] = useState(defaultChecked);
  const [phase, setPhase] = useState<"" | "seating" | "parting">("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hidden = useRef<HTMLInputElement>(null);
  return <>
    <input ref={hidden} type="hidden" name={name} value={on ? "on" : ""} form={form} />
    <button className={`joint${phase ? ` ${phase}` : ""}`} role="switch" type="button" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={(event) => {
        const next = !on;
        setOn(next);
        setPhase(next ? "seating" : "parting");
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setPhase(""), next ? 560 : 360);
        const button = event.currentTarget;
        setTimeout(() => {
          /* Let the save bar count this change once the hidden value has updated. */
          button.dispatchEvent(new Event("input", { bubbles: true }));
          if (submit) hidden.current?.form?.requestSubmit();
        });
      }}>
      <span className="joint-burst" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
    </button>
  </>;
}
