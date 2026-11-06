"use client";

import { SkeletonRows } from "@/components/skeleton";
import { rise, riseWhenReady, slide } from "@/components/motion";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { AppBloom, Choice, cx, InkBlot, InkPortraitFrame, InkWave, MorphLoader, Seal } from "@kimono/ui";
import { Portrait as Face } from "@/components/portrait";
import {
  contentUrl, drive, DriveProblem, extension, hasThumb, isText, kindOf, linkUrl, thumbUrl, readableSize, shared, spaceLinkUrl, upload, when,
  type Crests, type DriveNode, type Folder, type LinkAccess, type Person, type Role, type SharedSpace, type Space, type SpaceDetail,
} from "./api";
import { Icon, type IconName } from "./icons";
import { FilePreview, TypeMark } from "@/components/file-preview/file-preview";

/* Markdown's reader loads only when a Markdown file is opened. */

/*
 * 帳 Kimono Drive on the web, layout A (Ledger). One page: the sidebar of
 * spaces, the sheet for where you are, and the tray of uploads, which keeps
 * going as you move between folders. Where you are lives in the address
 * (?space=…&folder=…), so it can be shared and survives a reload.
 *
 * The same sheet opens a space for someone holding its link (/s/<token>):
 * no sidebar, no people, and only what the link allows.
 */

type Me = { username: string; name: string };
type Upload = { id: string; name: string; size: number; sent: number; folderId: string; spaceName: string; done?: string; failed?: string; controller: AbortController };
type Toast = { text: string; undo?: () => Promise<void> };
type Guest = { token: string; access: LinkAccess };

const roleWords: Record<Role, string> = { owner: "you own it", editor: "you can edit", viewer: "you can view" };
const roleNames: Record<Role, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };
const problemText = (error: unknown, fallback = "That didn't work.") => error instanceof Error ? error.message : fallback;
const labelFor = (nodes: DriveNode[]) => nodes.length === 1 ? `“${nodes[0].name}”` : `${nodes.length} items`;

/** Where you are is this page's own state, kept in the address: the next entry in history, no crossing. */
function goTo(base: string, to: Record<string, string | null>) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(to)) if (value) next.set(key, value);
  window.history.pushState(null, "", `${base}${next.size ? `?${next}` : ""}`);
}

/* ── uploads, which outlive the folder they started in ── */

function useUploads() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [landed, setLanded] = useState(0);
  const start = useCallback((files: File[], folderId: string, spaceName: string, via?: { link: string; name?: string }) => {
    const added = files.map((file): [File, Upload] => [file, { id: crypto.randomUUID(), name: file.name, size: file.size, sent: 0, folderId, spaceName, controller: new AbortController() }]);
    setUploads((list) => [...list, ...added.map(([, item]) => item)]);
    for (const [file, item] of added) {
      const update = (change: Partial<Upload>) => setUploads((list) => list.map((u) => u.id === item.id ? { ...u, ...change } : u));
      upload(file, folderId, (sent) => update({ sent }), item.controller.signal, via)
        .then((fileId) => { update({ sent: item.size, done: fileId }); setLanded((n) => n + 1); })
        .catch((error) => { if (!item.controller.signal.aborted) update({ failed: problemText(error, "That file couldn't be uploaded.") }); });
    }
  }, []);
  const going = uploads.some((u) => !u.done && !u.failed);
  /* Closing the tab mid-upload loses it; the browser asks first. */
  useEffect(() => {
    if (!going) return;
    const hold = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [going]);
  return {
    uploads, landed, start,
    clear: () => setUploads((list) => list.filter((u) => !u.done && !u.failed)),
    cancel: (id: string) => { uploads.find((u) => u.id === id)?.controller.abort(); setUploads((list) => list.filter((u) => u.id !== id)); },
  };
}

function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 8000); return () => clearTimeout(timer); }, [toast]);
  return [toast, setToast] as const;
}

function ToastView({ toast, onDone }: { toast: Toast | null; onDone: () => void }) {
  if (!toast) return null;
  return <div className="dv-toast" role="status">
    <span>{toast.text}</span>
    {toast.undo ? <Seal type="button" tone="quiet" compact onClick={async () => { const undo = toast.undo!; onDone(); await undo(); }}>Undo</Seal> : null}
  </div>;
}

/* A guest's name for what they add, remembered on this device. */
const nameKey = "kimono-drive-guest-name";
const nameListeners = new Set<() => void>();
const guestName = {
  subscribe(listener: () => void) {
    nameListeners.add(listener);
    window.addEventListener("storage", listener);
    return () => { nameListeners.delete(listener); window.removeEventListener("storage", listener); };
  },
  get() { try { return window.localStorage.getItem(nameKey) ?? ""; } catch { return ""; } },
  set(value: string) {
    try { if (value) window.localStorage.setItem(nameKey, value); else window.localStorage.removeItem(nameKey); } catch { /* private window: it just isn't remembered */ }
    for (const listener of nameListeners) listener();
  },
};

/* ── Drive, signed in ── */

export function DriveApp({ me }: { me: Me }) {
  const params = useSearchParams();
  const view = params.get("view");
  const spaceParam = params.get("space");
  const folderParam = params.get("folder");
  // Drive moves by its own address, not by page: each new space or view slides its sheet in.
  const where = `${view ?? ""}|${spaceParam ?? ""}`;
  const body = useRef<HTMLDivElement>(null);
  const shownWhere = useRef(where);
  useLayoutEffect(() => {
    if (shownWhere.current === where) return;
    shownWhere.current = where;
    const sheet = body.current?.querySelector(":scope > section") ?? null;
    slide(sheet);
    // A space's rows rise as its folder loads; the other views rise here.
    return view ? riseWhenReady(sheet) : undefined;
  }, [where, view]);

  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [toast, setToast] = useToast();
  const [making, setMaking] = useState(false);
  const uploads = useUploads();

  const loadSpaces = useCallback(() => drive.spaces().then(
    (list) => { setSpaces(list); setProblem(null); },
    (error) => { setProblem(problemText(error, "Drive isn't answering.")); },
  ), []);
  useEffect(() => {
    let live = true;
    drive.spaces().then((list) => { if (live) setSpaces(list); }, (error) => { if (live) setProblem(problemText(error, "Drive isn't answering.")); });
    return () => { live = false; };
  }, []);
  useEffect(() => { void drive.people().then((list) => setPeople(Object.fromEntries(list.map((p) => [p.username.toLowerCase(), p])))).catch(() => {}); }, []);

  const go = useCallback((to: Record<string, string | null>) => goTo("/drive", to), []);
  const current = spaces?.find((s) => s.id === spaceParam) ?? (view ? null : spaces?.[0] ?? null);
  const codeSpace = spaces?.find((s) => s.code) ?? null;
  const yours = spaces?.filter((s) => s.role === "owner" && !s.code) ?? [];
  const sharedWithYou = spaces?.filter((s) => s.role !== "owner") ?? [];

  return <div className="dv">
    <div className="dv-body" ref={body}>
      <aside className="dv-side">
        {codeSpace ? <div>
          <div className="dv-side-label">Code</div>
          <div className="dv-nav"><SpaceLink space={codeSpace} here={!view && current?.id === codeSpace.id} people={people} onOpen={() => go({ space: codeSpace.id })} /></div>
        </div> : null}
        <div>
          <div className="dv-side-label">Your spaces</div>
          <div className="dv-nav">{yours.map((space) => <SpaceLink key={space.id} space={space} here={!view && current?.id === space.id} people={people} onOpen={() => go({ space: space.id })} />)}</div>
          {spaces && !yours.length && !codeSpace ? <p className="dv-quiet-text dv-side-none">None yet.</p> : null}
        </div>
        {sharedWithYou.length ? <div>
          <div className="dv-side-label">Shared with you</div>
          <div className="dv-nav">{sharedWithYou.map((space) => <SpaceLink key={space.id} space={space} here={!view && current?.id === space.id} people={people} onOpen={() => go({ space: space.id })} />)}</div>
        </div> : null}
        <button type="button" className="dv-newspace" onClick={() => setMaking(true)}><Icon name="plus" />New space</button>
      </aside>

      {problem && !spaces ? <section className="dv-sheet"><div className="dv-empty"><h3>Drive isn&apos;t answering</h3><p>{problem}</p></div></section>
        : !spaces ? <section className="dv-sheet"><SkeletonRows rows={6} className="dv-skel" /></section>
        : view === "trash" ? <TrashView onToast={setToast} spaces={spaces} />
        : view === "recent" ? <RecentView spaces={spaces} people={people} onOpen={(node) => go({ space: node.spaceId, folder: node.parentId, file: node.id })} />
        : current && view === "settings" ? <SettingsView key={current.id} space={current} me={me} people={people} onChanged={loadSpaces} onLeft={() => { void loadSpaces(); go({}); }} back={() => go({ space: current.id })} />
        : current ? <SpaceView
            key={current.id}
            space={current}
            folderId={folderParam || current.rootId}
            openFile={params.get("file")}
            people={people}
            landed={uploads.landed}
            onGo={(folder, file) => go({ space: current.id, folder: folder === current.rootId ? null : folder, file: file ?? null })}
            onSettings={() => go({ space: current.id, view: "settings" })}
            onUpload={(files, folderId) => uploads.start(files, folderId, current.name)}
            onToast={setToast}
          />
        : <section className="dv-sheet"><div className="dv-empty">
            <h3>No spaces yet</h3>
            <div className="k-seal-group"><Seal type="button" onClick={() => setMaking(true)}><Icon name="plus" />New space</Seal></div>
          </div></section>}
    </div>

    {uploads.uploads.length ? <UploadTray uploads={uploads.uploads} onClear={uploads.clear} onCancel={uploads.cancel} onToast={setToast} /> : null}
    <ToastView toast={toast} onDone={() => setToast(null)} />
    {making ? <NewSpaceDialog onClose={() => setMaking(false)} onMade={async (space) => { setMaking(false); await loadSpaces(); go({ space: space.id }); }} /> : null}
  </div>;
}

