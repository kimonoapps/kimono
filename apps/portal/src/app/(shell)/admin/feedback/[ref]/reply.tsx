"use client";

import { useState } from "react";
import { Seal } from "@kimono/ui";
import type { Reply } from "@/lib/code/feedback";

/** A thank-you to the person who gave a thumb, with a note if you write one. They see it under the answer. */
export function ReplyToRating({ entryRef, reply }: { entryRef: string; reply?: Reply }) {
  const [given, setGiven] = useState(reply ?? null);
  const [note, setNote] = useState(reply?.note ?? "");
  const [editing, setEditing] = useState(!reply);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function send() {
    setSending(true); setProblem(null);
    try {
      const response = await fetch(`/api/v1/code/feedback/${encodeURIComponent(entryRef)}/reply`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }),
      });
      const said = await response.json().catch(() => ({})) as { reply?: Reply; error?: string };
      if (!response.ok || !said.reply) throw new Error(said.error || "That didn't send. Try again.");
      setGiven(said.reply); setNote(said.reply.note); setEditing(false);
    } catch (error) { setProblem(error instanceof Error ? error.message : "That didn't send. Try again."); } finally { setSending(false); }
  }

  if (!editing && given) return <section className="fb-reply is-sent" aria-label="Your reply">
    <div className="fb-reply-said"><b>Thank you for your feedback!</b>{given.note ? <p>{given.note}</p> : null}</div>
    <Seal type="button" compact tone="quiet" onClick={() => setEditing(true)}>Change</Seal>
  </section>;

  return <section className="fb-reply" aria-label="Reply">
    <p className="fb-reply-head">They&rsquo;ll see <b>Thank you for your feedback!</b> under the answer.</p>
    <textarea value={note} maxLength={2000} rows={3} placeholder="Admin note (optional)" aria-label="Admin note" onChange={(e) => setNote(e.target.value)} />
    <div className="fb-reply-acts">
      {problem ? <p className="fb-reply-problem" role="alert">{problem}</p> : null}
      {given ? <Seal type="button" compact tone="quiet" onClick={() => { setNote(given.note); setEditing(false); }}>Cancel</Seal> : null}
      <Seal type="button" compact disabled={sending} onClick={() => void send()}>{sending ? "Sending" : given ? "Send again" : "Reply"}</Seal>
    </div>
  </section>;
}
