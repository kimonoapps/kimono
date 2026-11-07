"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { BusyFace, Choice, cx, InkBlot, InkPortraitFrame, Joint, InkLoader, Seal } from "@kimono/ui";
import { HoldSeal } from "@/components/hold-seal";
import { InkCrest } from "@/components/ink-crest";
import { Portrait as Face } from "@/components/portrait";
import { SkeletonRows } from "@/components/skeleton";
import { swap } from "@/components/motion";
import { notes, when, type Library, type Note, type Notebook, type Person, type Section, type Shareable, type Sharing } from "./api";
import type { BodyHandle } from "./editor";
import { Icon, type IconName } from "./icons";

/*
 * 帳 Kimono Notes on the web: a side panel of notebooks and their sections,
 * and a page holding the note list or the open note (docs/kimono-notes.md).
 * Where you are lives in the address (?in=…&n=…), so a reload or a link
 * opens the same place. Saving is automatic; there is no Save button.
 */

const NoteBody = dynamic(() => import("./editor").then((m) => m.NoteBody), { ssr: false, loading: () => <div className="nt-body nt-body-wait" /> });

const oops = "That didn't work.";
const tint = { quiet: "#8a7c77" };
const still = () => typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where you are is this page's own state, kept in the address: the next entry in history. */
function goTo(to: Record<string, string | null | undefined>, replace = false) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(to)) if (value) next.set(key, value);
  const url = `/notes${next.size ? `?${next}` : ""}`;
  if (replace) window.history.replaceState(null, "", url); else window.history.pushState(null, "", url);
}

/* The panel folds away: each browser's own choice. */
const foldKey = "kimono-notes-panel-folded";
const foldListeners = new Set<() => void>();
const panelFolded = () => { try { return window.localStorage.getItem(foldKey) === "1"; } catch { return false; } };
function setPanelFolded(folded: boolean) {
  try { window.localStorage.setItem(foldKey, folded ? "1" : "0"); } catch { /* private window: this page only */ }
  foldListeners.forEach((listener) => listener());
}
const useFolded = () => useSyncExternalStore((l) => { foldListeners.add(l); return () => { foldListeners.delete(l); }; }, panelFolded, () => false);

/** The line a note's row shows: its first prose, without markup. */
function excerptOf(text: string, chars = 160) {
  const prose = text.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/```[\s\S]*?(```|$)/g, " ")
    .split("\n").filter((line) => !/^\s*#\s/.test(line)).map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/, "")).join(" ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`~|]/g, "").replace(/\s+/g, " ").trim();
  return [...prose].length > chars ? `${[...prose].slice(0, chars).join("").trimEnd()}…` : prose;
}

/** A clock that moves the one-word times on. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  return now;
}

type Toast = { text: string; action?: { label: string; run: () => void }; ms?: number };
type Draft = { key: string; parent: string | null; made: Promise<Note>; id: string | null; slow: boolean };
type Place = { kind: "all" } | { kind: "notebook"; notebook: Notebook } | { kind: "section"; notebook: Notebook; section: Section };

/** Shown in place of Notes while it is switched off; admins are sent to its page instead. */
export function NotesOff() {
  return <div className="nt-off"><Empty seed="off" words="Notes isn't switched on." /></div>;
}

