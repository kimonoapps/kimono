"use client";

import { Door } from "@kimono/ui";
import { useCrossTo, useWarm } from "@/components/crossing";

/** The way out. A door, because it goes somewhere. */
export function DoorBack({ href, label = "All apps" }: { href: string; label?: string }) {
  const crossTo = useCrossTo();
  const warm = useWarm()(href);
  return <Door
    label={`Back to ${label}`}
    onPointerEnter={warm}
    onFocus={warm}
    onClick={() => crossTo("kakejiku", href)}
  >{label}</Door>;
}