/* ── Drive, through a space's link ── */

export function GuestDrive({ token, space, mark }: { token: string; space: SharedSpace; mark: string }) {
  const params = useSearchParams();
  const [toast, setToast] = useToast();
  const uploads = useUploads();
  const asSpace = useMemo((): Space => ({
    id: space.id, name: space.name, crest: space.crest, color: space.color, mark, rootId: space.rootId,
    role: "viewer", members: 0, createdBy: "",
  }), [space, mark]);
  const guest = useMemo((): Guest => ({ token, access: space.access }), [token, space.access]);
  return <div className="dv">
    <div className="dv-body solo">
      <SpaceView
        space={asSpace}
        guest={guest}
        folderId={params.get("folder") || space.rootId}
        openFile={params.get("file")}
        people={{}}
        landed={uploads.landed}
        onGo={(folder, file) => goTo(`/s/${token}`, { folder: folder === space.rootId ? null : folder, file: file ?? null })}
        onUpload={(files, folderId) => uploads.start(files, folderId, space.name, { link: token, name: guestName.get().trim() || undefined })}
        onToast={setToast}
      />
    </div>
    {uploads.uploads.length ? <UploadTray uploads={uploads.uploads} guest onClear={uploads.clear} onCancel={uploads.cancel} onToast={setToast} /> : null}
    <ToastView toast={toast} onDone={() => setToast(null)} />
  </div>;
}

/* ── the sidebar ── */

function Mark({ space, size = "" }: { space: Pick<Space, "mark" | "code">; size?: string }) {
  if (space.code) return <span className={`dv-mark dv-code-mark ${size}`} aria-hidden="true">
    <AppBloom identity={{ id: "kimono-code", name: "Code", accent: space.code.accent, glyph: "code" }} size="mark" />
  </span>;
  return <span className={`dv-mark mon ${size}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: space.mark ?? "" }} />;
}

function SpaceLink({ space, here, people, onOpen }: { space: Space; here: boolean; people: Record<string, Person>; onOpen: () => void }) {
  const owner = people[space.createdBy?.toLowerCase()];
  const meta = space.code ? "Your projects, kept by Code" : space.role === "owner"
    ? space.members === 1 ? "Only you" : `${space.members} people`
    : `${owner?.name.split(" ")[0] ?? space.createdBy}'s · ${space.role === "editor" ? "you edit" : "you view"}`;
  return <button type="button" className="dv-space" aria-current={here ? "page" : undefined} onClick={onOpen}>
    <Mark space={space} /><span><b>{space.name}</b><small>{meta}</small></span>
  </button>;
}

/** Drive's people wear the house portrait: the shared face in its ink ring, as in the rail and on You. */
function Portrait({ person, username, size = 28 }: { person?: Person; username: string; size?: number }) {
  return <span className="pfp-ink" style={{ "--s": `${size}px` } as React.CSSProperties}>
    <InkPortraitFrame seed={username} weight={size < 30 ? 6 : 4}>
      <Face name={person?.name} username={username} picture={person?.picture} size={Math.round(size * .82)} />
    </InkPortraitFrame>
  </span>;
}

/* ── a space ── */

type Sort = "name" | "modified" | "size";
type MenuAt = { id: string; top: number; bottom: number; left: number; right: number; align: "start" | "end"; from: HTMLElement | null };

/** Every file's bytes, saved rather than shown. */
function saveFiles(nodes: DriveNode[], url: (node: DriveNode) => string) {
  for (const node of nodes) {
    if (node.kind !== "file") continue;
    const link = document.createElement("a");
    link.href = url(node);
    link.download = node.name;
    document.body.append(link);
    link.click();
    link.remove();
  }
}

/** Reads a dropped folder's entries, all of them (browsers hand them over a hundred at a time). */
async function entriesOf(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return all;
    all.push(...batch);
  }
}