function Empty({ seed, words }: { seed: string; words: string }) {
  return <div className="nt-empty">
    <InkBlot className="nt-empty-blot" tint={tint.quiet} seed={seed}><Icon name="note" /></InkBlot>
    <p>{words}</p>
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
  const [drawer, setDrawer] = useState(false);
  const [arriving, setArriving] = useState<string | null>(null);
  const [sharingThing, setSharing] = useState<Shareable | null>(null);
  const [leavingThing, setLeaving] = useState<Shareable | null>(null);
  const folded = useFolded();
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
    const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) return all.filter((n) => words.every((w) => `${n.title} ${n.excerpt ?? ""}`.toLowerCase().includes(w)));
    if (place.kind === "notebook") return all.filter((n) => n.notebookId === place.notebook.id);
    if (place.kind === "section") { const inside = under(place.section.id); return all.filter((n) => inside.has(n.parentId)); }
    return all;
  }, [lib, find, place, under]);

  const notebookOf = useCallback((id: string) => lib?.notebooks.find((n) => n.id === id) ?? null, [lib]);
  const canWrite = (notebook: Notebook | null) => Boolean(notebook && notebook.role !== "viewer");

  /* A note's details changed (saved, retitled, moved): the list follows, newest first. */
  const patch = useCallback((note: Partial<Note> & { id: string }, text?: string) => setLib((now) => {
    if (!now) return now;
    const known = now.notes.find((n) => n.id === note.id);
    const next: Note = { ...(known ?? { excerpt: "" } as Note), ...note, ...(text !== undefined ? { excerpt: excerptOf(text) } : {}) };
    return { ...now, notes: [next, ...now.notes.filter((n) => n.id !== note.id)].toSorted((a, b) => b.updatedAt - a.updatedAt) };
  }), []);
  const savingNow = useCallback((id: string, on: boolean) => setSaving((all) => {
    if (all.has(id) === on) return all;
    const next = new Set(all); if (on) next.add(id); else next.delete(id); return next;
  }), []);

  /* New note is optimistic: the editor opens at once and the note is made behind it. */
  const startNew = useCallback((fromAddress = false) => {
    const here = place.kind === "section" ? place.section.id : place.kind === "notebook" ? place.notebook.id : null;
    const parent = here && canWrite(place.kind === "all" ? null : place.notebook) ? here : null;
    const key = `draft-${Date.now()}`;
    const made = notes.create(parent);
    const next: Draft = { key, parent, made, id: null, slow: false };
    setDraft(next);
    setFind("");
    goTo({ in: placeId, n: "new" }, fromAddress);
    const slow = setTimeout(() => setDraft((d) => d?.key === key ? { ...d, slow: true } : d), 300);
    made.then((note) => {
      clearTimeout(slow);
      setDraft((d) => d?.key === key ? { ...d, id: note.id, slow: false } : d);
      patch({ ...note, excerpt: "" });
    }, () => {
      clearTimeout(slow);
      setDraft((d) => d?.key === key ? null : d);
      setToast({ text: oops });
      if (new URLSearchParams(window.location.search).get("n") === "new") goTo({ in: placeId }, true);
    });
  }, [place, placeId, patch]);
  /* Once the new note has its id, the address names it (after the page knows it, so the editor stays as it is). */
  const draftId = draft?.id ?? null;
  useEffect(() => { if (draftId && openId === "new") goTo({ in: placeId, n: draftId }, true); }, [draftId, openId, placeId]);
  /* Away from it, the new note is a note like any other: opened again, it loads as one. */
  useEffect(() => {
    if (!draftId || openId === "new" || openId === draftId) return;
    const soon = setTimeout(() => setDraft((d) => d?.id === draftId ? null : d));
    return () => clearTimeout(soon);
  }, [draftId, openId]);
  /* The rail's New note, and an old link to it. */
  const wantsNew = params.get("new") === "1";
  useEffect(() => {
    if (!wantsNew || !lib) return;
    const soon = setTimeout(() => startNew(true));
    return () => clearTimeout(soon);
  }, [wantsNew, lib, startNew]);
  /* ⌘/Ctrl-Alt-N, or N when not typing, starts a note. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
      if (event.key.toLowerCase() === "n" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); startNew(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startNew]);

  const deleteNote = useCallback((note: Note) => {
    const before = lib;
    setLib((now) => now && { ...now, notes: now.notes.filter((n) => n.id !== note.id) });
    if (openId === note.id) goTo({ in: placeId });
    notes.remove(note.id).then(() => setToast({
      text: `Deleted ${note.title}.`,
      action: { label: "Undo", run: () => { void notes.restore(note.id).then(() => load(), () => setToast({ text: oops })); } },
    }), () => { setLib(before); setToast({ text: oops }); });
  }, [lib, openId, placeId, load]);

  const openNote = useCallback((id: string) => { setDrawer(false); goTo({ in: placeId, n: id }); }, [placeId]);
  const openPlace = useCallback((id: string | null) => { setDrawer(false); setFind(""); goTo({ in: id }); }, []);

  /* Moving between places carries the page in, as tabs do. */
  const mainRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => { swap(mainRef.current?.querySelector(".nt-listcol") ?? null); }, [placeId]);

  const editing = openId === "new" ? draft : openId ? (draft?.id === openId ? draft : null) : null;
  const openMeta = openId && openId !== "new" ? lib?.notes.find((n) => n.id === openId) ?? null : null;
  const noteKey = editing ? editing.key : openId;
  const openNotebook = openMeta ? (openMeta.notebookId ? notebookOf(openMeta.notebookId) : null) : editing ? (editing.parent ? lib?.notebooks.find((n) => under(n.id).has(editing.parent!)) ?? null : lib?.notebooks.find((n) => n.role !== "viewer") ?? null) : null;
  const showing = Boolean(openId);

  const panel = <Panel lib={lib} problem={problem} place={place} find={find} onFind={setFind} faces={faces} people={people} arriving={arriving}
    newBusy={Boolean(draft?.slow)} onNew={startNew} onPlace={openPlace} onReload={load} onToast={setToast} under={under}
    onShare={setSharing} onLeave={setLeaving} onOpenNote={openNote} current={openId} onFold={() => setPanelFolded(true)} />;

  return <div className={cx("nt", showing && "has-note", folded && "is-folded")}>
    <aside className="nt-side" aria-label="Notebooks">{panel}</aside>
    {drawer ? createPortal(<div className="nt-drawer-shade" onClick={() => setDrawer(false)}>
      <aside className="nt-side nt-drawer" aria-label="Notebooks" onClick={(event) => event.stopPropagation()}>{panel}</aside>
    </div>, document.body) : null}
    <main className="nt-main" ref={mainRef}>
      <section className="nt-listcol" aria-label="Notes">
        <ListHead place={place} searching={Boolean(find.trim())} faces={faces} people={people}
          onMenu={() => setDrawer(true)} onShare={setSharing} onLeave={setLeaving} />
        {lib === null && !problem ? <SkeletonRows rows={5} mark={false} /> : null}
        {lib && !listed.length
          ? <Empty seed={find.trim() ? "search" : placeId ?? "all"} words={find.trim() ? "No notes match." : place.kind === "section" ? "Nothing here yet." : "Your notes will be here."} />
          : <NoteList notes={listed} lib={lib} current={openId === "new" ? draft?.id ?? null : openId} saving={saving} now={now} showCrest={place.kind === "all" || Boolean(find.trim())}
              notebookOf={notebookOf} onOpen={openNote} onDelete={deleteNote} onMoved={(note) => patch(note)} onToast={setToast} onShare={setSharing} onLeave={setLeaving} />}
      </section>
      {showing ? <section className="nt-notecol" aria-label="Note">
        {openId !== "new" && !editing && lib && !openMeta
          ? <div className="nt-page nt-gone"><Empty seed="gone" words="That note isn't here any more." /><Seal type="button" tone="quiet" onClick={() => goTo({ in: placeId })}>Back</Seal></div>
          : openMeta || editing ? <NotePage key={noteKey} note={openMeta} draft={editing} notebook={openNotebook} lib={lib}
              readOnly={openMeta && !openMeta.notebookId ? null : !canWrite(openNotebook)} onBack={() => goTo({ in: placeId })} onSaving={savingNow} onPatch={patch} onDelete={deleteNote}
              onToast={setToast} onOpen={openNote} onShare={setSharing} onLeave={setLeaving} />
            : <div className="nt-page"><SkeletonRows rows={3} mark={false} /></div>}
      </section> : null}
    </main>
    {sharingThing ? <ShareSheet thing={sharingThing} me={me} people={people} publicLinks={publicLinks}
      onClose={(changed) => { const id = sharingThing.id; setSharing(null); if (changed) { setArriving(id); setTimeout(() => setArriving(null), 900); setFacesAsked((n) => n + 1); } }} /> : null}
    {leavingThing ? <LeaveSheet thing={leavingThing} me={me} onClose={() => setLeaving(null)} onToast={setToast}
      onLeft={() => { if (leavingThing.kind === "note" && openId === leavingThing.id) goTo({ in: placeId }); else if (leavingThing.kind === "notebook") openPlace(null); void load(); }} /> : null}
    {toast ? <div className="nt-snack" role="status">
      <span>{toast.text}</span>
      {toast.action ? <button type="button" className="nt-snack-act" onClick={() => { const run = toast.action!.run; setToast(null); run(); }}>{toast.action.label}</button> : null}
    </div> : null}
    {folded ? <button type="button" className="nt-roundbutton nt-unfold" onClick={() => setPanelFolded(false)} aria-label="Show notebooks" title="Show notebooks"><Icon name="panel" /></button> : null}
  </div>;
}

