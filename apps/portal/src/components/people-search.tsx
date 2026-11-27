"use client";

import { cx, SearchField } from "@kimono/ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Portrait } from "./portrait";
import "./people-search.css";

/*
 * 人 Finding someone on this Kimono, the one way every app does it: type
 * three letters of a name and the closest few are shown. No app is ever
 * given everyone (lib/people); people it already knows of by username come
 * from the book below, asked for a few at a time.
 */

export type Person = { username: string; name: string; picture: string | null };

export const FIND_AT_LEAST = 3;

/** Anyone on this Kimono whose name has what was typed (three letters at least). */
export const findPeople = (typed: string): Promise<Person[]> =>
  fetch(`/api/v1/people?q=${encodeURIComponent(typed)}`, { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() as Promise<{ people: Person[] }> : Promise.reject(new Error("Search didn't work."))))
    .then((r) => r.people);

export function PeopleSearch({ onPick, skip, suggested = [], find = findPeople, action, placeholder = "Add people", autoFocus, onEmptyBackspace, className }: {
  onPick: (person: Person) => void | Promise<unknown>;
  /** Usernames not to show: the owner, who's in already. */
  skip?: Iterable<string>;
  /** Shown before anything is typed (friends, say). */
  suggested?: Person[];
  /** Where people are found; Friends finds only people not yet asked. */
  find?: (typed: string) => Promise<Person[]>;
  /** What a row says it does at its end ("Add"); without it the whole row picks. */
  action?: ReactNode;
  placeholder?: string;
  autoFocus?: boolean;
  onEmptyBackspace?: () => void;
  className?: string;
}) {
  const [typed, setTyped] = useState("");
  /* What the newest search found, with what it was for: an older answer, or one under three letters, isn't shown. */
  const [answer, setAnswer] = useState<{ q: string; people: Person[] } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const asked = useRef(0);
  const q = typed.trim().replace(/^@/, "");
  useEffect(() => {
    const n = ++asked.current;
    if (q.length < FIND_AT_LEAST) return;
    const timer = setTimeout(() => { find(q).then((people) => { if (n === asked.current) setAnswer({ q, people }); }, () => { if (n === asked.current) setAnswer({ q, people: [] }); }); }, 180);
    return () => clearTimeout(timer);
  }, [q, find]);
  const found = answer?.q === q ? answer.people : null;
  const hidden = useMemo(() => new Set([...(skip ?? []), ...picked].map((u) => u.toLowerCase())), [skip, picked]);
  const shown = (q ? found ?? [] : suggested).filter((p) => !hidden.has(p.username.toLowerCase()));
  const pick = (p: Person) => {
    setTyped("");
    setPicked((now) => [...now, p.username]);
    void Promise.resolve(onPick(p)).catch(() => setPicked((now) => now.filter((u) => u !== p.username)));
  };
  return <div className={cx("people-search", className)}>
    <SearchField value={typed} onChange={setTyped} placeholder={placeholder} autoFocus={autoFocus}
      onKeyDown={(event) => {
        if (event.key === "Enter" && shown[0]) { event.preventDefault(); pick(shown[0]); }
        if (event.key === "Backspace" && !typed) onEmptyBackspace?.();
      }} />
    {shown.length ? <div className="people-search-found" role="listbox" aria-label="People">
      {shown.map((p) => <button key={p.username} type="button" role="option" aria-selected={false} onClick={() => pick(p)}>
        <Portrait name={p.name} username={p.username} picture={p.picture} size={36} />
        <span><b>{p.name || p.username}</b><small>@{p.username}</small></span>
        {action ? <span className="people-search-act">{action}</span> : null}
      </button>)}
    </div>
      : q && q.length < FIND_AT_LEAST ? <p className="people-search-note">Keep typing</p>
      : q && found ? <p className="people-search-note">No one by that name</p> : null}
  </div>;
}

/* ───── The book: people already known by username ───── */

const book = new Map<string, Person>();
const asking = new Set<string>();
/* Asked for and not found (gone, or never a username): not asked for again. */
const missing = new Set<string>();
const NOT_NAMES = new Set(["then", "toJSON", "constructor", "valueOf", "toString"]);
const listeners = new Set<() => void>();
let queued: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function lookUp(username: string) {
  const u = username.toLowerCase();
  if (!u || NOT_NAMES.has(username) || username.startsWith("$$") || book.has(u) || asking.has(u) || missing.has(u)) return;
  asking.add(u);
  queued.push(u);
  timer ??= setTimeout(() => {
    const batch = queued; queued = []; timer = null;
    fetch(`/api/v1/people?u=${encodeURIComponent(batch.join(","))}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() as Promise<{ people: Person[] }> : { people: [] }))
      .then((r) => {
        for (const p of r.people) book.set(p.username.toLowerCase(), p);
        for (const x of batch) if (!book.has(x)) missing.add(x);
        if (r.people.length) listeners.forEach((l) => l());
      }, () => batch.forEach((x) => missing.add(x)))
      .finally(() => batch.forEach((x) => asking.delete(x)));
  }, 30);
}

/** Remembers people an answer already carried, so they needn't be asked for. */
export function knowPeople(people: Person[]) {
  for (const p of people) book.set(p.username.toLowerCase(), p);
  listeners.forEach((l) => l());
}

/**
 * People by lower-case username, for portraits and names: reading someone
 * not known yet asks for them (with the others read meanwhile) and the
 * component draws again when they arrive. It can't be listed.
 */
export function usePeopleBook(): Readonly<Record<string, Person>> {
  /* A fresh view each time the book grows, so memos and contexts see the change. */
  const [view, setView] = useState(bookView);
  useEffect(() => {
    const changed = () => setView(bookView());
    listeners.add(changed);
    return () => { listeners.delete(changed); };
  }, []);
  return view;
}

const bookView = (): Readonly<Record<string, Person>> => new Proxy({} as Record<string, Person>, {
  get: (_, key) => {
    if (typeof key !== "string") return undefined;
    const found = book.get(key.toLowerCase());
    if (!found) lookUp(key);
    return found;
  },
});
