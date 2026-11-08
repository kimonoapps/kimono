"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/*
 * Files dragged in from the computer, the same everywhere. The page you're on
 * says what a drop does there (attach to this chat, add to this folder); then
 * a drop anywhere on the page does it, not only on one box. Where nothing
 * takes files, a drop does nothing: the browser never opens the file in
 * place of Kimono.
 */

export type FileDropTarget = {
  /** What the sheet says while files are held over the page. */
  label: string;
  /** Read the drop while it's being handled: folders can only be walked then. */
  onDrop: (data: DataTransfer) => void;
};

const targets: { current: FileDropTarget }[] = [];
let holding = false;
const listeners = new Set<() => void>();
const tell = () => { for (const listen of listeners) listen(); };
const set = (next: boolean) => { if (next === holding) return; holding = next; tell(); };
const subscribe = (listen: () => void) => { listeners.add(listen); return () => { listeners.delete(listen); }; };

const carriesFiles = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes("Files"));
const top = () => targets[targets.length - 1]?.current;

/* A drag that leaves the window, or is let go of outside it, says nothing;
   one that has stopped moving over the page for a moment has gone. */
let gone: ReturnType<typeof setTimeout> | undefined;
function onOver(event: DragEvent) {
  if (!carriesFiles(event) || event.defaultPrevented) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = top() ? "copy" : "none";
  set(Boolean(top()));
  clearTimeout(gone);
  gone = setTimeout(() => set(false), 160);
}
function onDrop(event: DragEvent) {
  if (!carriesFiles(event)) return;
  clearTimeout(gone);
  set(false);
  if (event.defaultPrevented) return;
  event.preventDefault();
  top()?.onDrop(event.dataTransfer!);
}
function onEnd() { clearTimeout(gone); set(false); }

/** Once, in the frame every signed-in page stands in. */
export function FileDropLayer() {
  useEffect(() => {
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onEnd);
    return () => { window.removeEventListener("dragover", onOver); window.removeEventListener("drop", onDrop); window.removeEventListener("dragend", onEnd); };
  }, []);
  const label = useSyncExternalStore(subscribe, () => holding ? top()?.label ?? null : null, () => null);
  if (!label) return null;
  return <div className="k-filedrop" aria-hidden="true">
    <div>
      <span className="k-filedrop-mark"><svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg></span>
      <b>{label}</b>
    </div>
  </div>;
}

/**
 * Makes this page the place dropped files go, while `target` is given.
 * The newest page to ask wins, so a dialog over a page can take them for itself.
 */
export function useFileDrop(target: FileDropTarget | null) {
  const latest = useRef<FileDropTarget | null>(target);
  /* The label can change while files are held (a folder opening under them). */
  useEffect(() => { latest.current = target; if (holding) tell(); });
  const on = target !== null;
  useEffect(() => {
    if (!on) return;
    const entry = { get current() { return latest.current!; } };
    targets.push(entry);
    tell();
    return () => { const at = targets.indexOf(entry); if (at >= 0) targets.splice(at, 1); if (!targets.length) set(false); else tell(); };
  }, [on]);
}

/** Files in a drop, without folders. */
export const filesIn = (data: DataTransfer) => Array.from(data.files);
