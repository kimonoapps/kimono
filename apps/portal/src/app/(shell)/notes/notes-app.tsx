"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Choice, cx, InkBlot, InkPortraitFrame, InkLoader, Seal } from "@kimono/ui";
import { HoldSeal } from "@/components/hold-seal";
import { InkCrest } from "@/components/ink-crest";
import { Portrait as Face } from "@/components/portrait";
import { SkeletonRows } from "@/components/skeleton";
import { swap } from "@/components/motion";
import { notes, when, type Cursor, type Library, type Note, type Notebook, type Person, type Section, type Shareable, type Sharing } from "./api";
import type { Action, BodyHandle, Formats, LiveUpdate } from "./editor";
import { Icon, type IconName } from "./icons";

/*
 * 帳 Kimono Notes on the web: one surface in three tones, the note list beside
 * the open note, and the notebooks panel that opens over the list from the
 * place in its header and closes again once you pick (docs/kimono-notes.md).
 * Where you are lives in the address (?in=…&n=…), so a reload or a link
 * opens the same place. Saving is automatic; there is no Save button.
 */

const NoteBody = dynamic(() => import("./editor").then((m) => m.NoteBody), { ssr: false, loading: () => <div className="nt-body nt-body-wait" /> });

const oops = "That didn't work.";
const tint = { quiet: "#8a7c77" };
const still = () => typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches;
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** "⌘B" on a Mac, "Ctrl+B" elsewhere. */
function keyName(keys: string) {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? keys.replace(/Mod-/g, "⌘").replace(/Alt-/g, "⌥").replace(/Shift-/g, "⇧") : keys.replace(/Mod-/g, "Ctrl+").replace(/Alt-/g, "Alt+").replace(/Shift-/g, "Shift+");
}

/** Where you are is this page's own state, kept in the address: the next entry in history. */
function goTo(to: Record<string, string | null | undefined>, replace = false) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(to)) if (value) next.set(key, value);
  const url = `/notes${next.size ? `?${next}` : ""}`;
  if (replace) window.history.replaceState(null, "", url); else window.history.pushState(null, "", url);
}