function SpaceView({ space, guest = null, folderId, openFile, people, landed, onGo, onSettings, onUpload, onToast }: {
  space: Space; guest?: Guest | null; folderId: string; openFile: string | null; people: Record<string, Person>; landed: number;
  onGo: (folder: string, file?: string | null) => void; onSettings?: () => void;
  onUpload: (files: File[], folderId: string) => void; onToast: (toast: Toast) => void;
}) {
  const token = guest?.token ?? null;
  const canEdit = !guest && space.role !== "viewer";
  const canAdd = guest ? guest.access === "add" : canEdit;

  const [folder, setFolder] = useState<Folder | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /* A selection belongs to the folder it was made in. */
  const [selection, setSelection] = useState<{ folder: string; ids: Set<string> }>({ folder: folderId, ids: new Set() });
  const selected = useMemo(() => selection.folder === folderId ? selection.ids : new Set<string>(), [selection, folderId]);
  const setSelected = useCallback((next: Set<string> | ((current: Set<string>) => Set<string>)) => setSelection((now) => {
    const base = now.folder === folderId ? now.ids : new Set<string>();
    return { folder: folderId, ids: typeof next === "function" ? next(base) : next };
  }), [folderId]);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<DriveNode[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [sort, setSort] = useState<Sort>("name");
  const [query, setQuery] = useState("");
  const [results, setFound] = useState<DriveNode[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [detail, setDetail] = useState<SpaceDetail | null>(null);
  const name = useSyncExternalStore(guestName.subscribe, guestName.get, () => "");
  const picker = useRef<HTMLInputElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pivot = useRef<string | null>(null);
  const depth = useRef(0);
  // A folder opening: its rows rise into place once they've arrived.
  // Deeper slides in from the right, back out from the left.
  const shownFolder = folder?.folder.id;
  const shownDepth = folder?.path.length ?? 0;
  const lastDepth = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!shownFolder) return;
    if (lastDepth.current !== null && lastDepth.current !== shownDepth) slide(list.current, shownDepth > lastDepth.current ? 1 : -1);
    lastDepth.current = shownDepth;
    rise(list.current, { step: 24, limit: 16 });
  }, [shownFolder, shownDepth]);

  const fetchFolder = useCallback((id: string) => token ? shared.folder(token, id) : drive.folder(id), [token]);
  const fileUrl = useCallback((node: DriveNode) => token ? shared.fileUrl(token, node.id) : contentUrl(node), [token]);
  const load = useCallback(() => fetchFolder(folderId).then(
    (loaded) => { setFolder(loaded); setProblem(null); },
    (error) => { setProblem(problemText(error, "That folder couldn't be opened.")); },
  ), [fetchFolder, folderId]);
  useEffect(() => {
    let live = true;
    fetchFolder(folderId).then(
      (loaded) => { if (live) { setFolder(loaded); setProblem(null); } },
      (error) => { if (live) setProblem(problemText(error, "That folder couldn't be opened.")); },
    );
    return () => { live = false; };
  }, [fetchFolder, folderId, landed]);
  useEffect(() => { if (token) return; void drive.space(space.id).then(setDetail).catch(() => {}); }, [space.id, token]);
  useEffect(() => {
    if (!query.trim() || token) return;
    const timer = setTimeout(() => { void drive.search(query).then((items) => setFound(items.filter((n) => n.spaceId === space.id))).catch(() => setFound([])); }, 200);
    return () => clearTimeout(timer);
  }, [query, space.id, token]);

  const act = useCallback(async (work: () => Promise<unknown>, done?: Toast) => {
    try { await work(); await load(); if (done) onToast(done); } catch (error) { onToast({ text: problemText(error) }); await load(); }
  }, [load, onToast]);

  /* Search results stand in for the folder only while there's something to search for. */
  const found = query.trim() ? results : null;
  const rows = useMemo(() => {
    const items = found ?? folder?.children ?? [];
    const sorted = [...items].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      : sort === "modified" ? b.updatedAt - a.updatedAt : b.size - a.size);
    return found ? sorted : [...sorted.filter((n) => n.kind === "folder"), ...sorted.filter((n) => n.kind === "file")];
  }, [folder, found, sort]);
  const chosen = rows.filter((n) => selected.has(n.id));
  const opened = openFile ? rows.find((n) => n.id === openFile) ?? null : null;
  const members = detail?.memberList ?? [];
  const menuNode = menu ? rows.find((n) => n.id === menu.id) ?? null : null;
  const here = folder?.folder.id ?? folderId;

  /* ── going places ── */
  const openFolder = (id: string) => { setMenu(null); setQuery(""); onGo(id); };
  const openNode = (node: DriveNode) => {
    setMenu(null);
    if (node.kind === "folder") return openFolder(node.id);
    if (found) setQuery("");
    onGo(node.parentId ?? here, !found && opened?.id === node.id ? null : node.id);
  };

  /* ── choosing ── */
  const toggle = (id: string) => { pivot.current = id; setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const selectRange = (to: string) => {
    const ids = rows.map((n) => n.id);
    const from = ids.indexOf(pivot.current ?? to), end = ids.indexOf(to);
    if (from < 0 || end < 0) return toggle(to);
    const [low, high] = from <= end ? [from, end] : [end, from];
    setSelected((s) => new Set([...s, ...ids.slice(low, high + 1)]));
  };
  const focusRow = (id: string) => list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"] .nm button`)?.focus();

  /* ── doing things ── */
  const trash = (nodes: DriveNode[]) => act(async () => { for (const node of nodes) await drive.trash(node.id); setSelected(new Set()); }, {
    text: `${labelFor(nodes)} moved to Trash.`,
    undo: async () => { for (const node of nodes) await drive.restore(node.id).catch(() => {}); await load(); },
  });
  const share = async (node: DriveNode) => {
    try {
      const url = linkUrl(node) ?? await drive.link(node.id);
      /* Copying can be refused once the link took a moment to make; the drawer shows it to copy by hand. */
      const copied = await navigator.clipboard.writeText(url).then(() => true, () => false);
      if (!node.link) await load();
      if (copied) onToast({ text: "Public link copied." });
      else { onToast({ text: "Public link made." }); onGo(node.parentId ?? here, node.id); }
    } catch (error) { onToast({ text: problemText(error) }); }
  };
  const unlink = (node: DriveNode) => act(() => drive.unlink(node.id), { text: "Public link turned off." });
  const save = (nodes: DriveNode[]) => saveFiles(nodes, (node) => token ? fileUrl(node) : `${fileUrl(node)}?download=1`);
  /* Acting on one of several chosen things acts on all of them. */
  const group = (node: DriveNode) => selected.has(node.id) && chosen.length > 1 ? chosen : [node];
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = (node: DriveNode, from: HTMLElement) => {
    const rect = from.getBoundingClientRect();
    setMenu(menu?.id === node.id ? null : { id: node.id, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, align: "end", from });
  };

  /* ── dropping files, and folders of them ── */
  const folderNamed = async (parentId: string, folderName: string) => {
    try { return (await drive.createFolder(parentId, folderName)).id; } catch (error) {
      if (!(error instanceof DriveProblem) || error.status !== 409) throw error;
      const there = (await drive.folder(parentId)).children.find((n) => n.kind === "folder" && n.name.toLowerCase() === folderName.toLowerCase());
      if (!there) throw error;
      return there.id;
    }
  };
  const addTree = async (directory: FileSystemDirectoryEntry, parentId: string) => {
    const id = await folderNamed(parentId, directory.name);
    const entries = await entriesOf(directory);
    const files = await Promise.all(entries.filter((e): e is FileSystemFileEntry => e.isFile).map((e) => new Promise<File>((resolve, reject) => e.file(resolve, reject))));
    if (files.length) onUpload(files, id);
    for (const sub of entries) if (sub.isDirectory) await addTree(sub as FileSystemDirectoryEntry, id);
  };
  const drop = (data: DataTransfer) => {
    if (!canAdd || !folder) return;
    /* Entries can only be read while the drop is being handled. */
    const files: File[] = [];
    const folders: FileSystemDirectoryEntry[] = [];
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) folders.push(entry as FileSystemDirectoryEntry);
      else { const file = item.getAsFile(); if (file) files.push(file); }
    }
    if (files.length) onUpload(files, folder.folder.id);
    if (!folders.length) return;
    if (token) { onToast({ text: "Only files can be added here, not folders." }); return; }
    void (async () => {
      try { for (const entry of folders) await addTree(entry, folder.folder.id); await load(); } catch (error) { onToast({ text: problemText(error) }); await load(); }
    })();
  };

  /* ── the keyboard: arrows move, space chooses, shift stretches ── */
  const onKeys = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [role=dialog], .dv-menu")) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;
    const rowId = target.closest<HTMLElement>("[data-row]")?.dataset.row ?? null;
    const index = rowId ? rows.findIndex((n) => n.id === rowId) : -1;
    if (key === "/" && !mod && !token) { event.preventDefault(); searchField.current?.focus(); return; }
    if (mod && key.toLowerCase() === "a" && rows.length) { event.preventDefault(); setSelected(new Set(rows.map((n) => n.id))); return; }
    if (key === "Escape" && selected.size) { event.preventDefault(); setSelected(new Set()); return; }
    if (!list.current?.contains(target) || !rows.length) return;
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault();
      const nextIndex = key === "Home" ? 0 : key === "End" ? rows.length - 1
        : index < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, index + (key === "ArrowDown" ? 1 : -1)));
      const next = rows[nextIndex];
      if (event.shiftKey) { if (!pivot.current || !selected.size) pivot.current = rowId ?? next.id; selectRange(next.id); }
      focusRow(next.id);
      return;
    }
    if (!rowId || index < 0) return;
    const node = rows[index];
    if (key === " ") { event.preventDefault(); if (event.shiftKey) selectRange(rowId); else toggle(rowId); }
    else if ((key === "Delete" || (key === "Backspace" && mod)) && canEdit) { event.preventDefault(); void trash(group(node)); }
    else if (key === "F2" && canEdit) { event.preventDefault(); setRenaming(rowId); }
    else if (key === "ContextMenu" || (key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const more = list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(rowId)}"] .dv-more`);
      if (more) openMenu(node, more);
    }
  };

  /* In the Code space, the top level holds projects and each project its tasks. */
  const codeRole = (node: DriveNode) => !space.code || node.kind !== "folder" || found ? undefined
    : (folder?.path.length ?? 0) === 0 ? "project" as const : (folder?.path.length ?? 0) === 1 ? "task" as const : undefined;
  const subtitle = (node: DriveNode) => node.kind === "folder" ? codeRole(node) === "project" ? "Project" : codeRole(node) === "task" ? "Chat" : "Folder"
    : `${extension(node.name)}${!token && node.guest ? ` · added by ${node.guest}` : ""}`;

  return <section className="dv-sheet"
    style={space.code ? { "--dv-code": space.code.accent } as React.CSSProperties : undefined}
    onKeyDown={onKeys}
    onKeyUp={(event) => { const target = event.target as HTMLElement; if (event.key === " " && target.closest("[data-row]") && !target.closest("input")) event.preventDefault(); }}
    onDragEnter={(event) => { if (canAdd && event.dataTransfer.types.includes("Files")) { depth.current += 1; setDragging(true); } }}
    onDragOver={(event) => { if (canAdd && event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDragLeave={() => { if (!dragging) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
    onDrop={(event) => { event.preventDefault(); depth.current = 0; setDragging(false); drop(event.dataTransfer); }}>
    <div className="dv-mast">
      <div className="dv-mast-id">
        <Mark space={space} size="lg" />
        <div>
          {guest ? <div className="dv-kicker">{canAdd ? "Shared space · you can add files" : "Shared space"}</div> : null}
          <h1>{space.name}</h1>
          {!guest ? <p className="dv-members">
            <span className="pfps">{members.slice(0, 6).map((m) => <Portrait key={m.username} person={people[m.username.toLowerCase()]} username={m.username} size={26} />)}</span>
            <small>{space.members === 1 ? "Only you" : `${space.members} people`}{space.role !== "owner" ? ` · ${roleWords[space.role]}` : ""}</small>
          </p> : null}
        </div>
      </div>
      <div className="dv-mast-acts">
        {guest && canAdd ? <label className="k-field dv-guestname"><span>Your name</span>
          <input value={name} maxLength={60} autoComplete="name" onChange={(e) => guestName.set(e.target.value)} />
        </label> : null}
        <div className="dv-acts">
          {!guest ? <button type="button" className="dv-textbtn" onClick={onSettings}>People</button> : null}
          {canEdit ? <Seal type="button" tone="quiet" onClick={() => setNaming(true)}><Icon name="folder" />New folder</Seal> : null}
          {canAdd ? <Seal type="button" onClick={() => picker.current?.click()}><Icon name="upload" />Upload</Seal> : null}
        </div>
        {canAdd ? <input ref={picker} type="file" multiple hidden onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length && folder) onUpload(files, folder.folder.id);
          event.target.value = "";
        }} /> : null}
      </div>
    </div>

    {chosen.length ? <div className="dv-selbar">
      <div className="count">
        <Check on={chosen.length === rows.length ? true : "part"} label={chosen.length === rows.length ? "Clear selection" : "Select all"} onClick={() => setSelected(chosen.length === rows.length ? new Set() : new Set(rows.map((n) => n.id)))} />
        <span>{chosen.length} selected</span>
        {chosen.some((n) => n.kind === "file") ? <small>· {readableSize(chosen.reduce((sum, n) => sum + n.size, 0))}</small> : null}
      </div>
      <div className="acts">
        {chosen.every((n) => n.kind === "file") ? <Seal type="button" tone="quiet" compact onClick={() => save(chosen)}><Icon name="download" />Download</Seal> : null}
        {canEdit ? <Seal type="button" tone="quiet" compact onClick={() => setMoving(chosen)}><Icon name="move" />Move to…</Seal> : null}
        {canEdit ? <Seal type="button" tone="danger" compact onClick={() => void trash(chosen)}><Icon name="trash" />Move to Trash</Seal> : null}
        <button type="button" className="dv-linkbtn" onClick={() => setSelected(new Set())}>Clear</button>
      </div>
    </div> : <div className="dv-toolbar">
      {found || (folder?.path.length ?? 0) > 0 ? <div className="dv-crumbs">
        {found ? <b>Found in {space.name}</b> : (folder ? [...folder.path, folder.folder] : []).map((node, index, all) => index === all.length - 1
          ? <b key={node.id}>{index === 0 ? space.name : node.name}</b>
          : <Fragment key={node.id}><button type="button" onClick={() => openFolder(node.id)}>{index === 0 ? space.name : node.name}</button><span className="sep">/</span></Fragment>)}
      </div> : null}
      <div className="dv-tools">
        {!guest ? <label className="dv-search"><Icon name="search" />
          <input ref={searchField} type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} placeholder="Search this space" aria-label="Search this space" />
        </label> : null}
        <Choice compact className="dv-select" aria-label="Sort by" value={sort} onChange={(next) => setSort(next as Sort)} options={[{ value: "name", label: "Name, A–Z" }, { value: "modified", label: "Newest first" }, { value: "size", label: "Largest first" }]} />
      </div>
    </div>}

    <div className={cx("dv-list", guest && "guest")} ref={list}>
      {problem ? <div className="dv-empty"><p>{problem}</p></div>
        : !folder ? <SkeletonRows rows={5} />
        : !rows.length ? <div className="dv-empty">
            <h3>{found ? "Nothing by that name" : "Nothing here yet"}</h3>
            {!found && canAdd ? <p>Drop files here, or upload them.</p> : null}
          </div>
        : rows.map((node) => <Fragment key={node.id}>
            <div className={cx("dv-r", selected.has(node.id) && "sel", opened?.id === node.id && "open")} data-row={node.id}
              onContextMenu={(event) => {
                if ((event.target as HTMLElement).closest("input")) return;
                event.preventDefault();
                setMenu({ id: node.id, top: event.clientY, bottom: event.clientY, left: event.clientX, right: event.clientX, align: "start", from: null });
              }}>
              <Check on={selected.has(node.id)} ghost={!selected.size} label={`Select ${node.name}`} onClick={(event) => { if (event.shiftKey) selectRange(node.id); else toggle(node.id); }} />
              <Kind node={node} as={codeRole(node)} token={token} />
              <div className="nm">
                {renaming === node.id ? <RenameField node={node} onDone={(next) => { setRenaming(null); if (next && next !== node.name) void act(() => drive.rename(node.id, next)); focusRow(node.id); }} />
                  : <button type="button"
                      onMouseDown={(event) => { if (event.shiftKey) event.preventDefault(); }}
                      onClick={(event) => { if (event.shiftKey) selectRange(node.id); else if (event.metaKey || event.ctrlKey) toggle(node.id); else openNode(node); }}>
                      <b>{node.name}</b>
                      <small>{subtitle(node)}{node.kind === "file" ? <span className="dv-m"> · {readableSize(node.size)}</span> : null}</small>
                    </button>}
              </div>
              {!guest ? <span className="c-share">{node.link ? <span className="dv-pub"><Icon name="link" />Public link</span> : node.kind === "file" ? <span className="dv-quiet-text">Space only</span> : null}</span> : null}
              <span className="num c-size">{node.kind === "folder" ? "—" : readableSize(node.size)}</span>
              <span className="num dv-when c-when">
                {!guest ? <Portrait person={people[node.createdBy?.toLowerCase()]} username={node.createdBy || node.guest || "?"} size={22} /> : null}
                <span>{when(node.updatedAt)}</span>
              </span>
              <span className="dv-rowmenu">
                <button type="button" className={cx("dv-more", menu?.id === node.id && "open")} aria-label={`Actions for ${node.name}`} aria-haspopup="menu" aria-expanded={menu?.id === node.id}
                  onClick={(event) => openMenu(node, event.currentTarget)}><Icon name="more" /></button>
              </span>
            </div>
            {opened?.id === node.id ? <Drawer node={node} url={fileUrl(node)} token={token} guest={Boolean(guest)} canEdit={canEdit} people={people}
              onSave={() => save([node])} onShare={() => void share(node)} onUnlink={() => void unlink(node)} onClose={() => onGo(here)} /> : null}
          </Fragment>)}
    </div>

    {menu && menuNode ? <FloatingMenu at={menu} label={`Actions for ${menuNode.name}`} onClose={closeMenu}>
      <MenuItem icon="open" onPick={() => openNode(menuNode)}>Open</MenuItem>
      {menuNode.kind === "file" ? <MenuItem icon="download" onPick={() => save([menuNode])}>Download</MenuItem> : null}
      {menuNode.kind === "file" && !guest && (menuNode.link || canEdit) ? <>
        <hr />
        <MenuItem icon="link" onPick={() => void share(menuNode)}>{menuNode.link ? "Copy public link" : "Make public link"}</MenuItem>
        {menuNode.link && canEdit ? <MenuItem icon="lock" onPick={() => void unlink(menuNode)}>Turn off public link</MenuItem> : null}
      </> : null}
      {canEdit ? <>
        <hr />
        <MenuItem icon="rename" onPick={() => setRenaming(menuNode.id)}>Rename</MenuItem>
        <MenuItem icon="move" onPick={() => setMoving(group(menuNode))}>Move to…</MenuItem>
        <hr />
        <MenuItem icon="trash" danger onPick={() => void trash(group(menuNode))}>Move to Trash</MenuItem>
      </> : null}
    </FloatingMenu> : null}

    {dragging ? <div className="dv-drop"><div>
      <span className="arrow"><Icon name="upload" /></span>
      <b>Drop to add to {folder && folder.path.length ? folder.folder.name : space.name}</b>
    </div></div> : null}

    {naming && folder ? <NameDialog title="New folder" action="Make it" onClose={() => setNaming(false)} onSave={async (folderName) => { await drive.createFolder(folder.folder.id, folderName); setNaming(false); await load(); }} /> : null}
    {moving ? <MoveDialog space={space} nodes={moving} onClose={() => setMoving(null)} onMove={async (target) => {
      const nodes = moving;
      setMoving(null);
      await act(async () => { for (const node of nodes) await drive.move(node.id, target); setSelected(new Set()); }, { text: `Moved ${labelFor(nodes)}.` });
    }} /> : null}
  </section>;
}


