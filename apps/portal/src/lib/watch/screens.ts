/**
 * How many screens each person may watch on at once, and who's asked for more.
 *
 * Everyone has two (./flow.ts) until an admin gives them more. Asking is one
 * pending request per person, for one more than they have; an admin approves
 * or declines it on /admin/watch.
 */
import type { DatabaseSync } from "node:sqlite";
import { readState, writeState } from "./model";
import { streamsPerPerson } from "./flow";

type Ask = { at: number; want: number };
type Screens = { limits: Record<string, number>; asks: Record<string, Ask> };

const key = "screens";
/** The most an admin can give anyone. */
export const mostScreens = 6;

const read = (db: DatabaseSync): Screens => {
  const kept = readState<Partial<Screens>>(db, key);
  return { limits: { ...kept?.limits }, asks: { ...kept?.asks } };
};

/** How many screens `username` may watch on at once. */
export function screensOf(db: DatabaseSync, username: string): number {
  const n = read(db).limits[username];
  return typeof n === "number" && n >= streamsPerPerson ? Math.min(n, mostScreens) : streamsPerPerson;
}

/** Asks the admins for one more screen. Asking again while one is pending keeps the first. */
export function askForScreens(db: DatabaseSync, username: string, now = Date.now()): { want: number; at: number } {
  const screens = read(db);
  const have = screensOf(db, username);
  if (have >= mostScreens) throw new Error(`${mostScreens} screens is the most anyone can have.`);
  const ask = screens.asks[username] ?? { at: now, want: have + 1 };
  screens.asks[username] = ask;
  writeState(db, key, screens);
  return ask;
}

/** Requests no admin has answered, oldest first. */
export function screenAsks(db: DatabaseSync): { username: string; at: number; want: number; have: number }[] {
  const screens = read(db);
  return Object.entries(screens.asks).map(([username, ask]) => ({ username, at: ask.at, want: ask.want, have: screensOf(db, username) })).sort((a, b) => a.at - b.at);
}

/** An admin's answer: approving gives what was asked for. */
export function decideScreens(db: DatabaseSync, username: string, approve: boolean): number | null {
  const screens = read(db);
  const ask = screens.asks[username];
  if (!ask) throw new Error("They aren't asking any more.");
  delete screens.asks[username];
  if (approve) screens.limits[username] = Math.min(Math.max(ask.want, streamsPerPerson), mostScreens);
  writeState(db, key, screens);
  return approve ? screens.limits[username] : null;
}

/** Sets someone's screens; two (or fewer) goes back to the usual. */
export function setScreens(db: DatabaseSync, username: string, n: number) {
  const screens = read(db);
  if (!Number.isFinite(n) || n <= streamsPerPerson) delete screens.limits[username];
  else screens.limits[username] = Math.min(Math.round(n), mostScreens);
  writeState(db, key, screens);
}

/** People an admin has given more than two. */
export function moreScreens(db: DatabaseSync): { username: string; screens: number }[] {
  return Object.entries(read(db).limits).filter(([, n]) => n > streamsPerPerson).map(([username, screens]) => ({ username, screens })).sort((a, b) => a.username.localeCompare(b.username));
}
