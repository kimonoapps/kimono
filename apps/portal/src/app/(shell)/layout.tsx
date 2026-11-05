import type { ReactNode } from "react";
import { InkPortraitFrame } from "@kimono/ui";
import { auth } from "@/auth";
import { railApps } from "@/components/app-shell";
import { Portrait } from "@/components/portrait";
import type { RailRoom } from "@/components/rail";
import { ShellFrame } from "@/components/shell-frame";
import { getAppDefinition } from "@/lib/definitions";
import { defaultPins } from "@/lib/default-pins";
import { recordAccount } from "@/lib/directory";
import { picturePathFor } from "@/lib/pictures";
import { getPlatformSettings } from "@/lib/settings";
import { toolCollections } from "./tools/collections";

/*
 * Every signed-in page stands in one frame, built here once: moving between
 * pages swaps only the page, so the rail (the bottom bar on a phone) never
 * reloads. Each page still checks who is signing in and sends strangers to
 * the sign-in page; without a session this layout adds nothing.
 */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const user = session?.user;
  if (!user?.username) return children;
  /* Recording who signs in is what lets an administrator grant Kimono VPN to a
     real account instead of typing a username and hoping. */
  await recordAccount(user);
  const [apps, picture, rooms] = await Promise.all([railApps(user.username), picturePathFor(user.username), appRooms()]);
  const displayName = user.name?.trim() || user.username;
  return <ShellFrame
    apps={apps}
    rooms={rooms}
    admin={user.role === "owner" || user.role === "admin"}
    defaultPins={defaultPins(apps)}
    you={<InkPortraitFrame seed={user.username} weight={6}><Portrait name={displayName} username={user.username} picture={picture ?? user.image ?? null} size={26} /></InkPortraitFrame>}
  >{children}</ShellFrame>;
}

/** The rooms each app opens beneath its pin. Which one you're in is read from the address. */
async function appRooms(): Promise<Record<string, RailRoom[]>> {
  const rooms: Record<string, RailRoom[]> = {
    "kimono-drive": [
      { href: "/drive", label: "Spaces", icon: "folder" },
      { href: "/drive?view=recent", label: "Recent", icon: "clock" },
      { href: "/drive?view=trash", label: "Trash", icon: "trash" },
    ],
    "kimono-vpn": [
      { href: "/vpn", label: "Devices", icon: "laptop" },
      { href: "/vpn/people", label: "People", icon: "people" },
      { href: "/vpn/connect", label: "Connect", icon: "link" },
    ],
  };
  /* Tools' collections are its rooms, as the phone shows spaces; /tools itself opens the first. */
  const [settings, definition] = await Promise.all([getPlatformSettings(), getAppDefinition("kimono-tools")]);
  if (definition) rooms["kimono-tools"] = toolCollections(settings, definition)
    .map((item, index) => ({ href: `/tools/${item.api.id}`, label: item.api.name, here: index === 0, icon: "book" as const }));
  return rooms;
}
