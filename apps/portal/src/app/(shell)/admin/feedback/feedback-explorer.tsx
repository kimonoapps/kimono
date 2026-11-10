"use client";

import { useMemo, useState } from "react";
import type { BankEntry } from "@/lib/code/feedback";
import { Crossing } from "@/components/crossing";
import { Icon } from "../../code/icons";

type Filter = "todo" | "all" | "down" | "up" | "report" | "noted" | "done" | "ignored";

const when = (at: number) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const firstLine = (text: string) => text.trim().split("\n").find((l) => l.trim())?.trim() ?? "";

function haystack(entry: BankEntry) {
  const answers = entry.type === "rating" ? [...entry.before, entry.answer] : entry.chat;
  const words = answers.flatMap((a) => [a.asked, a.model ?? "", a.error ?? "", ...a.steps.map((s) => s.said ?? s.tool ?? s.artifact ?? "")]);
  return [...words, entry.type === "rating" ? entry.note : entry.reason].join("\n").toLowerCase();
}

/** The bank as a list to read: filters and a search on top, each entry opening its chat as it was kept. */
export function FeedbackExplorer({ entries }: { entries: BankEntry[] }) {
  /* Opens on what's still to do, like an inbox. */
  const [filter, setFilter] = useState<Filter>("todo");
  const [query, setQuery] = useState("");
  const indexed = useMemo(() => entries.map((entry, i) => ({ entry, i, text: haystack(entry) })), [entries]);
  const up = entries.filter((e) => e.type === "rating" && e.rating === 1).length;
  const down = entries.filter((e) => e.type === "rating" && e.rating === -1).length;
  const reports = entries.length - up - down;
  const noted = entries.filter((e) => e.type === "rating" ? e.note.trim() : e.reason.trim()).length;
  const todo = entries.filter((e) => !e.status).length;
  const done = entries.filter((e) => e.status === "done").length;
  const ignored = entries.filter((e) => e.status === "ignored").length;

  const q = query.trim().toLowerCase();
  const shown = indexed.filter(({ entry, text }) =>
    (filter === "all"
      || (filter === "todo" && !entry.status)
      || (filter === "done" && entry.status === "done")
      || (filter === "ignored" && entry.status === "ignored")
      || (filter === "up" && entry.type === "rating" && entry.rating === 1)
      || (filter === "down" && entry.type === "rating" && entry.rating === -1)
      || (filter === "report" && entry.type === "report")
      || (filter === "noted" && (entry.type === "rating" ? entry.note.trim() : entry.reason.trim())))
    && (!q || text.includes(q)));

  const filters: [Filter, string, number][] = [["todo", "To do", todo], ["all", "All", entries.length], ["down", "Thumbs down", down], ["up", "Thumbs up", up], ["report", "Reports", reports], ["noted", "With a note", noted], ["done", "Done", done], ["ignored", "Ignored", ignored]];

  return <div className="fb">
    <div className="status-grid fb-stats">
      <div className="status-card" style={{ background: "var(--sc)" }}><span className="big" style={{ color: "var(--plum)" }}>{up + down ? `${Math.round((up / (up + down)) * 100)}%` : "—"}</span><b>liked</b><small>{up} up · {down} down</small></div>
      <div className="status-card" style={{ background: "var(--sc)" }}><span className="big" style={{ color: "var(--plum)" }}>{reports}</span><b>{reports === 1 ? "chat reported" : "chats reported"}</b><small>Whole chats, sent with no name</small></div>
      <div className="status-card" style={{ background: "var(--sc)" }}><span className="big" style={{ color: "var(--plum)" }}>{noted}</span><b>with a note</b><small>What people said in words</small></div>
    </div>

    <div className="fb-tools">
      <div className="catalog-filters">
        {filters.map(([key, label, count]) => <button key={key} type="button" className={`k-seal k-tone-quiet${filter === key ? " is-active" : ""}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span>{count}</span></button>)}
      </div>
      <label className="catalog-search fb-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM16 16l4.5 4.5" /></svg>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search asks, answers, notes, models" aria-label="Search feedback" />
        {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>×</button> : null}
      </label>
    </div>

    {shown.length === 0
      ? <div className="card fb-empty"><b>{!entries.length ? "No feedback yet" : filter === "todo" && !q ? "All caught up" : "Nothing matches"}</b><p className="lead">{!entries.length ? "Thumbs and reports from Kimono AI show up here." : filter === "todo" && !q ? "Everything has been replied to, marked done or ignored." : "Try another filter or search."}</p></div>
      : <div className="seg fb-list">{shown.map(({ entry, i }) => <Entry key={i} entry={entry} />)}</div>}
  </div>;
}

function Entry({ entry }: { entry: BankEntry }) {
  const rating = entry.type === "rating";
  const words = rating ? entry.note.trim() : entry.reason.trim();
  const asked = rating ? firstLine(entry.answer.asked) : firstLine(entry.chat[0]?.asked ?? "");
  const model = rating ? entry.answer.model : entry.chat.find((a) => a.model)?.model;
  const mark = rating ? (entry.rating === 1 ? "up" : "down") : "report";
  const left = entry.status ? <span className={`fb-status is-${entry.status}`}>{entry.status === "done" ? "Done" : "Ignored"}</span> : null;
  const inner = <>
    <span className="fb-mark" title={rating ? (entry.rating === 1 ? "Thumbs up" : "Thumbs down") : "Reported chat"}>
      {rating ? <Icon name={entry.rating === 1 ? "thumb-up" : "thumb-down"} /> : <b>!</b>}
    </span>
    <span className="fb-text">
      <b>{asked || <i>No ask</i>}</b>
      {words ? <small className="fb-words">“{words}”</small> : null}
    </span>
    {left}
    <span className="fb-meta">
      <small title={entry.sandboxVersion ? `Sandbox ${entry.sandboxVersion}` : undefined}>{when(entry.at)}{entry.version ? ` · ${entry.version}` : ""}</small>
      <small>{rating ? model ?? "" : `${entry.chat.length} turn${entry.chat.length === 1 ? "" : "s"}`}</small>
    </span>
  </>;
  return entry.ref
    ? <Crossing kind="kakejiku" href={`/admin/feedback/${entry.ref}`} className={`row fb-entry is-${mark}${entry.status ? " is-handled" : ""}`}>{inner}</Crossing>
    : <div className={`row fb-entry is-${mark}`}>{inner}</div>;
}
