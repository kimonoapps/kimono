"use client";

import dynamic from "next/dynamic";
import { Crossing } from "@/components/crossing";
import type { Person } from "./watch-app";

/* Watch reads where you are and who's watching from the browser, so it draws there only. */
const App = dynamic(() => import("./watch-app").then((m) => m.WatchApp), { ssr: false, loading: () => <div className="kw" /> });

export function WatchEntry(props: { me: Person; household: Person[] }) {
  return <App {...props} />;
}

export function WatchOff() {
  return <div className="kw"><div className="kw-problem" style={{ minHeight: "100vh", alignContent: "center" }}><Crossing kind="shoji" className="kw-seal" href="/" aria-label="Kimono">観</Crossing><p>Watch isn&apos;t switched on.</p></div></div>;
}
