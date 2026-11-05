"use client";

import type { ReactNode } from "react";
// eslint-disable-next-line no-restricted-imports -- moving between account rooms changes the card, not the place; a crossing here was explicitly ruled out.
import Link from "next/link";
import { usePathname } from "next/navigation";

const rooms = [
  { href: "/account", label: "Profile" },
  { href: "/account/password", label: "Password" },
  { href: "/account/devices", label: "Signed-in devices" },
] as const;

/**
 * The account's rooms. Moving between them is a change inside one surface,
 * not a change of place, so it uses a plain soft navigation: the header and
 * rail stay standing and only the card is replaced. No crossing.
 */
export function AccountRooms() {
  const path = usePathname();
  return <nav className="rail-nav" aria-label="Your account">
    {rooms.map((room) => <Link key={room.href} href={room.href} aria-current={path === room.href ? "page" : undefined}>{room.label}</Link>)}
  </nav>;
}

/** The card's contents arrive with the one motion an in-surface change gets. */
export function AccountCard({ children }: { children: ReactNode }) {
  const path = usePathname();
  return <div key={path} className="k-arrive">{children}</div>;
}