/* ── the side panel ── */

const foldsKey = "kimono-notes:folded";
function readFolds(): Set<string> { try { return new Set(JSON.parse(window.localStorage.getItem(foldsKey) ?? "[]") as string[]); } catch { return new Set(); } }

/** A name being written where it sits: a new section or notebook, or a new name for one. */
type Naming = { kind: "section" | "notebook"; parent: string; id: string | null; name: string };

/** A notebook's mark: its space's crest, washed in its colour and turned by the notebook's own id. */
function NotebookCrest({ notebook, size, className }: { notebook: Notebook; size: number; className?: string }) {
  return <InkCrest crest={notebook.space.crest} color={notebook.space.color} seed={notebook.id} size={size} className={className} />;
}

function Panel({ lib, problem, place, find, onFind, faces, people, arriving, newBusy, onNew, onPlace, onReload, onToast, under, onShare, onLeave, onOpenNote, current, onFold }: {
  lib: Library | null; problem: string | null; place: Place; find: string; onFind: (words: string) => void;
  faces: Record<string, string[]>; people: Record<string, Person>; arriving: string | null; newBusy: boolean;
  onNew: () => void; onPlace: (id: string | null) => void; onReload: () => Promise<void>; onToast: (toast: Toast) => void;
  under: (folder: string) => Set<string>; onShare: (thing: Shareable) => void; onLeave: (thing: Shareable) => void;
  onOpenNote: (id: string) => void; current: string | null; onFold: () => void;
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
      else if (was.kind === "section") { const made = await notes.createSection(name, was.parent); setFold(was.parent, false); onPlace(made.id); }
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
  const tree = (parent: string, notebook: Notebook, depth: number): React.ReactNode => {
    const kids = (lib?.sections ?? []).filter((s) => s.parentId === parent);
    const adding = naming?.kind === "section" && !naming.id && naming.parent === parent;
    if (!kids.length && !adding) return null;
    return <div className="nt-tree" style={{ "--depth": depth } as React.CSSProperties}>
      {kids.map((section) => <FolderRow key={section.id} kind="section" id={section.id} name={section.name} mark={<span className="nt-place-mark"><Icon name="section" /></span>}
        here={here === section.id && !find.trim()} count={count(section.id)} folded={folds.has(section.id)} onFold={(f) => setFold(section.id, f)}
        hasKids={(lib?.sections ?? []).some((s) => s.parentId === section.id)} writable={notebook.role !== "viewer"} canDelete
        naming={naming?.id === section.id ? naming.name : null} onNaming={(name) => setNaming({ kind: "section", parent: section.parentId, id: section.id, name })} onSaveName={() => void saveName()} onCancelName={() => setNaming(null)}
        onOpen={() => onPlace(section.id)} onAdd={() => { setNaming({ kind: "section", parent: section.id, id: null, name: "" }); setFold(section.id, false); }}
        onDeleted={deleted(section.id, section.name, notebook.id)} onFailed={() => onToast({ text: oops })}>
        {folds.has(section.id) ? null : tree(section.id, notebook, depth + 1)}
      </FolderRow>)}
      {adding ? <NameField value={naming.name} label="Section name" onChange={(name) => setNaming({ ...naming, name })} onSave={() => void saveName()} onCancel={() => setNaming(null)} /> : null}
    </div>;
  };
  const own = (lib?.notebooks ?? []).filter((n) => !n.sharedWithYou);
  const shared = (lib?.notebooks ?? []).filter((n) => n.sharedWithYou);
  const sharedNotes = (lib?.notes ?? []).filter((n) => n.notebookId === null);
  const bookRow = (notebook: Notebook) => <FolderRow key={notebook.id} kind="notebook" id={notebook.id} name={notebook.name} arriving={arriving === notebook.id}
        mark={<NotebookCrest notebook={notebook} size={26} className="nt-place-mark" />}
        faces={faces[notebook.id]?.length ? <Faces usernames={faces[notebook.id]} people={people} size={22} /> : null}
        here={here === notebook.id && !find.trim()} count={count(notebook.id)} folded={folds.has(notebook.id)} onFold={(f) => setFold(notebook.id, f)}
        hasKids={(lib?.sections ?? []).some((s) => s.parentId === notebook.id) || (naming?.kind === "section" && !naming.id && naming.parent === notebook.id)}
        writable={notebook.role !== "viewer"} canShare={canShare(notebook)} canDelete={!notebook.isSpace && !notebook.sharedWithYou} onLeave={notebook.sharedWithYou ? () => onLeave(asShareable(notebook)) : undefined}
        naming={naming?.id === notebook.id ? naming.name : null} onNaming={(name) => setNaming({ kind: "notebook", parent: "", id: notebook.id, name })} onSaveName={() => void saveName()} onCancelName={() => setNaming(null)}
        onOpen={() => onPlace(notebook.id)} onAdd={() => { setNaming({ kind: "section", parent: notebook.id, id: null, name: "" }); setFold(notebook.id, false); }} onShare={() => onShare(asShareable(notebook))}
        onDeleted={deleted(notebook.id, notebook.name, null)} onFailed={() => onToast({ text: oops })}>
        {folds.has(notebook.id) ? null : tree(notebook.id, notebook, 1)}
      </FolderRow>;
  return <>
    <div className="nt-side-head">
      <button type="button" className="nt-roundbutton nt-fold" onClick={onFold} aria-label="Hide notebooks" title="Hide notebooks"><Icon name="panel" /></button>
      <span>Notes</span>
    </div>
    <button type="button" className="nt-newnote" onClick={() => onNew()} aria-keyshortcuts="n"><Icon name="pencil" /><BusyFace busy={newBusy} label="Making a note">New note</BusyFace></button>
    <label className="nt-search"><Icon name="search" /><input type="search" value={find} placeholder="Search notes" aria-label="Search notes"
      onChange={(event) => onFind(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onFind(""); }} /></label>
    <span className="k-ink-rule nt-side-rule" aria-hidden="true" />
    <nav className="nt-places" aria-label="Notebooks">
      <button type="button" className="nt-place" aria-current={place.kind === "all" && !find.trim() ? "page" : undefined} onClick={() => onPlace(null)}>
        <span className="nt-place-mark"><Icon name="book" /></span><span className="nt-place-name">All notes</span>
      </button>
      {problem ? <p className="nt-quiet">{problem} <button type="button" className="nt-textbutton" onClick={() => void onReload()}>Retry</button></p> : null}
      {lib === null && !problem ? <SkeletonRows rows={2} mark={false} /> : null}
      {own.map(bookRow)}
      {lib ? <button type="button" className="nt-place nt-place-new" onClick={() => setMaking(true)}>
        <span className="nt-place-mark"><Icon name="plus" /></span><span className="nt-place-name">New notebook</span>
      </button> : null}
      {shared.length || sharedNotes.length ? <div className="nt-side-label">Shared with you</div> : null}
      {shared.map(bookRow)}
      {sharedNotes.map((note) => <div key={note.id} className="nt-place-row">
        <button type="button" className="nt-place" aria-current={current === note.id ? "page" : undefined} onClick={() => onOpenNote(note.id)}>
          <span className="nt-place-mark"><Icon name="note" /></span><span className="nt-place-name">{note.title}</span>
          {faces[note.id]?.length ? <Faces usernames={faces[note.id]} people={people} size={22} /> : null}
        </button>
        <RowMenu label={`More for ${note.title}`} items={[{ icon: "door", label: "Leave", run: () => onLeave({ kind: "note", id: note.id, name: note.title }) }]} />
      </div>)}
      {making ? <NewNotebookSheet onClose={() => setMaking(false)} onMade={async (id) => { setMaking(false); await onReload(); onPlace(id); }} /> : null}
    </nav>
  </>;
}

function NameField({ value, label, onChange, onSave, onCancel }: { value: string; label: string; onChange: (name: string) => void; onSave: () => void; onCancel: () => void }) {
  return <form className="nt-name" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <input autoFocus value={value} maxLength={80} placeholder={label} aria-label={label} onFocus={(event) => event.target.select()}
      onChange={(event) => onChange(event.target.value)} onBlur={onSave} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }} />
  </form>;
}

