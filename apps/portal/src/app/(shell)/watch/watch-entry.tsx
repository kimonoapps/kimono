"use client";

import { createContext, useContext } from "react";
import dynamic from "next/dynamic";
import { Crossing } from "@/components/crossing";
import { WatchBloom } from "./bits";
import type { Person } from "./watch-app";

/* Watch reads where you are and who's watching from the browser, so it draws there only. */
const App = dynamic(() => import("./watch-app").then((m) => m.WatchApp), { ssr: false, loading: () => <Waiting /> });

/* Until the app arrives: Watch's bloom, breathing on the dark floor. */
const Accent = createContext("#a84d63");
function Waiting() {
  return <div className="kw kw-waiting"><WatchBloom accent={useContext(Accent)} className="kw-bloom-lg kw-breathe" /></div>;
}

export function WatchEntry(props: { me: Person; household: Person[]; accent: string }) {
  return <Accent.Provider value={props.accent}><App {...props} /></Accent.Provider>;
}

export function WatchOff({ accent }: { accent: string }) {
  return <div className="kw"><div className="kw-problem" style={{ minHeight: "100vh", alignContent: "center" }}><Crossing kind="shoji" href="/" aria-label="Kimono"><WatchBloom accent={accent} className="kw-bloom-lg" /></Crossing><p>Watch isn&apos;t switched on.</p></div></div>;
}