function Check({ on, ghost, label, onClick }: { on: boolean | "part"; ghost?: boolean; label: string; onClick: (event: React.MouseEvent) => void }) {
  return <button type="button" className={cx("dv-check", on === "part" && "part", on === true && "on", ghost && !on && "ghost")} aria-pressed={on === "part" ? "mixed" : on} aria-label={label} onClick={onClick}>
    <span className="box">{on === true ? <Icon name="check" /> : null}</span>
  </button>;
}

/**
 * A row's mark: a folder, or the file itself when it can be pictured (a
 * thumbnail for images, the opening frame for video), else its extension.
 * [token] reads a link-opened space's files; [plain] keeps to the extension.
 */
function Kind({ node, as, token, plain }: { node: DriveNode; as?: "project" | "task"; token?: string | null; plain?: boolean }) {
  const kind = kindOf(node);
  const [failed, setFailed] = useState(false);
  if (kind === "folder" && as) return <Wash icon={as} seed={node.id} tint={CODE_TINT} tone={`is-${as}`} />;
  if (kind === "folder") return <Wash icon="folder" seed={node.id} tint={FOLDER_TINT} tone="folder" />;
  const ext = <span className="ext">{extension(node.name)}</span>;
  if (!plain && !failed && hasThumb(node)) return <span className="dv-kind pic">
    {/* eslint-disable-next-line @next/next/no-img-element -- Drive's own thumbnail of the file */}
    <img src={thumbUrl(node, 256, token)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
  </span>;
  if (!plain && !failed && kind === "video") return <span className="dv-kind pic vid"><Frame src={token ? shared.fileUrl(token, node.id) : contentUrl(node)} onFail={() => setFailed(true)} /></span>;
  return <span className="dv-kind typed"><TypeMark name={node.name} fallback={ext} /></span>;
}

const FOLDER_TINT = "#c48a45";
const CODE_TINT = "#3f6b6a";

/** A folder-like mark: its line icon on a watercolour puddle, the puddle's shape seeded by what it marks. */
function Wash({ icon, seed, tint, tone, size = "" }: { icon: IconName; seed: string; tint: string; tone: string; size?: string }) {
  return <span className={cx("dv-kind dv-wash", tone, size)}><InkBlot seed={seed} tint={tint}><Icon name={icon} /></InkBlot></span>;
}

/** A video's opening frame, fetched only once its row scrolls into view. */
function Frame({ src, onFail }: { src: string; onFail: () => void }) {
  const [near, setNear] = useState(false);
  const watch = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const seen = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setNear(true); seen.disconnect(); } }, { rootMargin: "200px" });
    seen.observe(element);
  }, []);
  return near
    ? <video src={`${src}#t=0.5`} muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" onError={onFail} />
    : <i ref={watch} aria-hidden="true" />;
}

