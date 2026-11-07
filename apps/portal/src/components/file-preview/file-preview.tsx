"use client";

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Scroller } from "@/components/scroller";
import { extensionLabel, isMarkdown, lowerExtension, previewKind } from "./kinds";
import { CodePeek, codeLanguage, TypeMark } from "./peek";
import "./file-preview.css";

/*
 * A file, previewed: the same box in Drive's drawer and in Kimono AI. Pictures,
 * video and sound play as themselves; code is numbered and coloured; Markdown is
 * read; other text shows as it is; anything else wears its type's mark. A corner
 * button opens it over the whole window.
 */

export { CodePeek, codeLanguage, TypeMark } from "./peek";
export { extensionLabel, isMarkdown, lowerExtension, previewKind, type PreviewKind } from "./kinds";

const MarkdownPeek = lazy(() => import("./markdown"));
const PEEK_BYTES = 24576;

type Source = {
  name: string;
  /** Where the file's bytes are (read with a range for text). */
  url?: string;
  mime?: string | null;
  /** The text itself, when it's already been read. */
  text?: string;
  /** How a picture is drawn, when the caller has a better way than the file itself (Drive's thumbnails). */
  picture?: ReactNode;
};

/** The preview box's classes and what goes in it. */
function parts({ name, url, mime, text, picture }: Source) {
  const kind = text !== undefined ? "text" : previewKind(name, mime);
  const label = extensionLabel(name);
  const code = kind === "text" && !isMarkdown(name) && codeLanguage(lowerExtension(name)) !== null;
  const shown = kind === "image" || kind === "video" || kind === "text";
  const className = ["fp", kind === "text" && "text", code && "code", kind === "text" && isMarkdown(name) && "md", !shown && kind !== "audio" && "plain"].filter(Boolean).join(" ");
  const mark = <span className="fp-type-big"><TypeMark name={name} fallback={<span className="ext">{label}</span>} /></span>;
  // eslint-disable-next-line @next/next/no-img-element -- the file itself
  const body = kind === "image" ? picture ?? (url ? <img src={url} alt={name} decoding="async" /> : mark)
    : kind === "video" && url ? <video src={url} controls preload="metadata" playsInline />
    : kind === "audio" && url ? <audio src={url} controls />
    : kind === "text" ? <TextPeek url={url} text={text} name={name} />
    : mark;
  return { className, body, mark, shown, kind };
}

/** Whether a file has more to show than its mark: pictures, video and text. */
export const previewable = (name: string, mime?: string | null) => ["image", "video", "text"].includes(previewKind(name, mime));

/**
 * The file in a box, with a button to open it over the whole window. Size the
 * box with [className]; [actions] sit beside the name when it's expanded.
 */
export function FilePreview({ className, actions, overlayClassName, expandable = true, ...source }: Source & {
  className?: string;
  actions?: ReactNode;
  overlayClassName?: string;
  expandable?: boolean;
}) {
  const { className: own, body, mark, shown } = parts(source);
  const [big, setBig] = useState(false);
  const expander = useRef<HTMLButtonElement>(null);
  return <div className={className ? `${own} ${className}` : own}>
    {/* Expanded, the file plays in one place only: the box keeps just its mark. */}
    {big ? mark : body}
    {expandable && shown && !big ? <button type="button" ref={expander} className="fp-expand" aria-label="Expand" title="Expand" onClick={() => setBig(true)}><ExpandIcon /></button> : null}
    {big ? <FileOverlay {...source} className={overlayClassName} actions={actions} onClose={() => { setBig(false); requestAnimationFrame(() => expander.current?.focus()); }} /> : null}
  </div>;
}

