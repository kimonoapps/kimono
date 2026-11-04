"use client";

import { AppRooms } from "@kimono/ui";
import { NavDoor } from "@/components/nav-door";

/**
 * The rooms inside one app. Moving between them is a 掛軸 — you are staying in
 * the same app, so it must not spend the blossom that means leaving it.
 */
export function VpnRooms({ here }: { here: "devices" | "people" | "connect" }) {
  const rooms = [
    { href: "/vpn", label: "Devices", id: "devices" },
    { href: "/vpn/people", label: "People", id: "people" },
    { href: "/vpn/connect", label: "Connect", id: "connect" },
  ] as const;
  return <AppRooms>
    {rooms.map((room) => <NavDoor
      key={room.id}
      href={room.href}
      label={room.label}
      here={here === room.id}
      kind="kakejiku"
    />)}
  </AppRooms>;
}

/** Kimono VPN's rooms, for the rail under its pin. */
export function vpnRoomList(here: "devices" | "people" | "connect") {
  return [
    { href: "/vpn", label: "Devices", here: here === "devices" },
    { href: "/vpn/people", label: "People", here: here === "people" },
    { href: "/vpn/connect", label: "Connect", here: here === "connect" },
  ];
}