/** The line a note's row shows: its first prose, without markup. */
function excerptOf(text: string, chars = 160) {
  const prose = text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .split("\n").filter((line) => !/^\s*#\s/.test(line) && !/^\s*\|?\s*:?-{3,}/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\s*\|\s*/g, " ")
      .replace(/[#>*_`~]/g, "")
      .replace(/\s+/g, " ").trim())
    /* Each line stays its own, so a list doesn't read as one sentence. */
    .filter(Boolean).join(" · ");
  return [...prose].length > chars ? `${[...prose].slice(0, chars).join("").trimEnd()}…` : prose;
}

/** Whether the window is at least this wide. */
function useWide(px: number) {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = matchMedia(`(min-width: ${px}px)`);
    const follow = () => setWide(query.matches);
    follow(); query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [px]);
  return wide;
}

/** "Edited just now", "Edited 5m ago", "Edited Tue", "Edited 3 Oct". */
function edited(at: number, now: number) {
  const word = when(at, now);
  return `Edited ${word === "now" ? "just now" : /^\d+[mh]$/.test(word) ? `${word} ago` : word}`;
}
const fullDate = (at: number) => new Date(at).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Each person's colour while writing together: the same everywhere they appear. */
const inks = ["#c2577a", "#3f8a8f", "#b7792b", "#6a6fc4", "#5f8f4e", "#a05ab5", "#c4623f", "#2f7fb0"];
function inkOf(username: string) { let h = 0; for (const c of username.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return inks[h % inks.length]; }
const firstName = (person: Person | undefined, username: string) => (person?.name?.trim() || username).split(/\s+/)[0];

/** A clock that moves the one-word times on. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  return now;
}

type Toast = { text: string; action?: { label: string; run: () => void }; ms?: number };
/** A note being written that isn't saved yet: it is made once it has a title or words. */
type Draft = { key: string; parent: string | null; id: string | null };
type Place = { kind: "all" } | { kind: "notebook"; notebook: Notebook } | { kind: "section"; notebook: Notebook; section: Section };

/** Shown in place of Notes while it is switched off; admins are sent to its page instead. */
export function NotesOff() {
  return <div className="nt-off"><Empty seed="off" words="Notes isn't switched on." /></div>;
}

function Empty({ seed, words, onNew }: { seed: string; words: string; onNew?: () => void }) {
  return <div className="nt-empty">
    <InkBlot className="nt-empty-blot" tint={tint.quiet} seed={seed}><Icon name="note" /></InkBlot>
    <p>{words}</p>
    {onNew ? <button type="button" className="nt-inlinenew" onClick={onNew}><Icon name="plus" />New note</button> : null}
  </div>;
}

/* ── Notes ── */

export function NotesApp({ me, publicLinks }: { me: string; publicLinks: boolean }) {
  const params = useSearchParams();
  const openId = params.get("n");
  /* Drive opens a notebook with ?notebook=<id>. */
  const placeId = params.get("in") ?? params.get("notebook");
  const [lib, setLib] = useState<Library | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [faces, setFaces] = useState<Record<string, string[]>>({});
  const [find, setFind] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [placesOpen, setPlacesOpen] = useState(false);
  /* On a note, whether you've widened the notebooks back out of their rail: kept for the next time. */
  const [pinned, setPinnedState] = useState(() => { try { return typeof window !== "undefined" && window.localStorage.getItem(panelKey) === "open"; } catch { return false; } });
  const setPinned = useCallback((open: boolean) => {
    setPinnedState(open);
    try { window.localStorage.setItem(panelKey, open ? "open" : "rail"); } catch { /* this page only */ }
  }, []);
  const [arriving, setArriving] = useState<string | null>(null);
  const [sharingThing, setSharing] = useState<Shareable | null>(null);
  const [leavingThing, setLeaving] = useState<Shareable | null>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const placeButton = useRef<HTMLButtonElement>(null);
  const now = useNow();

  const asked = useRef(0);
  const load = useCallback(() => {
    const n = ++asked.current;
    return notes.library().then((next) => { if (n === asked.current) { setLib(next); setProblem(null); } }, () => { if (n === asked.current) setProblem(oops); });
  }, []);
  useEffect(() => { void load(); }, [load]);
  /* The list follows edits made elsewhere too: on coming back to the window, and every 15s. */
  useEffect(() => {
    const again = () => { if (document.visibilityState !== "hidden") void load(); };
    const timer = window.setInterval(again, 15_000);
    window.addEventListener("focus", again);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", again); };
  }, [load]);
  useEffect(() => { notes.people().then((list) => setPeople(Object.fromEntries(list.map((p) => [p.username.toLowerCase(), p]))), () => {}); }, []);
  /*
   * Portraits: a notebook shared with people shows up to two of them; one
   * shared with you, and a single note shared with you, shows who shared it.
   */
  const facesFor = [...(lib?.notebooks ?? []).map((n) => `notebook:${n.id}`), ...(lib?.notes ?? []).filter((n) => n.notebookId === null).map((n) => `note:${n.id}`)].join(",");
  const [facesAsked, setFacesAsked] = useState(0);
  useEffect(() => {
    if (!facesFor) return;
    for (const key of facesFor.split(",")) {
      const [kind, id] = key.split(":") as ["notebook" | "note", string];
      notes.sharing({ kind, id }).then((r) => {
        const mine = r.shares.find((x) => x.username.toLowerCase() === me.toLowerCase());
        const shown = mine ? [mine.addedBy] : r.shares.map((x) => x.username).filter((u) => u.toLowerCase() !== me.toLowerCase());
        setFaces((all) => ({ ...all, [id]: shown.slice(0, 2) }));
      }, () => {});
    }
  }, [facesFor, me, facesAsked]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.ms ?? 6000); return () => clearTimeout(timer); }, [toast]);

  const place = useMemo<Place>(() => {
    if (!lib || !placeId) return { kind: "all" };
    const notebook = lib.notebooks.find((n) => n.id === placeId);
    if (notebook) return { kind: "notebook", notebook };
    const section = lib.sections.find((s) => s.id === placeId);
    const home = section && lib.notebooks.find((n) => n.id === section.notebookId);
    return section && home ? { kind: "section", notebook: home, section } : { kind: "all" };
  }, [lib, placeId]);

  /* Everything under a folder: a section holds its own sections' notes too. */
  const under = useCallback((folder: string) => {
    const inside = new Set([folder]);
    for (let grew = true; grew;) { grew = false; for (const s of lib?.sections ?? []) if (inside.has(s.parentId) && !inside.has(s.id)) { inside.add(s.id); grew = true; } }
    return inside;
  }, [lib]);
  const listed = useMemo(() => {
    const all = lib?.notes ?? [];
    if (place.kind === "notebook") return all.filter((n) => n.notebookId === place.notebook.id);
    if (place.kind === "section") { const inside = under(place.section.id); return all.filter((n) => inside.has(n.parentId)); }
    return all;
  }, [lib, place, under]);
  const found = useMemo(() => {
    const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? (lib?.notes ?? []).filter((n) => words.every((w) => `${n.title} ${n.excerpt ?? ""}`.toLowerCase().includes(w))).slice(0, 30) : [];
  }, [lib, find]);

  const notebookOf = useCallback((id: string) => lib?.notebooks.find((n) => n.id === id) ?? null, [lib]);
  /** The notebook a folder (a notebook or a section) is in. */
  const notebookHolding = useCallback((folder: string) => notebookOf(folder) ?? (() => { const s = lib?.sections.find((x) => x.id === folder); return s ? notebookOf(s.notebookId) : null; })(), [lib, notebookOf]);
  const canWrite = (notebook: Notebook | null) => Boolean(notebook && notebook.role !== "viewer");

  /* A note's details changed (saved, retitled, moved): the list follows, newest first. */
  const patch = useCallback((note: Partial<Note> & { id: string }, text?: string) => setLib((now) => {
    if (!now) return now;
    const known = now.notes.find((n) => n.id === note.id);
    const next: Note = { ...(known ?? { excerpt: "" } as Note), ...note, ...(text !== undefined ? { excerpt: excerptOf(text) } : {}) };
    return { ...now, notes: [next, ...now.notes.filter((n) => n.id !== note.id)].toSorted((a, b) => b.updatedAt - a.updatedAt) };
  }), []);
  const gone = useCallback((id: string) => setLib((now) => now && { ...now, notes: now.notes.filter((n) => n.id !== id) }), []);
  const savingNow = useCallback((id: string, on: boolean) => setSaving((all) => {
    if (all.has(id) === on) return all;
    const next = new Set(all); if (on) next.add(id); else next.delete(id); return next;
  }), []);

  /*
   * New note opens an empty page at once. Nothing is saved until it has a
   * title or words, so a note started and left blank leaves nothing behind.
   * `where` is a notebook or section; without one, the place you're in.
   */
  const startNew = useCallback((where?: string | null, fromAddress = false) => {
    /* Before the library has come, the place in the address is taken as it is; the server checks it. */
    const here = where !== undefined ? where : place.kind === "section" ? place.section.id : place.kind === "notebook" ? place.notebook.id : lib ? null : placeId;
    const parent = here && (!lib || canWrite(notebookHolding(here))) ? here : null;
    setDraft({ key: `draft-${Date.now()}`, parent, id: null });
    setFind("");
    setPlacesOpen(false);
    goTo({ in: where !== undefined ? where : placeId, n: "new" }, fromAddress);
  }, [place, placeId, lib, notebookHolding]);
  const made = useCallback((key: string, note: Note, text: string) => {
    setDraft((d) => d?.key === key ? { ...d, id: note.id } : d);
    patch(note, text);
  }, [patch]);
  /* Once the new note is made, the address names it (after the page knows it, so the editor stays as it is). */
  const draftId = draft?.id ?? null;
  useEffect(() => { if (draftId && openId === "new") goTo({ in: placeId, n: draftId }, true); }, [draftId, openId, placeId]);
  /* Away from it, the new note is a note like any other: opened again, it loads as one. */
  const wasOpen = useRef(openId);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = openId;
    if (!draftId && was !== "new") return;
    if (openId === "new" || (draftId && openId === draftId) || (was !== "new" && was !== draftId)) return;
    const soon = setTimeout(() => setDraft(null));
    return () => clearTimeout(soon);
  }, [draftId, openId]);
  /* The rail's New, and an old link to it. */
  const wantsNew = params.get("new") === "1";
  useEffect(() => {
    if (!wantsNew || !lib) return;
    const soon = setTimeout(() => startNew(undefined, true));
    return () => clearTimeout(soon);
  }, [wantsNew, lib, startNew]);

  const openSearch = useCallback(() => {
    setPlacesOpen(true); setPinned(true);
    requestAnimationFrame(() => { searchField.current?.focus(); searchField.current?.select(); });
  }, [setPinned]);
  /*
   * Keys: N (while not typing) or ⌘⌥N starts a note; / or ⌘K goes to search.
   * Listening as the key comes down, before the rail does, so ⌘K here is
   * Notes' search rather than the apps sheet. In the note, ⌘K is a link.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = isTyping(event.target);
      const inNote = event.target instanceof Element && Boolean(event.target.closest(".cm-editor"));
      const sheet = Boolean(document.querySelector(".nt-shade, .nt-menu, dialog[open]"));
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.altKey && event.code === "KeyN") { event.preventDefault(); startNew(); return; }
      if (sheet) return;
      if (!typing && !mod && !event.altKey && event.key.toLowerCase() === "n") { event.preventDefault(); startNew(); return; }
      if ((!typing && !mod && !event.altKey && event.key === "/") || (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k" && !inNote)) {
        event.preventDefault(); event.stopPropagation(); openSearch();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [startNew, openSearch]);

  /* The panel closes on its own: a click outside it, or Escape. */
  useEffect(() => {
    if (!placesOpen) return;
    const away = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest(".nt-side, .nt-placebutton, .nt-menu, .nt-shade, dialog[open]")) setPlacesOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(".nt-shade, .nt-menu, dialog[open]")) return;
      setPlacesOpen(false); placeButton.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", escape); };
  }, [placesOpen]);
  useEffect(() => { if (!placesOpen) setTimeout(() => setFind("")); }, [placesOpen]);

  const deleteNote = useCallback((note: Note) => {
    const before = lib;
    setLib((now) => now && { ...now, notes: now.notes.filter((n) => n.id !== note.id) });
    if (openId === note.id) goTo({ in: placeId });
    notes.remove(note.id).then(() => setToast({
      text: `Deleted ${note.title}.`,
      action: { label: "Undo", run: () => { void notes.restore(note.id).then(() => load(), () => setToast({ text: oops })); } },
    }), () => { setLib(before); setToast({ text: oops }); });
  }, [lib, openId, placeId, load]);

  const openNote = useCallback((id: string) => { setPlacesOpen(false); goTo({ in: placeId, n: id }); }, [placeId]);
  const openPlace = useCallback((id: string | null) => { setPlacesOpen(false); goTo({ in: id }); }, []);

  /* Moving between places carries the list in, as tabs do. */
  const listRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => { swap(listRef.current?.querySelector(".nt-list, .nt-empty") ?? null); }, [placeId]);

  const editing = openId === "new" ? draft : openId ? (draft?.id === openId ? draft : null) : null;
  const openMeta = openId && openId !== "new" ? lib?.notes.find((n) => n.id === openId) ?? null : null;
  const noteKey = editing ? editing.key : openId;
  const openNotebook = openMeta ? (openMeta.notebookId ? notebookOf(openMeta.notebookId) : null)
    : editing ? (editing.parent ? notebookHolding(editing.parent) : lib?.notebooks.find((n) => n.role !== "viewer" && !n.sharedWithYou) ?? null) : null;
  const showing = Boolean(openId);
  /*
   * With no note open the notebooks stand beside the list; on a note they
   * narrow to a rail of marks, and widen back in place from it (staying wide
   * until you narrow them again).
   */
  const wide = useWide(760);
  const docked = wide && (!showing || pinned);
  const railed = wide && showing && !pinned;
  const placeWritable = place.kind === "all" ? true : canWrite(place.notebook);

  return <div className={cx("nt", showing && "has-note", docked && "is-docked", railed && "is-railed", placesOpen && !wide && "is-placing")}>
    <section className="nt-listcol k-inkbar" aria-label="Notes" ref={listRef}>
      <ListHead place={place} faces={faces} people={people} open={placesOpen} docked={wide} buttonRef={placeButton} writable={placeWritable}
        onPlaces={() => setPlacesOpen((open) => !open)} onNew={() => startNew()} onShare={setSharing} />
      {lib === null && !problem ? <SkeletonRows rows={5} mark={false} /> : null}
      {problem && !lib ? <p className="nt-quiet">{problem} <button type="button" className="nt-textbutton" onClick={() => void load()}>Retry</button></p> : null}
      {lib && !listed.length
        ? <Empty seed={placeId ?? "all"} words={place.kind === "section" ? "Nothing here yet." : "Your notes will be here."} onNew={placeWritable ? () => startNew() : undefined} />
        : <NoteList notes={listed} lib={lib} current={openId === "new" ? draft?.id ?? null : openId} saving={saving} now={now} showCrest={place.kind === "all"}
            notebookOf={notebookOf} onOpen={openNote} onDelete={deleteNote} onMoved={(note) => patch(note)} onToast={setToast} onShare={setSharing} onLeave={setLeaving} />}
    </section>
    <section className="nt-notecol k-inkbar" aria-label="Note">
      {!showing ? <div className="nt-nothing"><Empty seed="open" words="Pick a note, or start one." onNew={placeWritable ? () => startNew() : undefined} /></div>
        : openId !== "new" && !editing && lib && !openMeta
          ? <div className="nt-page nt-gone"><Empty seed="gone" words="That note isn't here any more." /><Seal type="button" tone="quiet" onClick={() => goTo({ in: placeId })}>Back</Seal></div>
          : openMeta || editing ? <NotePage key={noteKey} me={me} people={people} accessKey={facesAsked} note={openMeta} draft={editing} notebook={openNotebook} lib={lib}
              readOnly={openMeta && !openMeta.notebookId ? null : !canWrite(openNotebook)} onBack={() => goTo({ in: placeId })} onSaving={savingNow} onPatch={patch} onMade={made} onGone={gone} onDelete={deleteNote}
              onToast={setToast} onOpen={openNote} onShare={setSharing} onLeave={setLeaving} />
            : <div className="nt-page"><SkeletonRows rows={3} mark={false} /></div>}
    </section>
    {railed ? <Rail lib={lib} place={place} open={placesOpen} buttonRef={placeButton} onOpen={() => setPinned(true)} onNew={() => startNew()} onSearch={openSearch} onPlace={openPlace} /> : null}
    <div className="nt-side-shade" aria-hidden="true" />
    <aside className="nt-side k-inkbar" aria-label="Notebooks" inert={!docked && !(placesOpen && !wide)}>
      <Panel lib={lib} problem={problem} place={place} find={find} onFind={setFind} found={found} faces={faces} people={people} arriving={arriving} now={now}
        searchRef={searchField} docked={docked} onNarrow={docked && showing ? () => { setPlacesOpen(false); setPinned(false); } : undefined} notebookOf={notebookOf} onNew={startNew} onPlace={openPlace} onReload={load} onToast={setToast} under={under}
        onShare={setSharing} onLeave={setLeaving} onOpenNote={openNote} current={openId} onClose={() => { setPlacesOpen(false); placeButton.current?.focus(); }} />
    </aside>
    {sharingThing ? <ShareSheet thing={sharingThing} me={me} people={people} publicLinks={publicLinks}
      owner={(sharingThing.kind === "notebook" ? lib?.notebooks.find((n) => n.id === sharingThing.id) : lib?.notes.find((n) => n.id === sharingThing.id))?.createdBy ?? me}
      onClose={(changed) => { const id = sharingThing.id; setSharing(null); if (changed) { setArriving(id); setTimeout(() => setArriving(null), 900); setFacesAsked((n) => n + 1); } }} /> : null}
    {leavingThing ? <LeaveSheet thing={leavingThing} me={me} onClose={() => setLeaving(null)} onToast={setToast}
      onLeft={() => { if (leavingThing.kind === "note" && openId === leavingThing.id) goTo({ in: placeId }); else if (leavingThing.kind === "notebook") openPlace(null); void load(); }} /> : null}
    {toast ? <div className="nt-snack" role="status">
      <span>{toast.text}</span>
      {toast.action ? <button type="button" className="nt-snack-act" onClick={() => { const run = toast.action!.run; setToast(null); run(); }}>{toast.action.label}</button> : null}
    </div> : null}
  </div>;
}