function RenameField({ node, onDone }: { node: DriveNode; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(node.name);
  const finished = useRef(false);
  const finish = (name: string | null) => { if (finished.current) return; finished.current = true; onDone(name); };
  const field = useCallback((input: HTMLInputElement | null) => {
    if (!input) return;
    input.focus();
    /* The name without its extension is what people usually change. */
    const dot = node.kind === "file" ? node.name.lastIndexOf(".") : -1;
    input.setSelectionRange(0, dot > 0 ? dot : node.name.length);
  }, [node]);
  return <input ref={field} value={value} aria-label="New name" onChange={(e) => setValue(e.target.value)}
    onKeyDown={(e) => { if (e.key === "Enter") finish(value.trim()); if (e.key === "Escape") { e.stopPropagation(); finish(null); } }}
    onBlur={() => finish(value.trim())} />;
}

/* ── a menu that floats over the page, flipping up near the bottom ── */

function FloatingMenu({ at, label, onClose, children }: { at: MenuAt; label: string; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement | null>(null);
  const close = useCallback((restore: boolean) => { onClose(); if (restore) at.from?.focus(); }, [at, onClose]);
  const place = useCallback((element: HTMLDivElement | null) => {
    box.current = element;
    if (!element) return;
    const edge = 8, gap = 4;
    const width = element.offsetWidth, height = element.offsetHeight;
    const viewWidth = document.documentElement.clientWidth, viewHeight = window.innerHeight;
    const left = Math.max(edge, Math.min(at.align === "start" ? at.left : at.right - width, viewWidth - width - edge));
    const below = at.bottom + gap, above = at.top - gap - height;
    const top = below + height <= viewHeight - edge ? below : above >= edge ? above : Math.max(edge, viewHeight - edge - height);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.visibility = "visible";
    element.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, [at]);
  useEffect(() => {
    const away = (event: Event) => {
      const target = event.target as Node;
      if (box.current?.contains(target) || at.from?.contains(target)) return;
      onClose();
    };
    const keys = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(true); } };
    const leave = () => onClose();
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("scroll", away, true);
    document.addEventListener("keydown", keys);
    window.addEventListener("resize", leave);
    window.addEventListener("blur", leave);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("scroll", away, true);
      document.removeEventListener("keydown", keys);
      window.removeEventListener("resize", leave);
      window.removeEventListener("blur", leave);
    };
  }, [at, close, onClose]);
  return <div ref={place} className="dv-menu" role="menu" aria-label={label}
    onKeyDown={(event) => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"));
      const index = items.indexOf(document.activeElement as HTMLElement);
      const move = (to: number) => { event.preventDefault(); items[(to + items.length) % items.length]?.focus(); };
      if (event.key === "ArrowDown") move(index + 1);
      else if (event.key === "ArrowUp") move(index - 1);
      else if (event.key === "Home") move(0);
      else if (event.key === "End") move(items.length - 1);
      else if (event.key === "Tab") close(false);
    }}
    onClick={(event) => { if ((event.target as HTMLElement).closest("[role=menuitem]")) close(Boolean(at.from)); }}>
    {children}
  </div>;
}

