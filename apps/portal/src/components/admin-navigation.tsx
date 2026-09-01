"use client";

import { Door } from "@kimono/ui";
import { useCrossTo, useWarm } from "@/components/crossing";

/**
 * The admin surfaces. These are places, not tabs, so they are doors —
 * the same primitive as the header, at the same size.
 */
export function AdminNavigation({ active }: { active: "apps" | "infrastructure" | "links" | "vpn" }) {
  const crossTo = useCrossTo();
  const warm = useWarm();
  const rooms = [
    { href: "/admin/apps", label: "Applications", here: active === "apps" },
    { href: "/admin/infrastructure", label: "Connectivity", here: active === "infrastructure" },
    { href: "/admin/vpn", label: "Kimono VPN", here: active === "vpn" },
    { href: "/admin/links", label: "Useful links", here: active === "links" },
  ];
  return <nav className="admin-section-nav" aria-label="Administration sections">
    {rooms.map((room) => <Door
      key={room.href}
      label={room.label}
      here={room.here}
      onPointerEnter={room.here ? undefined : warm(room.href)}
      onFocus={room.here ? undefined : warm(room.href)}
      onClick={() => { if (!room.here) crossTo("kakejiku", room.href); }}
    >{room.label}</Door>)}
  </nav>;
}