/* ── the notebooks panel ── */

const foldsKey = "kimono-notes:folded";
const panelKey = "kimono-notes:panel";
function readFolds(): Set<string> { try { return new Set(JSON.parse(window.localStorage.getItem(foldsKey) ?? "[]") as string[]); } catch { return new Set(); } }

/** A name being written where it sits: a new section, or a new name for a section or notebook. */
type Naming = { kind: "section" | "notebook"; parent: string; id: string | null; name: string };

/** A notebook's mark: its space's crest, washed in its colour and turned by the notebook's own id. */
function NotebookCrest({ notebook, size, className }: { notebook: Notebook; size: number; className?: string }) {
  return <InkCrest crest={notebook.space.crest} color={notebook.space.color} seed={notebook.id} size={size} className={className} />;
}

function Panel({ lib, problem, place, find, onFind, found, faces, people, arriving, now, searchRef, docked, onNarrow, notebookOf, onNew, onPlace, onReload, onToast, under, onShare, onLeave, onOpenNote, current, onClose }: {
  lib: Library | null; problem: string | null; place: Place; find: string; onFind: (words: string) => void; found: Note[];
  faces: Record<string, string[]>; people: Record<string, Person>; arriving: string | null; now: number;
  searchRef: React.RefObject<HTMLInputElement | null>; docked: boolean; onNarrow?: () => void; notebookOf: (id: string) => Notebook | null;
  onNew: (where?: string | null) => void; onPlace: (id: string | null) => void; onReload: () => Promise<void>; onToast: (toast: Toast) => void;
  under: (folder: string) => Set<string>; onShare: (thing: Shareable) => void; onLeave: (thing: Shareable) => void;
  onOpenNote: (id: string) => void; current: string | null; onClose: () => void;
}) {
  const [folds, setFolds] = useState<Set<string>>(() => typeof window === "undefined" ? new Set() : readFolds());
  const setFold = (id: string, folded: boolean) => setFolds((now) => {
    if (now.has(id) === folded) return now;
    const next = new Set(now); if (folded) next.add(id); else next.delete(id);
    try { window.localStorage.setItem(foldsKey, JSON.stringify([...next])); } catch { /* this page only */ }
    return next;
  });
  const [naming, setNaming] = useState<Naming | null>(null);
  const [making, setMaking] = useState(false);
  /* Enter and the field's blur both save it: once is enough. */
  const savingName = useRef(false);
  const saveName = async () => {
    const name = naming?.name.trim();
    const was = naming;
    setNaming(null);
    if (!was || !name || savingName.current) return;
    savingName.current = true;
    try {
      if (was.kind === "section" && was.id) await notes.renameSection(was.id, name);
      else if (was.kind === "section") { const made = await notes.createSection(name, was.parent); setFold(was.parent, false); await onReload(); onPlace(made.id); return; }
      else if (was.id) await notes.renameNotebook(was.id, name);
      await onReload();
    } catch { onToast({ text: oops }); } finally { savingName.current = false; }
  };
  const here = place.kind === "notebook" ? place.notebook.id : place.kind === "section" ? place.section.id : null;
  const count = (folder: string) => { const inside = under(folder); return (lib?.notes ?? []).filter((n) => inside.has(n.parentId)).length; };
  const deleted = (id: string, name: string, notebookId: string | null) => async (restorable: boolean) => {
    if (here && under(id).has(here)) onPlace(notebookId);
    await onReload();
    if (restorable) onToast({ text: `Deleted ${name}.`, action: { label: "Undo", run: () => { void notes.restore(id).then(onReload, () => onToast({ text: oops })); } } });
  };
  const newSection = (parent: string) => { setNaming({ kind: "section", parent, id: null, name: "" }); setFold(parent, false); };
  const tree = (parent: string, notebook: Notebook, depth: number): React.ReactNode => {
    const kids = (lib?.sections ?? []).filter((s) => s.parentId === parent);
    const adding = naming?.kind === "section" && !naming.id && naming.parent === parent;
    if (!kids.length && !adding) return null;
    return <div className="nt-tree">
      {kids.map((section) => <FolderRow key={section.id} kind="section" id={section.id} name={section.name} depth={depth} mark={<Icon name="section" />}
        here={here === section.id} count={count(section.id)} folded={folds.has(section.id)} onFold={(f) => setFold(section.id, f)}
        hasKids={(lib?.sections ?? []).some((s) => s.parentId === section.id)} writable={notebook.role !== "viewer"} canDelete
        naming={naming?.id === section.id ? naming.name : null} onNaming={(name) => setNaming({ kind: "section", parent: section.parentId, id: section.id, name })} onSaveName={() => void saveName()} onCancelName={() => setNaming(null)}
        onOpen={() => onPlace(section.id)} onNewNote={() => onNew(section.id)} onNewSection={() => newSection(section.id)}
        onDeleted={deleted(section.id, section.name, notebook.id)} onFailed={() => onToast({ text: oops })}>
        {folds.has(section.id) ? null : tree(section.id, notebook, depth + 1)}
      </FolderRow>)}
      {adding ? <NameField depth={depth} value={naming.name} label="Section name" onChange={(name) => setNaming({ ...naming, name })} onSave={() => void saveName()} onCancel={() => setNaming(null)} /> : null}
    </div>;
  };
  const own = (lib?.notebooks ?? []).filter((n) => !n.sharedWithYou);
  const shared = (lib?.notebooks ?? []).filter((n) => n.sharedWithYou);
  const sharedNotes = (lib?.notes ?? []).filter((n) => n.notebookId === null);
  const bookRow = (notebook: Notebook) => <FolderRow key={notebook.id} kind="notebook" id={notebook.id} name={notebook.name} depth={0} arriving={arriving === notebook.id}
        mark={<NotebookCrest notebook={notebook} size={20} />}
        faces={faces[notebook.id]?.length ? <Faces usernames={faces[notebook.id]} people={people} size={20} /> : null}
        here={here === notebook.id} count={count(notebook.id)} folded={folds.has(notebook.id)} onFold={(f) => setFold(notebook.id, f)}
        hasKids={(lib?.sections ?? []).some((s) => s.parentId === notebook.id) || (naming?.kind === "section" && !naming.id && naming.parent === notebook.id)}
        writable={notebook.role !== "viewer"} canShare={canShare(notebook) || notebook.sharedWithYou} canDelete={!notebook.isSpace && !notebook.sharedWithYou}
        onLeave={notebook.sharedWithYou ? () => onLeave(asShareable(notebook)) : undefined}
        naming={naming?.id === notebook.id ? naming.name : null} onNaming={(name) => setNaming({ kind: "notebook", parent: "", id: notebook.id, name })} onSaveName={() => void saveName()} onCancelName={() => setNaming(null)}
        onOpen={() => onPlace(notebook.id)} onNewNote={() => onNew(notebook.id)} onNewSection={() => newSection(notebook.id)} onShare={() => onShare(asShareable(notebook))}
        onDeleted={deleted(notebook.id, notebook.name, null)} onFailed={() => onToast({ text: oops })}>
        {folds.has(notebook.id) ? null : tree(notebook.id, notebook, 1)}
      </FolderRow>;
  const searching = Boolean(find.trim());
  const results = useRef<HTMLDivElement>(null);
  return <>
    <div className="nt-side-head">
      <span>Notes</span>
      {onNarrow ? <button type="button" className="nt-iconbutton" onClick={onNarrow} aria-label="Narrow the notebooks" title="Narrow"><Icon name="panel" /></button>
        : docked ? null : <button type="button" className="nt-iconbutton" onClick={onClose} aria-label="Close notebooks" title="Close"><Icon name="panel" /></button>}
    </div>
    <button type="button" className="nt-newnote" onClick={() => onNew()} aria-keyshortcuts="n"><Icon name="pencil" />New note<kbd>N</kbd></button>
    <label className="nt-search"><Icon name="search" /><input ref={searchRef} type="search" value={find} placeholder="Search" aria-label="Search notes"
      onChange={(event) => onFind(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && find) { event.preventDefault(); event.stopPropagation(); onFind(""); }
        else if (event.key === "Enter" && found[0]) { event.preventDefault(); onOpenNote(found[0].id); }
        else if (event.key === "ArrowDown") { event.preventDefault(); results.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
      }} />{searching ? null : <kbd className="nt-key">/</kbd>}</label>
    {searching ? <div className="nt-found-notes" ref={results} role="list" aria-label="Notes found" onKeyDown={(event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const all = [...(results.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      const at = all.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowUp" && at <= 0) searchRef.current?.focus(); else all[Math.min(all.length - 1, at + (event.key === "ArrowDown" ? 1 : -1))]?.focus();
    }}>
      {found.map((note) => { const notebook = note.notebookId ? notebookOf(note.notebookId) : null; return <button key={note.id} type="button" role="listitem" className="nt-hit" aria-current={current === note.id ? "page" : undefined} onClick={() => onOpenNote(note.id)}>
        <span className="nt-row-text"><b>{note.title}</b>{note.excerpt ? <small>{note.excerpt}</small> : null}</span>
        <span className="nt-row-side">{notebook ? <NotebookCrest notebook={notebook} size={14} /> : null}<span className="nt-when">{when(note.updatedAt, now)}</span></span>
      </button>; })}
      {!found.length ? <p className="nt-quiet">No notes match.</p> : null}
    </div> : <nav className="nt-places" aria-label="Notebooks">
      <div className="nt-place-row">
        <button type="button" className="nt-place" aria-current={place.kind === "all" ? "page" : undefined} onClick={() => onPlace(null)}>
          <span className="nt-place-mark"><Icon name="book" /></span><span className="nt-place-name">All notes</span>
        </button>
      </div>
      {problem ? <p className="nt-quiet">{problem} <button type="button" className="nt-textbutton" onClick={() => void onReload()}>Retry</button></p> : null}
      {lib === null && !problem ? <SkeletonRows rows={2} mark={false} /> : null}
      {own.map(bookRow)}
      {lib ? <div className="nt-place-row"><button type="button" className="nt-place nt-place-new" onClick={() => setMaking(true)}>
        <span className="nt-place-mark"><Icon name="plus" /></span><span className="nt-place-name">New notebook</span>
      </button></div> : null}
      {shared.length || sharedNotes.length ? <div className="nt-side-label">Shared with you</div> : null}
      {shared.map(bookRow)}
      {sharedNotes.map((note) => <div key={note.id} className="nt-place-row">
        <button type="button" className="nt-place" aria-current={current === note.id ? "page" : undefined} onClick={() => onOpenNote(note.id)}>
          <span className="nt-place-mark"><Icon name="note" /></span><span className="nt-place-name">{note.title}</span>
          {faces[note.id]?.length ? <Faces usernames={faces[note.id]} people={people} size={20} /> : null}
        </button>
        <span className="nt-acts"><RowMenu label={`More for ${note.title}`} items={[{ icon: "door", label: "Leave", run: () => onLeave({ kind: "note", id: note.id, name: note.title }) }]} /></span>
      </div>)}
    </nav>}
    {making ? <NewNotebookSheet onClose={() => setMaking(false)} onMade={async (id) => { setMaking(false); await onReload(); onPlace(id); }} /> : null}
  </>;
}

/** The notebooks panel narrowed while a note is open: open it in full, a new note, search, and each notebook by its crest. */
function Rail({ lib, place, open, buttonRef, onOpen, onNew, onSearch, onPlace }: {
  lib: Library | null; place: Place; open: boolean; buttonRef: React.RefObject<HTMLButtonElement | null>;
  onOpen: () => void; onNew: () => void; onSearch: () => void; onPlace: (id: string | null) => void;
}) {
  const here = place.kind === "notebook" ? place.notebook.id : place.kind === "section" ? place.notebook.id : null;
  return <nav className="nt-rail k-inkbar" aria-label="Notebooks">
    <button ref={buttonRef} type="button" className="nt-iconbutton nt-placebutton" onClick={onOpen} aria-expanded={open} aria-label="Show notebooks" title="Show notebooks"><Icon name="panel" /></button>
    <button type="button" className="nt-rail-new" onClick={onNew} aria-label="New note" title="New note  N"><Icon name="pencil" /></button>
    <button type="button" className="nt-iconbutton" onClick={onSearch} aria-label="Search notes" title="Search  /"><Icon name="search" /></button>
    <span className="nt-rail-rule" aria-hidden="true" />
    <button type="button" className="nt-rail-place" aria-current={place.kind === "all" ? "page" : undefined} onClick={() => onPlace(null)} aria-label="All notes" title="All notes"><Icon name="book" /></button>
    {(lib?.notebooks ?? []).map((notebook) => <button key={notebook.id} type="button" className="nt-rail-place" aria-current={here === notebook.id ? "page" : undefined}
      onClick={() => onPlace(notebook.id)} aria-label={notebook.name} title={notebook.name}><NotebookCrest notebook={notebook} size={22} /></button>)}
  </nav>;
}

function NameField({ value, label, depth, onChange, onSave, onCancel }: { value: string; label: string; depth: number; onChange: (name: string) => void; onSave: () => void; onCancel: () => void }) {
  return <form className="nt-name" style={{ "--d": depth } as React.CSSProperties} onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <input autoFocus value={value} maxLength={80} placeholder={label} aria-label={label} onFocus={(event) => event.target.select()}
      onChange={(event) => onChange(event.target.value)} onBlur={onSave} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); } }} />
  </form>;
}

