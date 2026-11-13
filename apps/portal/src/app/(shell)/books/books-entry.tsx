"use client";

import { useSyncExternalStore } from "react";
import { BooksApp } from "./books-app";

/* Books reads where you are from the address, so it draws in the browser only. */
const never = () => () => {};
export function BooksEntry(props: { accent: string; firstName: string }) {
  const here = useSyncExternalStore(never, () => true, () => false);
  if (!here) return <div className="kb" aria-busy="true" />;
  return <BooksApp {...props} />;
}

export function BooksOff() {
  return <div className="kb"><div className="kb-empty" style={{ minHeight: "100vh", alignContent: "center" }}><p>Books isn&apos;t switched on.</p></div></div>;
}
