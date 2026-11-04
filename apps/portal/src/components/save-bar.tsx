"use client";

import { Seal } from "@kimono/ui";
import { useEffect, useState } from "react";

function snapshot(form: HTMLFormElement) {
  const values = new Map<string, string>();
  for (const [key, value] of new FormData(form)) values.set(key, `${values.get(key) ?? ""}\u0000${typeof value === "string" ? value : value.name}`);
  return values;
}

/**
 * Saving is pinned to the bottom so it's never scrolled away, and it says how
 * many things you've changed. Counts fields of the form `formId`, including
 * ones placed outside it with the `form` attribute.
 */
export function SaveBar({ formId, label }: { formId: string; label: string }) {
  const [changed, setChanged] = useState(0);
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    const start = snapshot(form);
    const count = () => {
      const now = snapshot(form);
      let differences = 0;
      for (const key of new Set([...start.keys(), ...now.keys()])) if (start.get(key) !== now.get(key)) differences += 1;
      setChanged(differences);
    };
    document.addEventListener("input", count);
    document.addEventListener("change", count);
    return () => { document.removeEventListener("input", count); document.removeEventListener("change", count); };
  }, [formId]);
  return <div className="save-bar">
    <span>{changed ? `${changed} unsaved change${changed === 1 ? "" : "s"}` : "No changes"}</span>
    <Seal type="submit" form={formId}>{label}</Seal>
  </div>;
}