/**
 * A notebook or a section in the panel: opens it. Its + makes a note there;
 * its ··· holds New note, New section, Rename, Share, and Delete or Leave.
 */
function FolderRow({ kind, id, name, depth, mark, faces, arriving, here, count, folded, hasKids, writable, canShare, canDelete, onFold, naming, onNaming, onSaveName, onCancelName, onOpen, onNewNote, onNewSection, onShare, onLeave, onDeleted, onFailed, children }: {
  kind: "notebook" | "section"; id: string; name: string; depth: number; mark: React.ReactNode; faces?: React.ReactNode; arriving?: boolean;
  here: boolean; count: number; folded: boolean; hasKids: boolean; writable: boolean; canShare?: boolean; canDelete: boolean; onFold: (folded: boolean) => void;
  naming: string | null; onNaming: (name: string) => void; onSaveName: () => void; onCancelName: () => void;
  onOpen: () => void; onNewNote: () => void; onNewSection: () => void; onShare?: () => void; onLeave?: () => void;
  onDeleted: (restorable: boolean) => Promise<void>; onFailed: () => void; children: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = () => {
    setBusy(true);
    (kind === "notebook" ? notes.removeNotebook(id) : notes.removeSection(id)).then(() => onDeleted(count === 0), onFailed).finally(() => { setBusy(false); setConfirming(false); });
  };
  const items: MenuItem[] = [
    ...(writable ? [{ icon: "pencil" as const, label: "New note", run: onNewNote }, { icon: "section" as const, label: "New section", run: onNewSection }, { icon: "rename" as const, label: "Rename", run: () => onNaming(name) }] : []),
    ...(canShare && onShare ? [{ icon: "people" as const, label: "Share", run: onShare }] : []),
    ...(onLeave ? [{ icon: "door" as const, label: "Leave", run: onLeave }] : []),
    ...(writable && canDelete ? [{ icon: "trash" as const, label: "Delete", danger: true, run: () => { if (count) setConfirming(true); else remove(); } }] : []),
  ];
  return <div className={cx(kind === "notebook" ? "nt-notebook" : "nt-section", busy && "is-busy", arriving && "is-arriving")}>
    {naming !== null
      ? <NameField depth={depth} value={naming} label={kind === "notebook" ? "Notebook name" : "Section name"} onChange={onNaming} onSave={onSaveName} onCancel={onCancelName} />
      : <div className="nt-place-row" style={{ "--d": depth } as React.CSSProperties}>
          {hasKids ? <button type="button" className={cx("nt-chev", !folded && "is-open")} aria-expanded={!folded} aria-label={folded ? `Show ${name}` : `Fold ${name}`} onClick={() => onFold(!folded)}><Icon name="chevron" /></button> : null}
          <button type="button" className={cx("nt-place", kind === "section" && "is-sub")} aria-current={here ? "page" : undefined} onClick={onOpen}>
            <span className="nt-place-mark">{mark}</span><span className="nt-place-name">{name}</span>{faces}
          </button>
          {!confirming && items.length ? <span className="nt-acts">
            {writable ? <button type="button" className="nt-act" aria-label={`New note in ${name}`} title={`New note in ${name}`} onClick={onNewNote}><Icon name="plus" /></button> : null}
            <RowMenu label={`More for ${name}`} items={items} />
          </span> : null}
        </div>}
    {confirming ? <div className="nt-confirm" role="alertdialog" aria-label={`Delete ${name}?`}>
      <span>Delete {name} and its {count === 1 ? "note" : `${count} notes`}?</span>
      <span className="nt-confirm-acts">
        <button type="button" className="nt-quietbutton is-danger" autoFocus onClick={remove}>Delete</button>
        <button type="button" className="nt-quietbutton" onClick={() => setConfirming(false)}>Keep</button>
      </span>
    </div> : null}
    {children}
  </div>;
}

/** Who shared it, or who it's shared with: a portrait each, the initial on the primary container when there's no picture. */
function Faces({ usernames, people, size, most = 2 }: { usernames: string[]; people: Record<string, Person>; size: number; most?: number }) {
  return <span className={cx("nt-faces", size < 30 && "is-small")} style={{ "--s": `${size}px` } as React.CSSProperties}>
    {usernames.slice(0, most).map((u) => {
      const face = <Face name={people[u.toLowerCase()]?.name} username={u} picture={people[u.toLowerCase()]?.picture} size={size < 30 ? size : Math.round(size * .82)} />;
      return <span key={u} className="nt-face">{size < 30 ? face : <InkPortraitFrame seed={u} weight={4}>{face}</InkPortraitFrame>}</span>;
    })}
  </span>;
}

/* ── a ··· menu, drawn over everything so a scrolling list doesn't cut it off ── */

type MenuItem = { icon: IconName; label: string; danger?: boolean; run: () => void };

function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setAt(null); };
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape") { setAt(null); root.current?.querySelector("button")?.focus(); } };
    const close = () => setAt(null);
    const scrolled = (event: Event) => { if (event.target instanceof Node && event.target.contains(root.current)) setAt(null); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", scrolled, true);
    menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus({ preventScroll: true });
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); window.removeEventListener("resize", close); document.removeEventListener("scroll", scrolled, true); };
  }, [at]);
  const open = (button: HTMLButtonElement) => {
    const box = button.getBoundingClientRect();
    const tall = items.length * 46 + 8;
    const below = box.bottom + 4 + tall < window.innerHeight;
    setAt({ top: below ? box.bottom + 4 : box.top - 4 - tall, right: document.documentElement.clientWidth - box.right });
  };
  const step = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const all = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const now = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(now + (event.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus({ preventScroll: true });
  };
  return <span ref={root} className={cx("nt-more", at && "is-open")}>
    <button type="button" aria-label={label} title="More" aria-haspopup="menu" aria-expanded={Boolean(at)}
      onClick={(event) => { event.stopPropagation(); if (at) setAt(null); else open(event.currentTarget); }}><Icon name="more" /></button>
    {at ? createPortal(<div ref={menu} className="nt-menu" role="menu" aria-label={label} style={{ top: at.top, right: at.right }} onKeyDown={step}>
      {items.map((item) => <button key={item.label} type="button" role="menuitem" className={cx(item.danger && "is-danger")}
        onClick={(event) => { event.stopPropagation(); setAt(null); item.run(); }}><Icon name={item.icon} />{item.label}</button>)}
    </div>, document.body) : null}
  </span>;
}