function MenuItem({ icon, danger, onPick, children }: { icon: IconName; danger?: boolean; onPick: () => void; children: React.ReactNode }) {
  return <button type="button" role="menuitem" tabIndex={-1} className={danger ? "danger" : undefined} onClick={onPick}><Icon name={icon} />{children}</button>;
}

/* ── a file's drawer: preview and its public link ── */

function Drawer({ node, url, token, guest, canEdit, people, onSave, onShare, onUnlink, onClose }: {
  node: DriveNode; url: string; token: string | null; guest: boolean; canEdit: boolean; people: Record<string, Person>;
  onSave: () => void; onShare: () => void; onUnlink: () => void; onClose: () => void;
}) {
  const kind = kindOf(node);
  const by = people[node.createdBy?.toLowerCase()];
  const address = guest ? null : linkUrl(node);
  const byline = guest ? null : by?.name.split(" ")[0] ?? (node.createdBy || node.guest);
  const text = isText(node);
  const shown = kind === "image" || kind === "video" || text;
  return <div className={cx("dv-drawer", shown && "wide")}><div className="dv-drawer-grid">
    <FilePreview name={node.name} url={url} mime={node.mime} overlayClassName="dv-over"
      picture={kind === "image" ? <Picture node={node} url={url} token={token} /> : undefined}
      actions={<Seal type="button" tone="quiet" compact onClick={onSave}><Icon name="download" />Download</Seal>} />
    <div className="dv-drawer-text">
      <div className="dv-head">
        <div>
          <div className="kick">
            {!guest ? <Portrait person={by} username={node.createdBy || node.guest || "?"} size={22} /> : null}
            <span>{readableSize(node.size)} · {byline ? `${byline}, ` : ""}{when(node.updatedAt).toLowerCase()}</span>
          </div>
          <h2>{node.name}</h2>
        </div>
        <div className="dv-acts">
          <Seal type="button" tone="quiet" compact onClick={onSave}><Icon name="download" />Download</Seal>
          {kind === "image" || kind === "video" || kind === "audio" ? <Seal type="button" tone="quiet" compact onClick={() => window.open(url, "_blank", "noopener")}><Icon name="open" />Open full size</Seal> : null}
          <button type="button" className="dv-more" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
      </div>
      {guest ? null : address ? <div className="dv-addr"><code>{address}</code>
        <span className="k-seal-group">
          <Seal type="button" compact onClick={onShare}><Icon name="copy" />Copy link</Seal>
          {canEdit ? <Seal type="button" tone="danger" compact onClick={onUnlink}>Turn off</Seal> : null}
        </span>
      </div> : canEdit ? <div className="k-seal-group"><Seal type="button" onClick={onShare}><Icon name="link" />Make public link</Seal></div> : null}
    </div>
  </div></div>;
}

/**
 * An image in the drawer: the row's small thumbnail at once, blurred, with the
 * large one sharpening over it. GIFs play from the file itself; a picture the
 * server can't make falls back to the file.
 */
function Picture({ node, url, token }: { node: DriveNode; url: string; token: string | null }) {
  const own = !hasThumb(node) || extension(node.name) === "GIF";
  const [src, setSrc] = useState(own ? url : thumbUrl(node, 1280, token));
  const [ready, setReady] = useState(false);
  return <>
    {/* eslint-disable-next-line @next/next/no-img-element -- Drive's own picture of the file */}
    {!own ? <img className="blur" src={thumbUrl(node, 256, token)} alt="" aria-hidden="true" /> : null}
    {/* eslint-disable-next-line @next/next/no-img-element -- a preview of the file itself, from Drive */}
    <img className={cx("full", ready && "ready")} src={src} alt={node.name} decoding="async"
      onLoad={() => setReady(true)} onError={() => { if (src !== url) setSrc(url); }} />
  </>;
}

/* ── dialogs ── */

function Dialog({ title, lead, children, footer, onClose }: { title: string; lead?: string; children?: React.ReactNode; footer: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  const opened = useCallback((element: HTMLDivElement | null) => {
    if (element && !element.contains(document.activeElement)) (element.querySelector<HTMLElement>("[autofocus], input, select") ?? element).focus();
  }, []);
  return <div className="dv-shade" onClick={onClose}>
    <div className="dv-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={opened} onClick={(event) => event.stopPropagation()}>
      <header><h2>{title}</h2>{lead ? <p>{lead}</p> : null}</header>
      <div className="dv-dialog-body">{children}</div>
      <footer>{footer}</footer>
    </div>
  </div>;
}

function NameDialog({ title, action, initial = "", onClose, onSave }: { title: string; action: string; initial?: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setProblem(null);
    try { await onSave(name.trim()); } catch (error) { setProblem(error instanceof DriveProblem ? error.message : "That didn't work."); setBusy(false); }
  };
  return <Dialog title={title} onClose={onClose} footer={<>
    <span className={cx("left", problem && "bad")}>{problem}</span>
    <Seal type="button" tone="quiet" onClick={onClose}>Cancel</Seal>
    <Seal type="button" disabled={!name.trim() || busy} onClick={() => void save()}>{action}</Seal>
  </>}>
    <label className="k-field"><span>Name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void save(); }} /></label>
  </Dialog>;
}

/** Move to…: the space's folders, browsed like the folder view, and "Move here". */
function MoveDialog({ space, nodes, onClose, onMove }: { space: Space; nodes: DriveNode[]; onClose: () => void; onMove: (folderId: string) => Promise<void> }) {
  const [where, setWhere] = useState(nodes[0]?.parentId ?? space.rootId);
  const [at, setAt] = useState<Folder | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    drive.folder(where).then((loaded) => { if (live) { setAt(loaded); setProblem(null); } }, (error) => { if (live) setProblem(problemText(error, "That folder couldn't be opened.")); });
    return () => { live = false; };
  }, [where]);
  const ready = at?.folder.id === where;
  const moving = new Set(nodes.map((n) => n.id));
  const already = nodes.every((n) => n.parentId === where);
  const trail = at ? [...at.path, at.folder] : [];
  const children = ready ? [...at.children].sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) : a.kind === "folder" ? -1 : 1) : [];
  return <Dialog title={nodes.length === 1 ? `Move “${nodes[0].name}”` : `Move ${nodes.length} items`} onClose={onClose} footer={<>
    <span className="left">{ready && already ? "Already here" : null}</span>
    <Seal type="button" tone="quiet" onClick={onClose}>Cancel</Seal>
    <Seal type="button" disabled={!ready || already || busy} onClick={async () => { setBusy(true); await onMove(where); }}>Move here</Seal>
  </>}>
    <div className="dv-pick">
      <div className="dv-crumbs">
        {trail.map((node, index) => index === trail.length - 1
          ? <b key={node.id}>{index === 0 ? space.name : node.name}</b>
          : <Fragment key={node.id}><button type="button" onClick={() => setWhere(node.id)}>{index === 0 ? space.name : node.name}</button><span className="sep">/</span></Fragment>)}
      </div>
      <div className="dv-pick-list">
        {problem ? <p className="dv-quiet-text">{problem}</p>
          : !ready ? <MorphLoader className="dv-open-shape" label="Opening" />
          : !children.length ? <p className="dv-quiet-text">Empty folder</p>
          : children.map((n) => n.kind === "folder" && !moving.has(n.id)
            ? <button key={n.id} type="button" className="dv-pick-row" onClick={() => setWhere(n.id)}><Kind node={n} /><b>{n.name}</b><i className="go" aria-hidden="true" /></button>
            : <div key={n.id} className="dv-pick-row off"><Kind node={n} /><b>{n.name}</b></div>)}
      </div>
    </div>
  </Dialog>;
}

