"use client";

import { Seal } from "@kimono/ui";
import { useEffect, useRef, useState, useTransition } from "react";
import { closeImpersonationNotice, stopImpersonating } from "@/app/(shell)/impersonation-actions";
import type { ImpersonationNotice } from "@/lib/impersonation";

/** Across the top of every page while an administrator is signed in as someone else. */
export function ImpersonationStrip({ name, identity }: { name: string; identity: string | null }) {
  const [pending, start] = useTransition();
  const stop = () => start(async () => {
    /* The identity provider keeps the switch in this browser's sign-in there, so the browser ends it. */
    if (identity) await fetch(`${identity}/api/v3/core/users/impersonate_end/`, { mode: "no-cors", credentials: "include" }).catch(() => {});
    await stopImpersonating();
    // eslint-disable-next-line no-restricted-syntax, @next/next/no-location-assign-relative-destination -- signing in again leaves for the identity provider and back; a full load, not a page change.
    window.location.assign("/login/switch");
  });
  return <div className="impersonation-strip" role="status">
    <span>Signed in as <b>{name}</b></span>
    <Seal compact tone="quiet" onClick={stop} disabled={pending}>{pending ? "Stopping…" : "Stop"}</Seal>
  </div>;
}

const when = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Once, after signing in: the times an administrator signed in as you. */
export function ImpersonationNoticeDialog({ notices }: { notices: ImpersonationNotice[] }) {
  const box = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => { if (open && !box.current?.open) box.current?.showModal(); }, [open]);
  if (!open) return null;
  const close = () => { box.current?.close(); setOpen(false); void closeImpersonationNotice(); };
  const people = [...new Set(notices.map((notice) => notice.by))];
  return <dialog ref={box} className="k-tutorial impersonation-notice" aria-labelledby="impersonation-notice-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className="k-tutorial-header">
      <h2 id="impersonation-notice-title">{people.length === 1 ? `${people[0]} signed in as you` : "Someone signed in as you"}</h2>
    </header>
    <ul className="impersonation-list">
      {notices.map((notice) => <li key={notice.id}>
        <b>{people.length === 1 ? when.format(new Date(notice.at)) : `${notice.by} · ${when.format(new Date(notice.at))}`}</b>
        {notice.reason && <span>“{notice.reason}”</span>}
      </li>)}
    </ul>
    <footer className="k-tutorial-footer">
      <Seal onClick={close}>OK</Seal>
    </footer>
  </dialog>;
}