/* ── the note list ── */

/** The list's header: the place you're in, who it's shared with, and +; while the notebooks are folded away, the button that brings them. */
function ListHead({ place, faces, people, open, docked, buttonRef, writable, onPlaces, onNew, onShare }: {
  place: Place; faces: Record<string, string[]>; people: Record<string, Person>; open: boolean; docked: boolean; buttonRef: React.RefObject<HTMLButtonElement | null>; writable: boolean;
  onPlaces: () => void; onNew: () => void; onShare: (thing: Shareable) => void;
}) {
  const notebook = place.kind === "all" ? null : place.notebook;
  const name = place.kind === "all" ? "All notes" : place.kind === "section" ? place.section.name : place.notebook.name;
  const above = place.kind === "section" ? place.notebook.name : notebook && !notebook.isSpace && notebook.space.name && notebook.space.name !== notebook.name ? notebook.space.name : null;
  return <header className="nt-listhead">
    {docked ? null : <button ref={buttonRef} type="button" className="nt-iconbutton nt-placebutton" onClick={onPlaces} aria-expanded={open} aria-label="Notebooks" title="Notebooks"><Icon name="panel" /></button>}
    <div className="nt-listhead-id">
      {above ? <small className="nt-crumb">{above}</small> : null}
      <h1 className="nt-placename"><span>{name}</span></h1>
    </div>
    {notebook && faces[notebook.id]?.length ? <Faces usernames={faces[notebook.id]} people={people} size={20} /> : null}
    {notebook && (canShare(notebook) || notebook.sharedWithYou) ? <button type="button" className="nt-iconbutton" onClick={() => onShare(asShareable(notebook))} aria-label={`Share ${notebook.name}`} title="Share"><Icon name="people" /></button> : null}
    {writable ? <button type="button" className="nt-plus" onClick={onNew} aria-label="New note" title={`New note  N`}><Icon name="plus" /></button> : null}
  </header>;
}

/** Leaving something shared with you: held to confirm, since only someone who can edit it can bring you back. */
function LeaveSheet({ thing, me, onClose, onLeft, onToast }: { thing: Shareable; me: string; onClose: () => void; onLeft: () => void; onToast: (toast: Toast) => void }) {
  return <Sheet title={`Leave ${thing.name}?`} lead="You'll need to be asked back." onClose={onClose}
    footer={<form className="nt-leave" onSubmit={(event) => {
      event.preventDefault();
      notes.share(thing, me, null).then(() => { onClose(); onLeft(); }, () => { onClose(); onToast({ text: oops }); });
    }}>
      <Seal type="button" tone="quiet" onClick={onClose}>Stay</Seal>
      <HoldSeal label="Leave" />
    </form>} />;
}

function NoteList({ notes: list, lib, current, saving, now, showCrest, notebookOf, onOpen, onDelete, onMoved, onToast, onShare, onLeave }: {
  notes: Note[]; lib: Library | null; current: string | null; saving: Set<string>; now: number; showCrest: boolean;
  notebookOf: (id: string) => Notebook | null; onOpen: (id: string) => void; onDelete: (note: Note) => void; onMoved: (note: Note) => void;
  onToast: (toast: Toast) => void; onShare: (thing: Shareable) => void; onLeave: (thing: Shareable) => void;
}) {
  /* Only notes made after the list came rise into place. */
  const [since] = useState(() => Date.now());
  const [moving, setMoving] = useState<Note | null>(null);
  return <>
    <nav className="nt-list">
      {list.map((note) => {
        const notebook = note.notebookId ? notebookOf(note.notebookId) : null;
        return <NoteRow key={note.id} note={note} notebook={notebook} current={current === note.id} saving={saving.has(note.id)} now={now} showCrest={showCrest} fresh={note.createdAt > since}
          onOpen={() => onOpen(note.id)} onDelete={() => onDelete(note)} onMove={() => setMoving(note)}
          onShare={() => onShare({ kind: "note", id: note.id, name: note.title })} onLeave={() => onLeave({ kind: "note", id: note.id, name: note.title })} />;
      })}
    </nav>
    {moving && lib ? <MoveSheet note={moving} lib={lib} onClose={() => setMoving(null)}
      onMove={async (parent) => { try { onMoved(await notes.move(moving.id, parent)); setMoving(null); } catch { onToast({ text: oops }); } }} /> : null}
  </>;
}

