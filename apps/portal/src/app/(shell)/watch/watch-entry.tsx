"use client";

import { useSyncExternalStore } from "react";
import { InkLoader } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { WatchBloom } from "./bits";
import { WatchApp, type Person } from "./watch-app";

/*
 * Watch reads where you are and who's watching from the browser, so it draws
 * there only: the server sends Watch's bloom, breathing, and the browser takes over.
 */
const never = () => () => {};
export function WatchEntry(props: { me: Person; household: Person[]; accent: string }) {
  const here = useSyncExternalStore(never, () => true, () => false);
  if (!here) return <div className="kw kw-waiting"><InkLoader ink={props.accent} label="Opening" className="kw-wait" /></div>;
  return <WatchApp {...props} />;
}

export function WatchOff({ accent }: { accent: string }) {
  return <div className="kw"><div className="kw-problem" style={{ minHeight: "100vh", alignContent: "center" }}><Crossing kind="shoji" href="/" aria-label="Kimono"><WatchBloom accent={accent} className="kw-bloom-lg" /></Crossing><p>Watch isn&apos;t switched on.</p></div></div>;
}
