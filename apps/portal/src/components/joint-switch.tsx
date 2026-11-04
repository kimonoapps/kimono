"use client";

import { useState } from "react";

/**
 * The M3 switch with Kata's half-lap joint thumb. Posts as `name=on` (or empty)
 * so server actions read it like a checkbox. `form` lets it sit outside its
 * form, as the run switch does in an app's top bar.
 */
export function JointSwitch({ name, defaultChecked, label, form, disabled }: {
  name: string;
  defaultChecked: boolean;
  label: string;
  form?: string;
  disabled?: boolean;
}) {
  const [on, setOn] = useState(defaultChecked);
  return <>
    <input type="hidden" name={name} value={on ? "on" : ""} form={form} />
    <button className="joint" role="switch" type="button" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={(event) => {
        setOn(!on);
        const button = event.currentTarget;
        /* Let the save bar count this change once the hidden value has updated. */
        setTimeout(() => button.dispatchEvent(new Event("input", { bubbles: true })));
      }} />
  </>;
}