function NoteRow({ note, notebook, current, saving, now, showCrest, fresh, onOpen, onDelete, onMove, onShare, onLeave }: {
  note: Note; notebook: Notebook | null; current: boolean; saving: boolean; now: number; showCrest: boolean; fresh: boolean;
  onOpen: () => void; onDelete: () => void; onMove: () => void; onShare: () => void; onLeave: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  /* A new row rises 12px into place. */
  const rose = useRef(false);
  useLayoutEffect(() => {
    if (!fresh || rose.current || still() || !row.current) return;
    rose.current = true;
    row.current.animate([{ opacity: 0, translate: "0 12px" }, { opacity: 1, translate: "0 0" }], { duration: 380, easing: "cubic-bezier(.34, 1.36, .64, 1)", fill: "backwards" });
  }, [fresh]);
  /* A note shared with you on its own has no notebook here: it can be shared on, or left. */
  const writable = Boolean(notebook && notebook.role !== "viewer");
  return <div ref={row} className="nt-row">
    <button type="button" className="nt-row-open" aria-current={current ? "page" : undefined} onClick={onOpen}>
      <span className="nt-row-text"><b>{note.title}</b>{note.excerpt ? <small>{note.excerpt}</small> : null}</span>
      <span className="nt-row-side">
        {showCrest && notebook ? <NotebookCrest notebook={notebook} size={14} /> : null}
        {saving ? <InkLoader className="nt-saving" label="Saving" /> : <span className="nt-when">{when(note.updatedAt, now)}</span>}
      </span>
    </button>
    <RowMenu label={`More for ${note.title}`} items={[
      { icon: "people", label: "Share", run: onShare },
      ...(writable ? [{ icon: "move" as const, label: "Move", run: onMove }, { icon: "trash" as const, label: "Delete", danger: true, run: onDelete }] : []),
      ...(notebook ? [] : [{ icon: "door" as const, label: "Leave", run: onLeave }]),
    ]} />
  </div>;
}

/* ── sheets ── */

function Sheet({ title, lead, children, footer, onClose }: { title: string; lead?: string; children?: React.ReactNode; footer: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  const opened = useCallback((element: HTMLDivElement | null) => {
    if (element && !element.contains(document.activeElement)) (element.querySelector<HTMLElement>("[autofocus], input") ?? element).focus();
  }, []);
  return createPortal(<div className="nt-shade" onClick={onClose}>
    <div className="nt-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={opened} onClick={(event) => event.stopPropagation()}>
      <header><h2>{title}</h2>{lead ? <p>{lead}</p> : null}</header>
      {children ? <div className="nt-sheet-body">{children}</div> : null}
      <footer>{footer}</footer>
    </div>
  </div>, document.body);
}

/** A new notebook: its name, and which space it goes in when there is more than one to choose. */
function NewNotebookSheet({ onClose, onMade }: { onClose: () => void; onMade: (id: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [spaces, setSpaces] = useState<{ id: string; name: string }[]>([]);
  const [space, setSpace] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { notes.spaces().then(setSpaces, () => {}); }, []);
  const make = async () => {
    if (!name.trim()) return;
    setBusy(true); setProblem(null);
    try { await onMade((await notes.createNotebook(name.trim(), space || undefined)).id); } catch { setBusy(false); setProblem(oops); }
  };
  return <Sheet title="New notebook" onClose={onClose} footer={<>
    {problem ? <span className="nt-problem" role="alert">{problem}</span> : null}
    <span className="nt-grow" />
    <Seal type="button" tone="quiet" onClick={onClose}>Cancel</Seal>
    <Seal type="button" busy={busy} disabled={!name.trim()} onClick={() => void make()}>Make</Seal>
  </>}>
    <form className="nt-newbook" onSubmit={(event) => { event.preventDefault(); void make(); }}>
      <label className="k-field"><span>Name</span><input autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
      {spaces.length > 1 ? <div className="k-field"><span>In</span>
        <Choice aria-label="Space" value={space} onChange={setSpace} options={[{ value: "", label: "Your own" }, ...spaces.map((s) => ({ value: s.id, label: s.name }))]} />
      </div> : null}
    </form>
  </Sheet>;
}

/** Who may share a notebook: anyone who may edit it. One that is a whole space is shared by adding people to the space instead. */
const canShare = (notebook: Notebook) => notebook.role !== "viewer" && !notebook.isSpace;
const asShareable = (notebook: Notebook): Shareable => ({ kind: "notebook", id: notebook.id, name: notebook.name });
/** "Mina", "Mina and Ren", "Mina, Ren and Aki". */
const listed = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * Sharing a notebook or a note, as a chat is shared: find people to add, who
 * has it (its owner first), each able to view or edit, taken off with ×; then
 * general access, its public link. Every change applies as it is made. A
 * viewer sees who has it, and nothing to change.
 */
function ShareSheet({ thing, me, owner, people, publicLinks, onClose }: { thing: Shareable; me: string; owner: string; people: Record<string, Person>; publicLinks: boolean; onClose: (changed: boolean) => void }) {
  const [info, setInfo] = useState<Sharing | null>(null);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [changed, setChanged] = useState(false);
  const { copied, copy } = useCopy();
  const box = useRef<HTMLDialogElement>(null);
  useEffect(() => { box.current?.showModal(); }, []);
  useEffect(() => { notes.sharing(thing).then(setInfo, () => setProblem(oops)); }, [thing]);
  const nameOf = (username: string) => people[username.toLowerCase()]?.name ?? username;
  const editing = info?.role === "owner" || info?.role === "editor";
  const working = (key: string, on: boolean) => setBusy((now) => { const next = new Set(now); if (on) next.add(key); else next.delete(key); return next; });
  const change = async (username: string, role: "editor" | "viewer" | null) => {
    setProblem(null); working(username, true);
    if (role && info) setInfo({ ...info, shares: info.shares.map((x) => x.username === username ? { ...x, role } : x) });
    try {
      const next = await notes.share(thing, username, role);
      if (!("left" in next)) setInfo(next);
      setChanged(true);
    } catch (error) { setProblem(error instanceof Error && /account|already/.test(error.message) ? error.message : oops); void notes.sharing(thing).then(setInfo, () => {}); }
    finally { working(username, false); }
  };
  const link = async (on: boolean) => {
    setProblem(null); working("link", true);
    try { const url = await notes.link(thing, on); setInfo((now) => now && { ...now, link: url }); } catch { setProblem(oops); }
    finally { working("link", false); }
  };
  const ownerKey = owner.toLowerCase();
  const taken = new Set([me.toLowerCase(), ownerKey, ...(info?.shares ?? []).map((x) => x.username.toLowerCase())]);
  const words = find.trim().toLowerCase().replace(/^@/, "");
  const found = words ? Object.values(people).filter((p) => !taken.has(p.username.toLowerCase()) && (p.name.toLowerCase().includes(words) || p.username.toLowerCase().includes(words))).slice(0, 6) : [];
  const pick = (p: Person) => { setFind(""); void change(p.username, "editor"); };
  /* Who has it through its notebook, else who sees it in its space. */
  const vias = new Map<string, string[]>();
  for (const x of info?.inherited ?? []) vias.set(x.via.name, [...(vias.get(x.via.name) ?? []), nameOf(x.username)]);
  const note = vias.size ? [...vias].map(([via, names]) => `${listed(names)} ${names.length === 1 ? "has" : "have"} it through ${via}.`).join(" ")
    : info && info.space.members > 1 && info.space.name ? `Everyone in ${info.space.name} can see this.` : null;
  const general = info?.link ? "read" : "off";
  /* With no public link, the address still opens it for the people it's shared with. */
  const url = info?.link ?? `${window.location.origin}/notes?${thing.kind === "notebook" ? `in=${thing.id}` : `n=${thing.id}`}`;
  const others = (info?.shares ?? []).filter((m) => m.username.toLowerCase() !== ownerKey);
  return createPortal(<dialog ref={box} className="nt-share" aria-labelledby="nt-share-title" onClose={() => onClose(changed)} onClick={(event) => { if (event.target === box.current) box.current?.close(); }}>
    <header><h2 id="nt-share-title">Share &ldquo;{thing.name}&rdquo;</h2></header>
    <div className="nt-share-body">
      {info === null && !problem ? <SkeletonRows rows={2} mark={false} /> : null}
      {info && editing ? <div className="nt-share-find">
        <label className="nt-share-search"><Icon name="search" /><input autoFocus value={find} onChange={(event) => setFind(event.target.value)} placeholder="Add people" aria-label="Add people"
          onKeyDown={(event) => { if (event.key === "Enter" && found[0]) { event.preventDefault(); pick(found[0]); } }} /></label>
        {words ? <div className="nt-share-found" role="listbox" aria-label="People">
          {found.map((p) => <button key={p.username} type="button" role="option" aria-selected={false} onClick={() => pick(p)}>
            <Faces usernames={[p.username]} people={people} size={32} /><span><b>{p.name}</b><small>@{p.username}</small></span>
          </button>)}
          {!found.length ? <p className="nt-quiet">No one by that name.</p> : null}
        </div> : null}
      </div> : null}
      {info ? <ul className="nt-share-people">
        <li className="nt-share-person">
          <Faces usernames={[owner]} people={people} size={36} />
          <span className="nt-share-who"><b>{nameOf(owner)}{ownerKey === me.toLowerCase() ? " (you)" : ""}</b><small>Owner</small></span>
        </li>
        {others.map((m) => <li key={m.username} className="nt-share-person">
          <Faces usernames={[m.username]} people={people} size={36} />
          <span className="nt-share-who"><b>{nameOf(m.username)}{m.username.toLowerCase() === me.toLowerCase() ? " (you)" : ""}</b><small>{editing ? `@${m.username}` : m.role === "editor" ? "Can edit" : "Can view"}</small></span>
          {editing && m.username.toLowerCase() !== me.toLowerCase() ? <>
            <Choice compact aria-label={`What ${nameOf(m.username)} can do`} className="nt-share-can" value={m.role} disabled={busy.has(m.username)}
              options={[{ value: "viewer", label: "Can view" }, { value: "editor", label: "Can edit" }]}
              onChange={(next) => void change(m.username, next as "editor" | "viewer")} />
            <button type="button" className="nt-roundbutton" aria-label={`Remove ${nameOf(m.username)}`} title="Remove" disabled={busy.has(m.username)} onClick={() => void change(m.username, null)}><Icon name="close" /></button>
          </> : null}
        </li>)}
      </ul> : null}
      {note ? <p className="nt-share-note">{note}</p> : null}
      {info && editing && (publicLinks || info.link) ? <>
        <h3 className="nt-share-sub">General access</h3>
        <div className="nt-share-general">
          <InkBlot className={cx("nt-share-mark", general !== "off" && "is-open")} tint={general === "off" ? tint.quiet : "#a84d63"} seed="share"><Icon name={general === "off" ? "lock" : "link"} /></InkBlot>
          <Choice aria-label="General access" className="nt-share-link" value={general} disabled={busy.has("link")}
            options={[{ value: "off", label: "Only people invited" }, ...(publicLinks || info.link ? [{ value: "read", label: "Anyone with the link can view" }] : [])]}
            onChange={(next) => void link(next === "read")} />
        </div>
      </> : null}
    </div>
    <footer>
      {problem ? <span className="nt-problem" role="alert">{problem}</span> : null}
      <Seal type="button" compact tone="quiet" disabled={!info} onClick={() => copy(url)}><Icon name={copied ? "tick" : "link"} />{copied ? "Copied" : "Copy link"}</Seal>
      <span className="nt-grow" />
      <Seal type="button" compact onClick={() => box.current?.close()}>Done</Seal>
    </footer>
  </dialog>, document.body);
}

/** Copies a link, saying so on the button for a moment. */
function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (url: string) => { void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }, () => {}); };
  return { copied, copy };
}

/** Moves a note to another notebook or section in the same space. */
function MoveSheet({ note, lib, onClose, onMove }: { note: Note; lib: Library; onClose: () => void; onMove: (parent: string) => Promise<void> }) {
  const home = lib.notebooks.find((n) => n.id === note.notebookId);
  const [busy, setBusy] = useState<string | null>(null);
  if (!home) return null;
  const rows: { id: string; name: string; depth: number; notebook: Notebook }[] = [];
  const walk = (parent: string, depth: number, notebook: Notebook) => { for (const s of lib.sections.filter((x) => x.parentId === parent)) { rows.push({ id: s.id, name: s.name, depth, notebook }); walk(s.id, depth + 1, notebook); } };
  for (const notebook of lib.notebooks.filter((n) => n.space.id === home.space.id && n.role !== "viewer")) { rows.push({ id: notebook.id, name: notebook.name, depth: 0, notebook }); walk(notebook.id, 1, notebook); }
  return <Sheet title={`Move ${note.title}`} onClose={onClose} footer={<Seal type="button" tone="quiet" onClick={onClose}>Cancel</Seal>}>
    <div className="nt-moves">
      {rows.map((row) => <button key={row.id} type="button" className="nt-place" style={{ "--depth": row.depth } as React.CSSProperties} disabled={row.id === note.parentId || Boolean(busy)}
        aria-current={row.id === note.parentId ? "true" : undefined} onClick={() => { setBusy(row.id); void onMove(row.id).finally(() => setBusy(null)); }}>
        {row.depth ? <span className="nt-place-mark"><Icon name="section" /></span> : <NotebookCrest notebook={row.notebook} size={24} className="nt-place-mark" />}
        <span className="nt-place-name">{row.name}</span>
        {busy === row.id ? <InkLoader className="nt-saving" label="Moving" /> : null}
      </button>)}
    </div>
  </Sheet>;
}


/* ── a note ── */

type Status = "idle" | "saving" | "failed";
const blank = (title: string, text: string) => !text.trim() && (!title.trim() || title.trim() === "Untitled");

