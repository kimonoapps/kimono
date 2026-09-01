"use client";

import { Door, type CrossingKind } from "@kimono/ui";
import { useCrossTo, useWarm } from "@/components/crossing";

/** A room in the house. The door you are standing in stands open. */
export function NavDoor({ href, label, here, kind = "shoji" }: {
  href: string;
  label: string;
  here: boolean;
  kind?: CrossingKind;
}) {
  const crossTo = useCrossTo();
  const warm = useWarm()(href);
  return <Door
    label={label}
    here={here}
    onPointerEnter={here ? undefined : warm}
    onFocus={here ? undefined : warm}
    onClick={() => { if (!here) crossTo(kind, href); }}
  >{label}</Door>;
}