/** The file over the whole window: its name, [actions], and the way back (the button or Escape). */
/** [into] is where it's drawn, for a caller inside a modal dialog (the page's top layer would cover it otherwise). */
export function FileOverlay({ className, actions, onClose, into, ...source }: Source & { className?: string; actions?: ReactNode; onClose: () => void; into?: Element | null }) {
  const { className: own, body } = parts(source);
  const close = useRef<HTMLButtonElement>(null);
  const leave = useRef(onClose);
  useEffect(() => { leave.current = onClose; }, [onClose]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); leave.current(); } };
    window.addEventListener("keydown", escape, true);
    const page = document.documentElement;
    const overflow = page.style.overflow;
    page.style.overflow = "hidden";
    close.current?.focus();
    return () => { window.removeEventListener("keydown", escape, true); page.style.overflow = overflow; };
  }, []);
  return createPortal(<div className={className ? `fp-big ${className}` : "fp-big"} role="dialog" aria-modal="true" aria-label={source.name}>
    <div className="fp-big-top">
      <h2>{source.name.slice(source.name.lastIndexOf("/") + 1)}</h2>
      {actions}
      <button type="button" ref={close} className="fp-big-close" aria-label="Close" title="Close (Esc)" onClick={onClose}><ShrinkIcon /></button>
    </div>
    <div className="fp-big-stage"><div className={own}>{body}</div></div>
  </div>, into ?? document.body);
}

/** A file as a small tile: its picture when [picture] gives one, a frame of the video at [video], otherwise its type's mark. */
export function FileThumb({ name, picture, video, size, className }: { name: string; picture?: string | null; video?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style = size ? { "--fp-thumb": `${size}px` } as React.CSSProperties : undefined;
  const label = extensionLabel(name);
  /* The browser draws the frame at half a second in (the very first is often black); nothing plays. */
  if (video && !picture && !failed) return <span className={`fp-thumb pic vid${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
    <video src={`${video}#t=0.5`} preload="metadata" muted playsInline tabIndex={-1} onError={() => setFailed(true)} />
  </span>;
  if (picture && !failed) return <span className={`fp-thumb pic${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
    {/* eslint-disable-next-line @next/next/no-img-element -- a small picture of the file itself */}
    <img src={picture} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
  </span>;
  return <span className={`fp-thumb${className ? ` ${className}` : ""}`} style={style} aria-hidden="true"><TypeMark name={name} fallback={<span className="ext">{label}</span>} /></span>;
}

/** A text or code file's opening (its first 24 KB, read with a range), or [text] when it's already here. */
function TextPeek({ url, text: given, name }: { url?: string; text?: string; name: string }) {
  const [read, setRead] = useState<string | null>(null);
  useEffect(() => {
    if (given !== undefined || !url) return;
    const stop = new AbortController();
    fetch(url, { headers: { Range: `bytes=0-${PEEK_BYTES - 1}` }, credentials: "same-origin", signal: stop.signal })
      .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status))))
      .then((bytes) => {
        const view = new Uint8Array(bytes).subarray(0, PEEK_BYTES);
        if (view.includes(0)) { setRead(""); return; }
        let decoded = new TextDecoder("utf-8", { fatal: false }).decode(view);
        if (bytes.byteLength >= PEEK_BYTES) decoded = decoded.replace(/�?[^\n]*$/, "");
        setRead(decoded);
      })
      .catch(() => { if (!stop.signal.aborted) setRead(""); });
    return () => stop.abort();
  }, [url, given]);
  const text = given ?? read;
  const label = extensionLabel(name);
  if (text === null || !text.trim()) return <span className="ext">{label}</span>;
  if (isMarkdown(name)) return <Suspense fallback={<span className="ext">{label}</span>}><MarkdownPeek text={text} /></Suspense>;
  const ext = lowerExtension(name);
  if (codeLanguage(ext)) return <CodePeek text={text} ext={ext} />;
  return <Scroller className="fp-fill" viewClassName="fp-text" tabIndex={0}><pre>{text}</pre></Scroller>;
}

function ExpandIcon() {
  return <svg className="fp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" /></svg>;
}

function ShrinkIcon() {
  return <svg className="fp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10h-5V5M5 14h5v5M14 10l6-6M10 14l-6 6" /></svg>;
}