/** A notebook or a section in the panel: opens it; its ··· renames, adds a section, shares or deletes it. */
function FolderRow({ kind, id, name, mark, faces, arriving, here, count, folded, hasKids, writable, canShare, canDelete, onFold, naming, onNaming, onSaveName, onCancelName, onOpen, onAdd, onShare, onLeave, onDeleted, onFailed, children }: {
  kind: "notebook" | "section"; id: string; name: string; mark: React.ReactNode; faces?: React.ReactNode; arriving?: boolean;
  here: boolean; count: number; folded: boolean; hasKids: boolean; writable: boolean; canShare?: boolean; canDelete: boolean; onFold: (folded: boolean) => void;
  naming: string | null; onNaming: (name: string) => void; onSaveName: () => void; onCancelName: () => void;
  onOpen: () => void; onAdd: () => void; onShare?: () => void; onLeave?: () => void; onDeleted: (restorable: boolean) => Promise<void>; onFailed: () => void; children: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = () => {
    setBusy(true);
    (kind === "notebook" ? notes.removeNotebook(id) : notes.removeSection(id)).then(() => onDeleted(count === 0), onFailed).finally(() => { setBusy(false); setConfirming(false); });
  };
  return <div className={cx(kind === "notebook" ? "nt-notebook" : "nt-section", busy && "is-busy", arriving && "is-arriving")}>
    {naming !== null
      ? <NameField value={naming} label={kind === "notebook" ? "Notebook name" : "Section name"} onChange={onNaming} onSave={onSaveName} onCancel={onCancelName} />
      : <div className="nt-place-row">
          <button type="button" className="nt-place" aria-current={here ? "page" : undefined} onClick={onOpen}>
            {mark}<span className="nt-place-name">{name}</span>{faces}
          </button>
          {hasKids ? <button type="button" className={cx("nt-roundbutton nt-fold-toggle", !folded && "is-open")} aria-expanded={!folded} aria-label={folded ? "Show" : "Fold"} title={folded ? "Show" : "Fold"} onClick={() => onFold(!folded)}><Icon name="chevron" /></button> : null}
          {(writable || onLeave) && !confirming ? <RowMenu label={`More for ${name}`} items={[
            ...(writable ? [{ icon: "rename" as const, label: "Rename", run: () => onNaming(name) }] : []),
            ...(writable && kind === "section" ? [{ icon: "plus" as const, label: "New section", run: onAdd }] : []),
            ...(canShare && onShare ? [{ icon: "people" as const, label: "Share on its own", run: onShare }] : []),
            ...(onLeave ? [{ icon: "door" as const, label: "Leave", run: onLeave }] : []),
            ...(writable && canDelete ? [{ icon: "trash" as const, label: "Delete", danger: true, run: () => { if (count) setConfirming(true); else remove(); } }] : []),
          ]} /> : null}
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

function Faces({ usernames, people, size }: { usernames: string[]; people: Record<string, Person>; size: number }) {
  return <span className="nt-faces" style={{ "--s": `${size}px` } as React.CSSProperties}>
    {usernames.slice(0, 2).map((u) => <span key={u} className="nt-face">
      <InkPortraitFrame seed={u} weight={size < 30 ? 6 : 4}><Face name={people[u.toLowerCase()]?.name} username={u} picture={people[u.toLowerCase()]?.picture} size={Math.round(size * .82)} /></InkPortraitFrame>
    </span>)}
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

function ListHead({ place, searching, faces, people, onMenu, onShare, onLeave }: {
  place: Place; searching: boolean; faces: Record<string, string[]>; people: Record<string, Person>;
  onMenu: () => void; onShare: (thing: Shareable) => void; onLeave: (thing: Shareable) => void;
}) {
  const menu = <button type="button" className="nt-roundbutton nt-menubutton" onClick={onMenu} aria-label="Notebooks" title="Notebooks"><Icon name="menu" /></button>;
  if (searching || place.kind === "all") return <header className="nt-listhead">{menu}<h1>{searching ? "Search" : "All notes"}</h1></header>;
  if (place.kind === "section") return <header className="nt-listhead">
    {menu}
    <div className="nt-listhead-id">
      <small className="nt-crumb"><NotebookCrest notebook={place.notebook} size={18} />{place.notebook.name}</small>
      <h1>{place.section.name}</h1>
    </div>
  </header>;
  const notebook = place.notebook;
  return <header className="nt-listhead is-notebook">
    {menu}
    <NotebookCrest notebook={notebook} size={64} className="nt-bigcrest" />
    <div className="nt-listhead-id">
      {notebook.isSpace || !notebook.space.name ? null : <small className="nt-crumb">{notebook.space.name}</small>}
      <span className="nt-listhead-name"><h1>{notebook.name}</h1>{faces[notebook.id]?.length ? <Faces usernames={faces[notebook.id]} people={people} size={28} /> : null}</span>
    </div>
    {canShare(notebook) ? <Seal type="button" tone="quiet" compact onClick={() => onShare(asShareable(notebook))}><Icon name="people" />Share</Seal> : null}
    {notebook.sharedWithYou ? <Seal type="button" tone="quiet" compact onClick={() => onLeave(asShareable(notebook))}><Icon name="door" />Leave</Seal> : null}
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
        {showCrest && notebook ? <NotebookCrest notebook={notebook} size={16} /> : null}
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
 * Sharing a notebook or a note, like a document: who has it, each an editor
 * or a viewer on a joint switch, taken off with ×. Every change applies as it
 * is made. At the foot, its public link. A viewer sees who has it, and no switches.
 */
function ShareSheet({ thing, me, people, publicLinks, onClose }: { thing: Shareable; me: string; people: Record<string, Person>; publicLinks: boolean; onClose: (changed: boolean) => void }) {
  const [info, setInfo] = useState<Sharing | null>(null);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [changed, setChanged] = useState(false);
  const { copied, copy } = useCopy();
  useEffect(() => { notes.sharing(thing).then(setInfo, () => setProblem(oops)); }, [thing]);
  const nameOf = (username: string) => people[username.toLowerCase()]?.name ?? username;
  const editing = info?.role === "owner" || info?.role === "editor";
  const working = (key: string, on: boolean) => setBusy((now) => { const next = new Set(now); if (on) next.add(key); else next.delete(key); return next; });
  const change = async (username: string, role: "editor" | "viewer" | null) => {
    setProblem(null); working(username, true);
    try {
      const next = await notes.share(thing, username, role);
      if (!("left" in next)) setInfo(next);
      setChanged(true);
    } catch (error) { setProblem(error instanceof Error && /account|already/.test(error.message) ? error.message : oops); }
    finally { working(username, false); }
  };
  const link = async (on: boolean) => {
    setProblem(null); working("link", true);
    try { const url = await notes.link(thing, on); setInfo((now) => now && { ...now, link: url }); } catch { setProblem(oops); }
    finally { working("link", false); }
  };
  const taken = new Set([me.toLowerCase(), ...(info?.shares ?? []).map((x) => x.username.toLowerCase())]);
  const words = find.trim().toLowerCase().replace(/^@/, "");
  const found = words ? Object.values(people).filter((p) => !taken.has(p.username.toLowerCase()) && (p.name.toLowerCase().includes(words) || p.username.toLowerCase().includes(words))).slice(0, 6) : [];
  const pick = (p: Person) => { setFind(""); void change(p.username, "editor"); };
  /* At the top: who has it through its notebook, else who sees it in its space. */
  const vias = new Map<string, string[]>();
  for (const x of info?.inherited ?? []) vias.set(x.via.name, [...(vias.get(x.via.name) ?? []), nameOf(x.username)]);
  const lead = vias.size ? [...vias].map(([via, names]) => `${listed(names)} ${names.length === 1 ? "has" : "have"} it through ${via}.`).join(" ")
    : info && info.space.members > 1 && info.space.name ? `Everyone in ${info.space.name} can see this.` : undefined;
  return <Sheet title={`Share ${thing.name}`} lead={lead} onClose={() => onClose(changed)} footer={<>
    {problem ? <span className="nt-problem" role="alert">{problem}</span> : null}
    <span className="nt-grow" />
    <Seal type="button" onClick={() => onClose(changed)}>Done</Seal>
  </>}>
    {info === null && !problem ? <SkeletonRows rows={2} mark={false} /> : null}
    {info && editing ? <>
      <label className="nt-search nt-find"><Icon name="search" /><input autoFocus value={find} onChange={(event) => setFind(event.target.value)} placeholder="Add people" aria-label="Add people"
        onKeyDown={(event) => { if (event.key === "Enter" && found[0]) { event.preventDefault(); pick(found[0]); } }} /></label>
      {words ? <div className="nt-found" role="listbox" aria-label="People">
        {found.map((p) => <button key={p.username} type="button" role="option" aria-selected={false} onClick={() => pick(p)}>
          <Faces usernames={[p.username]} people={people} size={32} /><span><b>{p.name}</b><small>@{p.username}</small></span>
        </button>)}
        {!found.length ? <p className="nt-quiet">No one by that name.</p> : null}
      </div> : null}
    </> : null}
    {info?.shares.length ? <ul className="nt-people">
      {info.shares.map((m) => <li key={m.username} className={cx(!editing && "is-in")}>
        <Faces usernames={[m.username]} people={people} size={36} />
        <span className="nt-who"><b>{nameOf(m.username)}{m.username.toLowerCase() === me.toLowerCase() ? " (you)" : ""}</b><small>{m.role === "editor" ? "Can edit" : "Can view"}</small></span>
        {busy.has(m.username) ? <InkLoader className="nt-saving" label="Saving" /> : null}
        {editing && m.username.toLowerCase() !== me.toLowerCase() ? <>
          <Joint checked={m.role === "editor"} onText="EDIT" offText="VIEW" label={`${nameOf(m.username)} can edit`} disabled={busy.has(m.username)}
            onChange={(on) => void change(m.username, on ? "editor" : "viewer")} />
          <button type="button" className="nt-roundbutton" aria-label={`Take ${nameOf(m.username)} off`} title="Take off" disabled={busy.has(m.username)} onClick={() => void change(m.username, null)}><Icon name="close" /></button>
        </> : null}
      </li>)}
    </ul> : info && !editing ? <p className="nt-quiet">Only you have it.</p> : null}
    {info && editing && publicLinks ? <div className="nt-public">
      <div className="nt-public-row">
        <span className="nt-who"><b>Public link</b><small>{info.link ? "Anyone with the link can read this." : "Off"}</small></span>
        {busy.has("link") ? <InkLoader className="nt-saving" label="Saving" /> : null}
        <Joint checked={Boolean(info.link)} label="Public link" disabled={busy.has("link")} onChange={(on) => void link(on)} />
      </div>
      {info.link ? <div className="nt-public-link">
        <input readOnly value={info.link} aria-label="Link" onFocus={(event) => event.target.select()} />
        <Seal type="button" compact tone="quiet" onClick={() => copy(info.link!)}>{copied ? "Copied" : "Copy"}</Seal>
      </div> : null}
    </div> : null}
  </Sheet>;
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

function NotePage({ note, draft, notebook, lib, readOnly: given, onBack, onSaving, onPatch, onDelete, onToast, onOpen, onShare, onLeave }: {
  note: Note | null; draft: Draft | null; notebook: Notebook | null; lib: Library | null;
  /** Null for a note shared with you on its own: what you may do with it is asked for. */
  readOnly: boolean | null;
  onBack: () => void; onSaving: (id: string, on: boolean) => void; onPatch: (note: Partial<Note> & { id: string }, text?: string) => void;
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
  const body = useRef<BodyHandle | null>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const live = useRef({ text: "", version: note?.version ?? 0, title: draft ? "" : note?.title ?? "", dirty: false, flying: false, again: false, timer: 0, retry: 0 });
  const id = useRef<string | null>(note?.id ?? draft?.id ?? null);
  const made = draft?.made;
  /* A new note's id (and the version to save over) once the note is made; what was typed waits for it. */
  const idOf = useCallback(async () => {
    if (id.current) return id.current;
    const note = await made!;
    if (!id.current) { id.current = note.id; live.current.version = note.version; live.current.title = note.title; }
    return id.current;
  }, [made]);
  const firstId = note?.id ?? null;

  useEffect(() => {
    if (draft || !firstId) { titleField.current?.focus(); return; }
    let gone = false;
    notes.open(firstId).then((opened) => {
      if (gone) return;
      live.current.version = opened.note.version; live.current.text = opened.text; live.current.title = opened.note.title;
      setTitle(opened.note.title); setText(opened.text);
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
    s.flying = true; s.dirty = false;
    setStatus("saving");
    const sent = s.text;
    let noteId: string | null = null;
    try {
      noteId = await idOf();
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
  }, [idOf, onSaving, onPatch, onToast, onOpen]);

  const changed = useCallback((next: string) => {
    const s = live.current;
    s.text = next; s.dirty = true;
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(() => void save(), 800);
  }, [save]);

  /*
   * Kimono AI, the phone and others write here too: when the window comes
   * back, and every 15s while the note is open, it looks again. A newer
   * version comes in where you are; with your own edits waiting it stays
   * yours, and saving keeps both.
   */
  useEffect(() => {
    if (draft && !draft.id) return;
    let gone = false;
    const look = async () => {
      const s = live.current;
      if (!id.current || s.dirty || s.flying || document.visibilityState === "hidden") return;
      try {
        const fresh = await notes.open(id.current);
        if (gone || s.dirty || s.flying || fresh.note.version <= s.version) return;
        s.version = fresh.note.version; s.text = fresh.text;
        body.current?.replace(fresh.text);
        if (fresh.note.title !== s.title && document.activeElement !== titleField.current) { s.title = fresh.note.title; setTitle(fresh.note.title); }
        onPatch(fresh.note, fresh.text);
      } catch { /* it looks again soon */ }
    };
    const timer = window.setInterval(() => void look(), 15_000);
    window.addEventListener("focus", look);
    return () => { gone = true; window.clearInterval(timer); window.removeEventListener("focus", look); };
  }, [draft, onPatch]);

  /* Leaving saves too: switching notes, and closing the page. */
  useEffect(() => {
    const s = live.current;
    const leave = () => { if (s.dirty) void save(true); };
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); window.clearTimeout(s.retry); leave(); };
  }, [save]);

  const retitle = async () => {
    const s = live.current;
    const wanted = title.trim() || "Untitled";
    let before: string | null = null;
    try {
      const noteId = await idOf();
      if (wanted === s.title) { if (!title.trim()) setTitle(wanted); return; }
      before = s.title; s.title = wanted;
      const renamed = await notes.retitle(noteId, wanted);
      s.title = renamed.title;
      setTitle(renamed.title);
      onPatch(renamed);
    } catch { if (before !== null) s.title = before; onToast({ text: oops }); }
  };

  const meta = note ?? (draft?.id ? lib?.notes.find((n) => n.id === draft.id) ?? null : null);
  const section = meta ? lib?.sections.find((s) => s.id === meta.parentId) ?? null : null;
  const now = useNow();
  return <article className="nt-page">
    <header className="nt-pagehead">
      <button type="button" className="nt-roundbutton nt-back" onClick={onBack} aria-label="Back to notes" title="Back"><Icon name="back" /></button>
      {notebook ? <small className="nt-crumb">
        <NotebookCrest notebook={notebook} size={18} />{notebook.name}{section ? <><span aria-hidden="true">/</span>{section.name}</> : null}
      </small> : meta ? <small className="nt-crumb">Shared with you</small> : <span />}
      <span className="nt-grow" />
      <span className="nt-status" aria-live="polite">
        {status === "saving" ? <InkLoader className="nt-saving" label="Saving" />
          : status === "failed" ? <><span className="nt-word">Not saved</span><Seal type="button" compact tone="quiet" onClick={() => void save()}>Retry</Seal></>
          : meta ? <span className="nt-when">{when(meta.updatedAt, now)}</span> : null}
      </span>
      {meta ? <RowMenu label={`More for ${meta.title}`} items={[
        { icon: "people", label: "Share", run: () => onShare({ kind: "note", id: meta.id, name: meta.title }) },
        ...(notebook && !readOnly ? [{ icon: "move" as const, label: "Move", run: () => setMoving(true) }, { icon: "trash" as const, label: "Delete", danger: true, run: () => onDelete(meta) }] : []),
        ...(notebook ? [] : [{ icon: "door" as const, label: "Leave", run: () => onLeave({ kind: "note", id: meta.id, name: meta.title }) }]),
      ]} /> : null}
    </header>
    <div className="nt-title-wrap">
      <input ref={titleField} className="nt-title" value={title} placeholder="Untitled" aria-label="Title" maxLength={200} readOnly={readOnly}
        onChange={(event) => setTitle(event.target.value)} onBlur={() => void retitle()}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); body.current?.focus(); } }} />
    </div>
    {text === null || (given === null && asked === null) ? <div className="nt-body nt-body-wait"><SkeletonRows rows={3} mark={false} /></div>
      : <NoteBody initial={text} readOnly={readOnly} onReady={(handle) => { body.current = handle; }} onChange={changed} onBlur={() => void save()} />}
    {moving && meta && lib ? <MoveSheet note={meta} lib={lib} onClose={() => setMoving(false)}
      onMove={async (parent) => { try { onPatch(await notes.move(meta.id, parent)); setMoving(false); } catch { onToast({ text: oops }); } }} /> : null}
  </article>;
}
