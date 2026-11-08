"use client";

import { accentRamp, cx } from "@kimono/ui";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { PageTransition } from "@/components/page-transition";
import { Rail, type RailApp, type RailRoom } from "@/components/rail";

/*
 * The frame every signed-in page stands in: the rail (the bottom bar on a
 * phone) and the page beside it. It lives in the (shell) layout, so moving
 * between pages swaps only the page: the rail is never rebuilt. Which app and
 * which of the house's places you're in is read from the address, the same on
 * the server's first paint as after every move.
 */
export function ShellFrame({ apps, rooms, admin, you, defaultPins, children }: {
  apps: RailApp[];
  /** Each app's rooms, by app id, shown beneath its pin when it's open. */
  rooms: Record<string, RailRoom[]>;
  admin: boolean;
  you: ReactNode;
  defaultPins: string[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const app = appAt(apps, pathname);
  const active = pathname === "/" ? "home" : under(pathname, "/admin") ? "admin" : under(pathname, "/account") ? "account" : undefined;
  return <div className={cx("app-frame", app && "in-app")} style={app ? palette(app.accent) : undefined}>
    <Rail apps={apps} current={app?.id} rooms={app ? rooms[app.id] : undefined} active={active} admin={admin} defaultPins={defaultPins} you={you} />
    <main className="main-content"><PageTransition>{children}</PageTransition></main>
  </div>;
}

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** The app whose own address this page sits under, the longest match winning. */
function appAt(apps: RailApp[], pathname: string) {
  return apps
    .filter((app) => !app.external && app.href.startsWith("/") && app.href !== "/" && under(pathname, app.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** Inside an app, its own colour leads (shell.css maps the neutrals around it). */
function palette(accent: string): CSSProperties {
  const ramp = accentRamp(accent);
  return {
    "--k-app-accent": ramp.deep,
    "--k-app-tint": ramp.tint,
  } as CSSProperties;
}