function CrestPicker({ crest, color, onPick }: { crest: string; color: string; onPick: (crest: string, color: string) => void }) {
  const [catalogue, setCatalogue] = useState<Crests | null>(null);
  useEffect(() => { void drive.crests().then(setCatalogue).catch(() => {}); }, []);
  if (!catalogue) return <MorphLoader className="dv-open-shape" label="Opening" />;
  return <div className="dv-crestpick">
    <div className="dv-colours" role="group" aria-label="Colour">{catalogue.colors.map((c) => <button key={c.id} type="button" aria-pressed={c.id === color} aria-label={c.name} title={c.name} style={{ backgroundColor: c.hex }} onClick={() => onPick(crest, c.id)} />)}</div>
    <div className="dv-crests" role="group" aria-label="Crest">{catalogue.crests.map((c) => <button key={c.id} type="button" aria-pressed={c.id === crest} aria-label={c.name} title={c.name} onClick={() => onPick(c.id, color)}>
      <span className="dv-mark mon" dangerouslySetInnerHTML={{ __html: catalogue.marks[c.id]?.[color] ?? "" }} />{c.jp}
    </button>)}</div>
  </div>;
}

function NewSpaceDialog({ onClose, onMade }: { onClose: () => void; onMade: (space: Space) => void }) {
  const [name, setName] = useState("");
  const [crest, setCrest] = useState("sakura");
  const [color, setColor] = useState("plum");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const make = async () => {
    setBusy(true); setProblem(null);
    try { onMade(await drive.createSpace(name.trim(), crest, color, [])); } catch (error) { setProblem(problemText(error)); setBusy(false); }
  };
  return <Dialog title="New space" onClose={onClose} footer={<>
    <span className={cx("left", problem && "bad")}>{problem}</span>
    <Seal type="button" tone="quiet" onClick={onClose}>Cancel</Seal>
    <Seal type="button" disabled={!name.trim() || busy} onClick={() => void make()}>Make it</Seal>
  </>}>
    <div className="dv-stack">
      <label className="k-field"><span>Name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void make(); }} /></label>
      <div className="k-field"><span>Crest</span><CrestPicker crest={crest} color={color} onPick={(c, col) => { setCrest(c); setColor(col); }} /></div>
    </div>
  </Dialog>;
}

/* ── people and settings (A5) ── */

function SettingsView({ space, me, people, onChanged, onLeft, back }: { space: Space; me: Me; people: Record<string, Person>; onChanged: () => Promise<void>; onLeft: () => void; back: () => void }) {
  const [detail, setDetail] = useState<SpaceDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState(space.name);
  const [find, setFind] = useState("");
  const [addRole, setAddRole] = useState<Role>("viewer");
  const [leaving, setLeaving] = useState(false);
  const owner = space.role === "owner";

  useEffect(() => { void drive.space(space.id).then(setDetail).catch((e) => setProblem(problemText(e, "That space couldn't be opened."))); }, [space.id]);

  const change = async (work: () => Promise<SpaceDetail | { left: true }>, done?: string) => {
    setProblem(null); setNotice(null);
    try {
      const next = await work();
      if ("left" in next) { onLeft(); return; }
      setDetail(next); setNotice(done ?? null); await onChanged();
    } catch (error) { setProblem(problemText(error)); }
  };

  const inSpace = new Set(detail?.memberList.map((m) => m.username.toLowerCase()) ?? []);
  const words = find.trim().toLowerCase().replace(/^@/, "");
  const suggestions = words ? Object.values(people).filter((p) => !inSpace.has(p.username.toLowerCase())
    && (p.name.toLowerCase().includes(words) || p.username.toLowerCase().includes(words))).slice(0, 6) : [];
  const add = (p: Person) => { setFind(""); void change(() => drive.setMember(space.id, p.username, addRole), `${p.name} can ${addRole === "editor" ? "edit" : "view"} ${space.name}.`); };
  const owners = detail?.memberList.filter((m) => m.role === "owner").length ?? 0;
  const lastOwner = owner && owners <= 1;
  const link = detail?.link ? spaceLinkUrl(detail.link) : null;

  return <section className="dv-sheet dv-settings">
    <div className="k-tray">
      <div className="dv-mast">
        <div className="dv-mast-id">
          <Mark space={detail ?? space} size="lg" />
          <div>
            <div className="dv-kicker dv-trail"><button type="button" className="dv-linkbtn" onClick={back}>{space.name}</button><span>/</span><span>Settings</span></div>
            <h1>People and settings</h1>
          </div>
        </div>
      </div>
      {problem ? <p className="admin-notice error" role="alert">{problem}</p> : notice ? <p className="admin-notice success" role="status">{notice}</p> : null}

      <div className="k-compartment"><div className="k-tab"><h2>People</h2></div><div className="k-body">
        {detail?.memberList.map((m) => {
          const person = people[m.username.toLowerCase()];
          const who = person?.name ?? m.username;
          const isMe = m.username.toLowerCase() === me.username.toLowerCase();
          return <div className="dv-person" key={m.username}>
            <span className="who"><Portrait person={person} username={m.username} size={36} /><span><b>{who}</b><small>@{m.username}{isMe ? " · you" : ""}</small></span></span>
            {owner && !isMe ? <Choice aria-label={`Role for ${who}`} value={m.role} options={[{ value: "owner", label: "Owner" }, { value: "editor", label: "Editor" }, { value: "viewer", label: "Viewer" }]} onChange={(next) => {
              const role = next as Role;
              void change(() => drive.setMember(space.id, m.username, role), `${who} is now ${role === "owner" ? "an owner" : role === "editor" ? "an editor" : "a viewer"}.`);
            }} /> : <span className="role-fixed">{roleNames[m.role]}</span>}
            {owner && !isMe ? <button type="button" className="dv-more" aria-label={`Take ${who} out`} title="Take out" onClick={() => void change(() => drive.setMember(space.id, m.username, null), `${who} is out of this space.`)}><Icon name="close" /></button> : <span />}
          </div>;
        })}
        {owner ? <div className="k-form k-after-rows">
          <div className="dv-inv">
            <label className="k-field"><span>Add someone</span><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Name or @username"
              onKeyDown={(e) => { if (e.key === "Enter" && suggestions[0]) { e.preventDefault(); add(suggestions[0]); } }} /></label>
            <label className="k-field"><span>Can</span><Choice value={addRole} onChange={(next) => setAddRole(next as Role)} options={[{ value: "viewer", label: "View" }, { value: "editor", label: "Edit" }, { value: "owner", label: "Own" }]} /></label>
          </div>
          {words ? <div className="dv-sugg">
            {suggestions.map((p) => <button key={p.username} type="button" onClick={() => add(p)}>
              <Portrait person={p} username={p.username} size={28} /><b>{p.name}</b><small>@{p.username}</small>
            </button>)}
            {!suggestions.length ? <p className="dv-quiet-text">No one by that name.</p> : null}
          </div> : null}
        </div> : null}
      </div></div>

      {owner && detail ? <div className="k-compartment"><div className="k-tab"><h2>Share by link</h2></div><div className="k-body"><div className="k-form">
        <label className="k-field"><span>Anyone with the link</span><Choice value={detail.linkAccess ?? "off"} options={[{ value: "off", label: "Off" }, { value: "view", label: "Can view" }, { value: "add", label: "Can add" }]} onChange={(next) => {
          const access = next === "off" ? null : next as LinkAccess;
          void change(() => drive.spaceLink(space.id, access), access ? undefined : "The link no longer works.");
        }} /></label>
        {link ? <div className="dv-addr"><code>{link}</code>
          <span className="k-seal-group"><Seal type="button" compact onClick={() => void navigator.clipboard.writeText(link).then(() => setNotice("Link copied."), () => setProblem("Copy the link by hand."))}><Icon name="copy" />Copy link</Seal></span>
        </div> : null}
      </div></div></div> : null}

      {owner ? <div className="k-compartment"><div className="k-tab"><h2>Space</h2></div><div className="k-body"><div className="k-form">
        <div className="dv-rename-space">
          <label className="k-field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <Seal type="button" disabled={!name.trim() || name.trim() === (detail?.name ?? space.name)} onClick={() => void change(() => drive.editSpace(space.id, { name: name.trim() }), "Renamed.")}>Save</Seal>
        </div>
        <div className="k-field"><span>Crest</span>{detail ? <CrestPicker crest={detail.crest} color={detail.color} onPick={(crest, color) => void change(() => drive.editSpace(space.id, { crest, color }))} /> : null}</div>
      </div></div></div> : null}

      <div className="k-compartment"><div className="k-tab"><h2>Leave</h2></div><div className="k-body">
        <div className="dv-leave">
          <Seal type="button" tone="danger" disabled={lastOwner} onClick={() => setLeaving(true)}><Icon name="door" />Leave {space.name}</Seal>
          {lastOwner ? <span className="dv-quiet-text">Make someone else an owner first.</span> : null}
        </div>
      </div></div>
    </div>
    {leaving ? <Dialog title={`Leave ${space.name}?`} onClose={() => setLeaving(false)} footer={<>
      <span className="left" />
      <Seal type="button" tone="quiet" onClick={() => setLeaving(false)}>Stay</Seal>
      <Seal type="button" tone="danger" onClick={() => { setLeaving(false); void change(() => drive.setMember(space.id, me.username, null)); }}>Leave</Seal>
    </>} /> : null}
  </section>;
}

