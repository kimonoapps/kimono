"use client";

import { useState } from "react";
import { Seal } from "@kimono/ui";
import type { Reply, Status } from "@/lib/code/feedback";

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const said = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(said.error || "That didn't work. Try again.");
  return said;
}

/**
 * Dealing with one piece of feedback. A thumb can be replied to: the person
 * sees "Thank you for your feedback!" under the answer, with the note if one
 * is written, and that marks it done. Anything can be marked done or ignored
 * without a reply, and put back to do.
 */
export function Triage({ entryRef, canReply, reply, status }: { entryRef: string; canReply: boolean; reply?: Reply; status?: Status }) {
  const base = `/api/v1/code/feedback/${encodeURIComponent(entryRef)}`;
  const [given, setGiven] = useState(reply ?? null);
  const [left, setLeft] = useState<Status | null>(status ?? null);
  const [note, setNote] = useState(reply?.note ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setProblem(null);
    try { await work(); } catch (error) { setProblem(error instanceof Error ? error.message : "That didn't work. Try again."); } finally { setBusy(false); }
  };
  const send = () => run(async () => {
    const { reply: sent } = await post<{ reply: Reply }>(`${base}/reply`, { note });
    setGiven(sent); setNote(sent.note); setLeft("done"); setEditing(false);
  });
  const mark = (next: Status | null) => run(async () => { await post(`${base}/status`, { status: next }); setLeft(next); setEditing(false); });

  const failed = problem ? <p className="fb-reply-problem" role="alert">{problem}</p> : null;

  if (left && !editing) return <section className={`fb-reply is-sent is-${left}`} aria-label="Status">
    <div className="fb-reply-said">
      <span className="fb-state">{left === "done" ? "Done" : "Ignored"}</span>
      {given ? <><b>Thank you for your feedback!</b>{given.note ? <p>{given.note}</p> : null}</> : null}
    </div>
    <div className="fb-reply-acts">
      {failed}
      {canReply && left === "done" && given ? <Seal type="button" compact tone="quiet" onClick={() => setEditing(true)}>Change reply</Seal> : null}
      <Seal type="button" compact tone="quiet" disabled={busy} onClick={() => void mark(null)}>Reopen</Seal>
    </div>
  </section>;

  return <section className="fb-reply" aria-label="Reply">
    {canReply ? <>
      <p className="fb-reply-head">They&rsquo;ll see <b>Thank you for your feedback!</b> under the answer.</p>
      <textarea value={note} maxLength={2000} rows={3} placeholder="Admin note (optional)" aria-label="Admin note" onChange={(e) => setNote(e.target.value)} />
    </> : <p className="fb-reply-head">Reports have no name, so there&rsquo;s no one to reply to.</p>}
    <div className="fb-reply-acts">
      {failed}
      {editing ? <Seal type="button" compact tone="quiet" onClick={() => { setNote(given?.note ?? ""); setEditing(false); }}>Cancel</Seal> : <>
        <Seal type="button" compact tone="quiet" disabled={busy} onClick={() => void mark("ignored")}>Ignore</Seal>
        {canReply ? null : <Seal type="button" compact disabled={busy} onClick={() => void mark("done")}>Mark as done</Seal>}
      </>}
      {canReply ? <Seal type="button" compact disabled={busy} onClick={() => void send()}>{busy ? "Sending" : given ? "Send again" : "Reply"}</Seal> : null}
    </div>
  </section>;
}
