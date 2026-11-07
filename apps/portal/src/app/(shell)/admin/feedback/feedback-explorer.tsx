"use client";

import { useMemo, useState } from "react";
import type { Answer, BankEntry } from "@/lib/code/feedback";
import { Icon } from "../../code/icons";
import { Markdown } from "../../code/markdown";

type Filter = "all" | "down" | "up" | "report" | "noted";

const when = (at: number) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const took = (ms?: number) => !ms ? null : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
const firstLine = (text: string) => text.trim().split("\n").find((l) => l.trim())?.trim() ?? "";

function haystack(entry: BankEntry) {
  const answers = entry.type === "rating" ? [entry.answer] : entry.chat;
  const words = answers.flatMap((a) => [a.asked, a.model ?? "", a.error ?? "", ...a.steps.map((s) => s.said ?? s.tool ?? s.artifact ?? "")]);
  return [...words, entry.type === "rating" ? entry.note : entry.reason].join("\n").toLowerCase();
}

/** The bank as a list to read: filters and a search on top, each entry opening to the answer as it was. */
export function FeedbackExplorer({ entries }: { entries: BankEntry[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const indexed = useMemo(() => entries.map((entry, i) => ({ entry, i, text: haystack(entry) })), [entries]);
  const up = entries.filter((e) => e.type === "rating" && e.rating === 1).length;
  const down = entries.filter((e) => e.type === "rating" && e.rating === -1).length;
  const reports = entries.length - up - down;
  const noted = entries.filter((e) => e.type === "rating" ? e.note.trim() : e.reason.trim()).length;

  const q = query.trim().toLowerCase();
  const shown = indexed.filter(({ entry, text }) =>
    (filter === "all"
      || (filter === "up" && entry.type === "rating" && entry.rating === 1)
      || (filter === "down" && entry.type === "rating" && entry.rating === -1)
      || (filter === "report" && entry.type === "report")
      || (filter === "noted" && (entry.type === "rating" ? entry.note.trim() : entry.reason.trim())))
    && (!q || text.includes(q)));

  const filters: [Filter, string, number][] = [["all", "All", entries.length], ["down", "Thumbs down", down], ["up", "Thumbs up", up], ["report", "Reports", reports], ["noted", "With a note", noted]];

  return <div className="fb">
    <div className="status-grid fb-stats">
      <div className="status-card" style={{ background: "var(--sc)" }}><span className="big" style={{ color: "var(--plum)" }}>{up + down ? `${Math.round((up / (up + down)) * 100)}%` : "—"}</span><b>liked</b><small>{up} up · {down} down</small></div>
      <div className="status-card" style={{ background: "var(--sc)" }}><span className="big" style={{ color: "var(--plum)" }}>{reports}</span><b>{reports === 1 ? "chat reported" : "chats reported"}</b><small>Whole chats, sent with no name</small></div>
      <div className="status-card" style={{ background: "var(--sc)" }}><span className="big" style={{ color: "var(--plum)" }}>{noted}</span><b>with a note</b><small>What people said in words</small></div>
    </div>

    <div className="fb-tools">
      <div className="catalog-filters">
        {filters.map(([key, label, count]) => <button key={key} type="button" className={`k-seal k-tone-quiet${filter === key ? " is-active" : ""}`} aria-pressed={filter === key} onClick={() => { setFilter(key); setOpen(null); }}>{label}<span>{count}</span></button>)}
      </div>
      <label className="catalog-search fb-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM16 16l4.5 4.5" /></svg>
        <input value={query} onChange={(e) => { setQuery(e.target.value); setOpen(null); }} placeholder="Search asks, answers, notes, models" aria-label="Search feedback" />
        {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>×</button> : null}
      </label>
    </div>

    {shown.length === 0
      ? <div className="card fb-empty"><b>{entries.length ? "Nothing matches" : "No feedback yet"}</b><p className="lead">{entries.length ? "Try another filter or search." : "Thumbs and reports from Kimono AI show up here."}</p></div>
      : <div className="seg fb-list">{shown.map(({ entry, i }) => <Entry key={i} entry={entry} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />)}</div>}
  </div>;
}

function Entry({ entry, open, onToggle }: { entry: BankEntry; open: boolean; onToggle: () => void }) {
  const rating = entry.type === "rating";
  const words = rating ? entry.note.trim() : entry.reason.trim();
  const asked = rating ? firstLine(entry.answer.asked) : firstLine(entry.chat[0]?.asked ?? "");
  const model = rating ? entry.answer.model : entry.chat.find((a) => a.model)?.model;
  const mark = rating ? (entry.rating === 1 ? "up" : "down") : "report";
  return <div className={`fb-entry is-${mark}${open ? " is-open" : ""}`}>
    <button type="button" className="fb-head" aria-expanded={open} onClick={onToggle}>
      <span className="fb-mark" title={rating ? (entry.rating === 1 ? "Thumbs up" : "Thumbs down") : "Reported chat"}>
        {rating ? <Icon name={entry.rating === 1 ? "thumb-up" : "thumb-down"} /> : <b>!</b>}
      </span>
      <span className="fb-text">
        <b>{asked || <i>No ask</i>}</b>
        {words ? <small className="fb-words">“{words}”</small> : null}
      </span>
      <span className="fb-meta">
        <small>{when(entry.at)}</small>
        <small>{rating ? model ?? "" : `${entry.chat.length} turn${entry.chat.length === 1 ? "" : "s"}`}</small>
      </span>
    </button>
    {open ? <div className="fb-body">
      {rating ? <Turn answer={entry.answer} /> : entry.chat.map((answer, n) => <Turn key={n} answer={answer} label={`Turn ${n + 1}`} />)}
    </div> : null}
  </div>;
}

function Turn({ answer, label }: { answer: Answer; label?: string }) {
  const facts = [answer.model, took(answer.durationMs), answer.ok ? null : "Failed"].filter(Boolean).join(" · ");
  return <section className="fb-turn">
    {label || facts ? <div className="fb-turn-head">{label ? <b>{label}</b> : null}{facts ? <small>{facts}</small> : null}</div> : null}
    <div className="fb-ask"><Markdown text={answer.asked || "_(nothing asked)_"} />{answer.attachments.length ? <small>Attached: {answer.attachments.join(", ")}</small> : null}</div>
    <div className="fb-steps">
      {answer.steps.map((step, n) => step.said !== undefined
        ? <div key={n} className="cd-say fb-said"><Markdown text={step.said} /></div>
        : step.tool
          ? <div key={n} className={`fb-tool${step.ok === false ? " is-failed" : ""}`}><b>{step.tool}</b><code>{step.detail}</code>{step.ok === false ? <small>failed</small> : null}</div>
          : step.artifact
            ? <div key={n} className="fb-tool"><b>artifact</b><code>{step.artifact}</code></div>
            : step.sent
              ? <div key={n} className="fb-tool"><b>sent</b><code>{step.sent.join(", ")}</code></div>
              : null)}
      {answer.error ? <div className="fb-error">{answer.error}</div> : null}
    </div>
  </section>;
}