/* ── trash and recent ── */

function TrashView({ spaces, onToast }: { spaces: Space[]; onToast: (toast: Toast) => void }) {
  const [items, setItems] = useState<DriveNode[] | null>(null);
  /* Days left are counted from when the list arrived. */
  const [now, setNow] = useState(0);
  const load = useCallback(() => drive.trashed().then((list) => { setNow(Date.now()); setItems(list); }).catch(() => setItems([])), []);
  useEffect(() => {
    let live = true;
    drive.trashed().then((list) => { if (live) { setNow(Date.now()); setItems(list); } }, () => { if (live) setItems([]); });
    return () => { live = false; };
  }, []);
  const spaceOf = (id: string) => spaces.find((s) => s.id === id);
  return <section className="dv-sheet">
    <div className="dv-mast"><div className="dv-mast-id"><Wash icon="trash" seed="trash" tint={FOLDER_TINT} tone="folder" size="lg" /><div><div className="dv-kicker">Across your spaces</div><h1>Trash</h1><p>Kept for 30 days.</p></div></div></div>
    <div className="dv-list">
      {!items ? <SkeletonRows rows={5} /> : !items.length ? <div className="dv-empty"><h3>Nothing in the Trash</h3></div>
        : items.map((node) => {
          const space = spaceOf(node.spaceId);
          const left = node.trashedAt ? Math.max(0, 30 - Math.floor((now - node.trashedAt) / 86400000)) : null;
          return <div className="dv-r trashed" key={node.id}>
            <Kind node={node} plain />
            <div className="nm"><b>{node.name}</b><small>{space?.name ?? ""}{left !== null ? ` · ${left === 1 ? "1 day" : `${left} days`} left` : ""}</small></div>
            <span className="num c-size">{node.kind === "folder" ? "—" : readableSize(node.size)}</span>
            {space && space.role !== "viewer" ? <Seal type="button" tone="quiet" compact onClick={async () => {
              try { await drive.restore(node.id); onToast({ text: `“${node.name}” is back.` }); await load(); } catch (error) { onToast({ text: problemText(error) }); }
            }}><Icon name="restore" />Put back</Seal> : <span />}
          </div>;
        })}
    </div>
  </section>;
}

function RecentView({ spaces, people, onOpen }: { spaces: Space[]; people: Record<string, Person>; onOpen: (node: DriveNode) => void }) {
  const [items, setItems] = useState<DriveNode[] | null>(null);
  useEffect(() => { void drive.recent().then(setItems).catch(() => setItems([])); }, []);
  const spaceName = (id: string) => spaces.find((s) => s.id === id)?.name ?? "";
  return <section className="dv-sheet">
    <div className="dv-mast"><div className="dv-mast-id"><Wash icon="clock" seed="recent" tint={FOLDER_TINT} tone="folder" size="lg" /><div><div className="dv-kicker">Across your spaces</div><h1>Recent</h1></div></div></div>
    <div className="dv-list">
      {!items ? <SkeletonRows rows={5} /> : !items.length ? <div className="dv-empty"><h3>Nothing yet</h3></div>
        : items.map((node) => <div className="dv-r recent" key={node.id}>
            <Kind node={node} />
            <div className="nm"><button type="button" onClick={() => onOpen(node)}><b>{node.name}</b><small>{spaceName(node.spaceId)}<span className="dv-m"> · {readableSize(node.size)}</span></small></button></div>
            <span className="num c-size">{readableSize(node.size)}</span>
            <span className="num dv-when c-when"><Portrait person={people[node.createdBy?.toLowerCase()]} username={node.createdBy || node.guest || "?"} size={22} /><span>{when(node.updatedAt)}</span></span>
          </div>)}
    </div>
  </section>;
}

/* ── the upload tray ── */

function UploadTray({ uploads, guest, onClear, onCancel, onToast }: { uploads: Upload[]; guest?: boolean; onClear: () => void; onCancel: (id: string) => void; onToast: (toast: Toast) => void }) {
  const going = uploads.filter((u) => !u.done && !u.failed);
  return <div className="dv-uploads" role="region" aria-label="Uploads">
    <header><span>{going.length ? `Uploading ${uploads.length - going.length + 1} of ${uploads.length}` : `${uploads.length} ${uploads.length === 1 ? "upload" : "uploads"}`}</span>
      {!going.length ? <button type="button" className="dv-linkbtn" onClick={onClear}>Close</button> : null}</header>
    <div className="dv-up-list">
      {uploads.map((u) => <div className="dv-up" key={u.id}>
        <span className="dv-kind"><span className="ext">{extension(u.name)}</span></span>
        <div><b>{u.name}</b>
          {u.failed ? <small className="err">{u.failed}</small>
            : u.done ? <small>Done · {readableSize(u.size)} · in {u.spaceName}</small>
            : <><InkWave className="dv-wave" label={`Uploading ${u.name}`} value={u.size ? u.sent / u.size : 1} /><small>{readableSize(u.sent)} of {readableSize(u.size)}</small></>}
        </div>
        {u.done ? guest ? <span className="dv-done" aria-label="Done"><Icon name="check" /></span> : <Seal type="button" tone="quiet" compact onClick={async () => {
          try { await navigator.clipboard.writeText(await drive.link(u.done!)); onToast({ text: "Public link copied." }); } catch (error) { onToast({ text: problemText(error) }); }
        }}><Icon name="link" />Copy link</Seal>
          : <button type="button" className="dv-more" aria-label={u.failed ? "Dismiss" : "Cancel"} onClick={() => onCancel(u.id)}><Icon name="close" /></button>}
      </div>)}
    </div>
  </div>;
}