function NotePage({ me, people, accessKey, note, draft, notebook, lib, readOnly: given, onBack, onSaving, onPatch, onMade, onGone, onDelete, onToast, onOpen, onShare, onLeave }: {
  me: string; people: Record<string, Person>; accessKey: number; note: Note | null; draft: Draft | null; notebook: Notebook | null; lib: Library | null;
  /** Null for a note shared with you on its own: what you may do with it is asked for. */
  readOnly: boolean | null;
  onBack: () => void; onSaving: (id: string, on: boolean) => void; onPatch: (note: Partial<Note> & { id: string }, text?: string) => void;
  onMade: (key: string, note: Note, text: string) => void; onGone: (id: string) => void;
  onDelete: (note: Note) => void; onToast: (toast: Toast) => void; onOpen: (id: string) => void;
  onShare: (thing: Shareable) => void; onLeave: (thing: Shareable) => void;
}) {
  const [asked, setAsked] = useState<boolean | null>(null);
  const askFor = given === null ? note?.id ?? null : null;
  useEffect(() => { if (askFor) notes.sharing({ kind: "note", id: askFor }).then((r) => setAsked(r.role === "viewer" || r.role === null), () => setAsked(true)); }, [askFor]);
  const readOnly = given ?? asked ?? true;
  const [text, setText] = useState<string | null>(draft ? "" : null);
  const [title, setTitle] = useState(draft ? "" : note?.title ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [moving, setMoving] = useState(false);
  const [formats, setFormats] = useState<Formats | null>(null);
  const body = useRef<BodyHandle | null>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const live = useRef({ live: false, sending: false, cursorWaiting: false, cursor: null as null | { anchor: number; head: number }, cursorTimer: 0, sendTimer: 0, text: "", version: note?.version ?? 0, title: draft ? "" : note?.title ?? "", dirty: false, flying: false, again: false, timer: 0, retry: 0, typed: draft ? "" : note?.title ?? "", loaded: Boolean(draft), mine: draft ? true : note?.createdBy.toLowerCase() === me.toLowerCase(), readOnly });
  useEffect(() => { live.current.readOnly = readOnly; }, [readOnly]);
  const id = useRef<string | null>(note?.id ?? draft?.id ?? null);
  const creating = useRef<Promise<string> | null>(null);
  const draftKey = draft?.key ?? null, parent = draft?.parent ?? null;
  /* Writing together (lib/notes/live.ts): this page's name there, where it started, and who else is here. */
  const [clientID] = useState(() => (crypto.randomUUID?.() ?? `${Math.random()}${Date.now()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 24));
  const joined = useRef<{ version: number; text: string } | null>(null);
  const [liveOn, setLiveOn] = useState(false);
  const [here, setHere] = useState<Cursor[]>([]);
  const goLive = useCallback((start: { version: number; text: string }) => {
    joined.current = start;
    const s = live.current;
    s.live = true; window.clearTimeout(s.timer); s.dirty = false;
    if (body.current) { body.current.goLive(start.version, clientID, start.text); setLiveOn(true); }
  }, [clientID]);
  /* The body comes after the text: it starts writing together as soon as it's there. */
  const ready = useCallback((handle: BodyHandle | null) => {
    body.current = handle;
    if (handle && joined.current) { handle.goLive(joined.current.version, clientID, joined.current.text); setLiveOn(true); }
  }, [clientID]);
  /* A new note is made by the first save that has something in it: a title or words. */
  const create = useCallback((words: string) => {
    if (!creating.current) {
      const s = live.current;
      const named = titleField.current?.value.trim() || undefined;
      creating.current = notes.create(parent, named, words).then((made) => {
        id.current = made.id; s.version = made.version; s.title = made.title;
        if (draftKey) onMade(draftKey, made, words);
        /* Made: from here on it's written together like any other note. */
        s.live = true; window.clearTimeout(s.timer); s.dirty = false;
        notes.join(made.id).then(goLive, () => {});
        return made.id;
      }, (error) => { creating.current = null; throw error; });
    }
    return creating.current;
  }, [parent, draftKey, onMade, goLive]);
  const firstId = note?.id ?? null;

  useEffect(() => {
    if (draft || !firstId) { titleField.current?.focus(); return; }
    let gone = false;
    notes.join(firstId).then((start) => {
      if (gone) return;
      live.current.text = start.text; live.current.loaded = true;
      if (note) { live.current.title = note.title; live.current.typed = note.title; }
      joined.current = start; live.current.live = true;
      setHere(start.cursors);
      setText(start.text);
    }, () => { if (!gone) { setText(""); onToast({ text: oops }); } });
    return () => { gone = true; };
    // Opened once, when the page is made for this note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async function run(keepalive = false): Promise<void> {
    const s = live.current;
    window.clearTimeout(s.timer); window.clearTimeout(s.retry);
    if (!s.dirty) return;
    if (s.flying) { s.again = true; return; }
    const sent = s.text;
    /* A new note with nothing in it yet isn't saved at all. */
    if (!id.current && !creating.current && blank(titleField.current?.value ?? "", sent)) { s.dirty = false; return; }
    s.flying = true; s.dirty = false;
    setStatus("saving");
    let noteId: string | null = null;
    try {
      if (!id.current) {
        const starting = !creating.current;
        noteId = await create(sent);
        /* The note was made with these very words, or it is written together now: nothing more to send this way. */
        if (starting || s.live) { setStatus("idle"); return; }
      } else noteId = id.current;
      if (s.live) { setStatus("idle"); return; }
      onSaving(noteId, true);
      const { note: saved, conflict } = await notes.save(noteId, sent, s.version, keepalive);
      if (conflict) {
        /* Someone saved first: theirs stays, ours is the copy beside it. The page goes on with theirs. */
        onPatch(saved, sent);
        const theirs = await notes.open(noteId);
        s.version = theirs.note.version; s.text = theirs.text;
        body.current?.replace(theirs.text);
        onPatch(theirs.note, theirs.text);
        onToast({ text: "Someone else changed this. Yours is kept as a copy.", action: { label: "Open copy", run: () => onOpen(saved.id) }, ms: 10_000 });
      } else {
        s.version = saved.version;
        onPatch(saved, sent);
      }
      setStatus("idle");
    } catch {
      /* Keep the text, and keep trying in the background. */
      s.dirty = true;
      setStatus("failed");
      s.retry = window.setTimeout(() => void run(), 5000);
    } finally {
      s.flying = false;
      if (noteId) onSaving(noteId, false);
      if (s.again) { s.again = false; void run(); }
    }
  }, [create, onSaving, onPatch, onToast, onOpen]);
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  const flushRef = useRef<(keepalive?: boolean) => Promise<void>>(async () => {});

  /* Writing together: this page's changes go as they're made; one refused (someone was first) goes again once theirs are in. */
  const flush = useCallback(async function send(keepalive = false): Promise<void> {
    const s = live.current, noteId = id.current, handle = body.current;
    if (!s.live || !noteId || !handle || s.sending) return;
    const pending = handle.pending();
    if (!pending) { setStatus((was) => was === "failed" ? was : "idle"); return; }
    s.sending = true; setStatus("saving");
    try {
      const sentCursor = s.cursorWaiting && s.cursor ? s.cursor : undefined;
      const took = await notes.send(noteId, { client: clientID, version: pending.version, updates: pending.updates, cursor: sentCursor }, keepalive);
      if (took && sentCursor) s.cursorWaiting = false;
    } catch {
      setStatus("failed");
      window.clearTimeout(s.sendTimer);
      s.sendTimer = window.setTimeout(() => void send(), 3000);
    } finally { s.sending = false; }
  }, [clientID]);
  const sendCursor = useCallback(() => {
    const s = live.current, noteId = id.current, handle = body.current;
    if (!s.live || !noteId || !handle || !s.cursor) return;
    if (handle.pending()) { s.cursorWaiting = true; return; }
    s.cursorWaiting = false;
    void notes.send(noteId, { client: clientID, version: handle.synced(), cursor: s.cursor }).catch(() => {});
  }, [clientID]);
  const moved = useCallback((anchor: number, head: number) => {
    const s = live.current;
    s.cursor = { anchor, head };
    window.clearTimeout(s.cursorTimer);
    s.cursorTimer = window.setTimeout(sendCursor, 120);
  }, [sendCursor]);

  const changed = useCallback((next: string) => {
    const s = live.current;
    s.text = next;
    if (s.live) { window.clearTimeout(s.sendTimer); s.sendTimer = window.setTimeout(() => void flush(), 60); return; }
    s.dirty = true;
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(() => void save(), 800);
  }, [save, flush]);

  /*
   * While it's open, everyone's changes come in as they're made, with where
   * their cursors are, and word of each save. Should the Portal have started
   * again, the page starts again from the note as it is there, and its own
   * unsent changes go on top.
   */
  useEffect(() => {
    const noteId = id.current;
    if (!liveOn || !noteId) return;
    let source: EventSource | null = null, stopped = false;
    const restart = async () => {
      source?.close();
      try {
        const start = await notes.join(noteId);
        if (stopped || !body.current) return;
        body.current.goLive(start.version, clientID, start.text);
        connect(start.version);
        void flush();
      } catch { if (!stopped) window.setTimeout(() => void restart(), 3000); }
    };
    const connect = (version: number) => {
      const es = new EventSource(notes.liveUrl(noteId, clientID, version));
      source = es;
      es.addEventListener("updates", (event) => {
        const { from, updates } = JSON.parse((event as MessageEvent).data) as { from: number; updates: LiveUpdate[] };
        if (!body.current?.receive(from, updates)) { void restart(); return; }
        if (live.current.cursorWaiting) sendCursor();
        void flush();
      });
      es.addEventListener("cursors", (event) => setHere((JSON.parse((event as MessageEvent).data) as { cursors: Cursor[] }).cursors));
      es.addEventListener("saved", (event) => {
        const saved = (JSON.parse((event as MessageEvent).data) as { note: Note }).note;
        const s = live.current;
        s.version = saved.version;
        if (saved.title !== s.title && document.activeElement !== titleField.current) { s.title = saved.title; s.typed = saved.title; setTitle(saved.title); }
        onPatch(saved, s.text);
      });
      es.addEventListener("copy", (event) => {
        const copy = (JSON.parse((event as MessageEvent).data) as { note: Note }).note;
        onPatch(copy);
        onToast({ text: "It was changed elsewhere at the same time. What was written here is kept as a copy.", action: { label: "Open copy", run: () => onOpen(copy.id) }, ms: 10_000 });
      });
      es.addEventListener("gone", () => { es.close(); onToast({ text: "This note was deleted." }); });
      es.addEventListener("reset", () => void restart());
    };
    connect(body.current?.synced() ?? joined.current?.version ?? 0);
    return () => { stopped = true; source?.close(); };
  }, [liveOn, clientID, flush, sendCursor, onPatch, onToast, onOpen]);

  /* Everyone else's cursor, in their colour, with their name. */
  useEffect(() => {
    body.current?.showCursors(here.filter((c) => c.clientID !== clientID && c.anchor !== null && c.head !== null)
      .map((c) => ({ clientID: c.clientID, name: firstName(people[c.username], c.username), colour: inkOf(c.username), anchor: c.anchor!, head: c.head! })));
  }, [here, people, clientID, text]);

  /*
   * Kimono AI, the phone and others write here too: when the window comes
   * back, and every 15s while the note is open, it looks again. A newer
   * version comes in where you are; with your own edits waiting it stays
   * yours, and saving keeps both.
   */
  const following = !draft || Boolean(draft.id);
  useEffect(() => {
    if (!following) return;
    let gone = false;
    const look = async () => {
      const s = live.current;
      if (s.live || !id.current || s.dirty || s.flying || document.visibilityState === "hidden") return;
      try {
        const fresh = await notes.open(id.current);
        if (gone || s.dirty || s.flying || fresh.note.version <= s.version) return;
        s.version = fresh.note.version; s.text = fresh.text;
        body.current?.replace(fresh.text);
        if (fresh.note.title !== s.title && document.activeElement !== titleField.current) { s.title = fresh.note.title; s.typed = fresh.note.title; setTitle(fresh.note.title); }
        onPatch(fresh.note, fresh.text);
      } catch { /* it looks again soon */ }
    };
    const timer = window.setInterval(() => void look(), 15_000);
    window.addEventListener("focus", look);
    return () => { gone = true; window.clearInterval(timer); window.removeEventListener("focus", look); };
  }, [following, onPatch]);

  /*
   * Leaving saves too: switching notes, and closing the page. A note of
   * yours left blank and Untitled is quietly put in the trash instead.
   */
  useEffect(() => {
    const s = live.current;
    const leave = () => { if (s.live) void flushRef.current(true); else if (s.dirty) void saveRef.current(true); };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      window.clearTimeout(s.retry);
      const empty = s.loaded && s.mine && !s.readOnly && blank(s.typed, s.text);
      if (!empty) { leave(); return; }
      window.clearTimeout(s.timer); s.dirty = false;
      const made = id.current ? Promise.resolve(id.current) : creating.current;
      void made?.then((noteId) => notes.remove(noteId).then(() => onGone(noteId)), () => {});
    };
    // Once, for the whole life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retitle = async () => {
    const s = live.current;
    const wanted = title.trim() || "Untitled";
    let before: string | null = null;
    try {
      if (!id.current && !creating.current) {
        if (blank(title, s.text)) return;
        s.dirty = false; window.clearTimeout(s.timer);
        await create(s.text);
        return;
      }
      const noteId = id.current ?? await creating.current!;
      if (wanted === s.title) { if (!title.trim()) setTitle(wanted); return; }
      before = s.title; s.title = wanted;
      const renamed = await notes.retitle(noteId, wanted);
      s.title = renamed.title;
      setTitle(renamed.title);
      onPatch(renamed);
    } catch { if (before !== null) s.title = before; onToast({ text: oops }); }
  };

  useEffect(() => { flushRef.current = flush; }, [flush]);

  const meta = (note ? lib?.notes.find((n) => n.id === note.id) ?? note : null) ?? (draft?.id ? lib?.notes.find((n) => n.id === draft.id) ?? null : null);
  /* Who has it: everyone in its space, and who it's shared with on its own or through its notebook. */
  const [access, setAccess] = useState<string[]>([]);
  const metaId = meta?.id ?? null;
  useEffect(() => {
    if (!metaId) return;
    let gone = false;
    notes.sharing({ kind: "note", id: metaId }).then((r) => {
      if (gone) return;
      const all = new Map<string, true>();
      for (const u of [...(r.members ?? []).map((m) => m.username), ...r.inherited.map((x) => x.username), ...r.shares.map((x) => x.username)]) all.set(u.toLowerCase(), true);
      setAccess([...all.keys()]);
    }, () => {});
    return () => { gone = true; };
  }, [metaId, accessKey]);
  const others = [...new Set(here.filter((c) => c.clientID !== clientID && c.username !== me.toLowerCase()).map((c) => c.username))];
  const nameOf = (username: string) => people[username.toLowerCase()]?.name ?? username;
  const section = meta ? lib?.sections.find((s) => s.id === meta.parentId) ?? null : draft?.parent ? lib?.sections.find((s) => s.id === draft.parent) ?? null : null;
  const now = useNow();
  const showFormats = useCallback((next: Formats) => setFormats((was) => was && JSON.stringify(was) === JSON.stringify(next) ? was : next), []);
  return <article className="nt-page">
    <header className="nt-pagehead">
      <button type="button" className="nt-iconbutton nt-back" onClick={onBack} aria-label="Back to notes" title="Back"><Icon name="back" /></button>
      {notebook ? <small className="nt-crumb">
        <NotebookCrest notebook={notebook} size={14} />{notebook.name}{section ? <><span aria-hidden="true">/</span>{section.name}</> : null}
      </small> : meta ? <small className="nt-crumb">Shared with you</small> : <span />}
      <span className="nt-grow" />
      {others.length ? <span className="nt-here" title={`Here now: ${listed(others.map(nameOf))}`} aria-label={`Here now: ${listed(others.map(nameOf))}`}>
        {others.slice(0, 4).map((u) => <span key={u} className="nt-here-face" style={{ "--who": inkOf(u) } as React.CSSProperties}><Faces usernames={[u]} people={people} size={24} /></span>)}
        {others.length > 4 ? <span className="nt-more-count">+{others.length - 4}</span> : null}
      </span> : null}
      <span className="nt-status" aria-live="polite">
        {status === "saving" ? <InkLoader className="nt-saving" label="Saving" />
          : status === "failed" ? <><span className="nt-word">Not saved</span><Seal type="button" compact tone="quiet" onClick={() => void (live.current.live ? flush() : save())}>Retry</Seal></>
          : meta ? <time className="nt-edited" dateTime={new Date(meta.updatedAt).toISOString()} title={fullDate(meta.updatedAt)}>
              {edited(meta.updatedAt, now)} by {meta.updatedBy.toLowerCase() === me.toLowerCase() ? "you" : firstName(people[meta.updatedBy.toLowerCase()], meta.updatedBy)}
            </time> : null}
      </span>
      {meta && access.length ? <button type="button" className="nt-access" onClick={() => onShare({ kind: "note", id: meta.id, name: meta.title })}
        title={`Who has access: ${listed(access.map(nameOf))}`} aria-label={`Who has access: ${listed(access.map(nameOf))}. Share`}>
        <Faces usernames={access} people={people} size={22} most={3} />
        {access.length > 3 ? <span className="nt-more-count">+{access.length - 3}</span> : null}
      </button> : null}
      {meta ? <RowMenu label={`More for ${meta.title}`} items={[
        { icon: "people", label: "Share", run: () => onShare({ kind: "note", id: meta.id, name: meta.title }) },
        ...(notebook && !readOnly ? [{ icon: "move" as const, label: "Move", run: () => setMoving(true) }, { icon: "trash" as const, label: "Delete", danger: true, run: () => onDelete(meta) }] : []),
        ...(notebook ? [] : [{ icon: "door" as const, label: "Leave", run: () => onLeave({ kind: "note", id: meta.id, name: meta.title }) }]),
      ]} /> : null}
    </header>
    <div className="nt-col nt-title-wrap">
      <input ref={titleField} className="nt-title" value={title} placeholder="Untitled" aria-label="Title" maxLength={200} readOnly={readOnly}
        onChange={(event) => { live.current.typed = event.target.value; setTitle(event.target.value); }} onBlur={() => void retitle()}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); body.current?.focus(); } }} />
    </div>
    <div className="nt-col nt-bodywrap">
      {text === null || (given === null && asked === null) ? <div className="nt-body nt-body-wait"><SkeletonRows rows={3} mark={false} /></div>
        : <NoteBody initial={text} readOnly={readOnly} onReady={ready} onChange={changed} onBlur={() => void (live.current.live ? flush() : save())} onFormats={showFormats} onCursor={moved} />}
    </div>
    {readOnly || text === null ? null : <FormatBar formats={formats} onRun={(action) => body.current?.run(action)} />}
    {moving && meta && lib ? <MoveSheet note={meta} lib={lib} onClose={() => setMoving(false)}
      onMove={async (parent) => { try { onPatch(await notes.move(meta.id, parent)); setMoving(false); } catch { onToast({ text: oops }); } }} /> : null}
  </article>;
}

/* ── the format bar: small flat blocks at the note's foot; the formatting at the caret is filled ── */

const formatButtons: ({ action: Action; icon: IconName; label: string; keys: string; on: (f: Formats) => boolean; gap?: boolean })[] = [
  { action: "bold", icon: "bold", label: "Bold", keys: "Mod-B", on: (f) => f.bold },
  { action: "italic", icon: "italic", label: "Italic", keys: "Mod-I", on: (f) => f.italic },
  { action: "heading", icon: "heading", label: "Heading", keys: "Mod-Alt-1", on: (f) => f.heading > 0, gap: true },
  { action: "bullets", icon: "bullets", label: "Bullets", keys: "Mod-Shift-8", on: (f) => f.bullets, gap: true },
  { action: "checklist", icon: "check", label: "Checklist", keys: "Mod-Shift-9", on: (f) => f.checklist },
  { action: "table", icon: "table", label: "Table", keys: "", on: () => false, gap: true },
  { action: "link", icon: "link", label: "Link", keys: "Mod-K", on: (f) => f.link, gap: true },
  { action: "code", icon: "code", label: "Code", keys: "Mod-E", on: (f) => f.code },
];

function FormatBar({ formats, onRun }: { formats: Formats | null; onRun: (action: Action) => void }) {
  return <div className="nt-formats" role="toolbar" aria-label="Formatting">
    {formatButtons.map((b) => {
      const on = Boolean(formats && b.on(formats));
      const label = b.action === "heading" && formats?.heading ? `Heading ${formats.heading}` : b.label;
      return <button key={b.action} type="button" className={cx("nt-format", b.gap && "is-gap", on && "is-on")} aria-pressed={on} aria-label={label}
        data-tip={b.keys ? `${label} ${keyName(b.keys)}` : label} onMouseDown={(event) => event.preventDefault()} onClick={() => onRun(b.action)}><Icon name={b.icon} /></button>;
    })}
  </div>;
}
