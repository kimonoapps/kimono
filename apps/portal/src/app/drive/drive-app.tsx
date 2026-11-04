"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Seal } from "@kimono/ui";
import {
  contentUrl, drive, DriveProblem, extension, kindOf, linkUrl, readableSize, upload, when,
  type Crests, type DriveNode, type Folder, type Person, type Role, type Space, type SpaceDetail,
} from "./api";
import { Icon } from "./icons";

/*
 * 帳 Kimono Drive on the web, layout A (Ledger). One page: the sidebar of
 * spaces, the sheet for where you are, and the tray of uploads, which keeps
 * going as you move between folders. Where you are lives in the address
 * (?space=…&folder=…), so it can be shared and survives a reload.
 */

type Me = { username: string; name: string };
type Upload = { id: string; name: string; size: number; sent: number; folderId: string; spaceName: string; done?: string; failed?: string; controller: AbortController };
type Toast = { text: string; undo?: () => Promise<void> };

const roleWords: Record<Role, string> = { owner: "you own it", editor: "you can edit", viewer: "you can view" };
const roleNames: Record<Role, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

export function DriveApp({ me }: { me: Me }) {
  const params = useSearchParams();
  const view = params.get("view");
  const spaceParam = params.get("space");
  const folderParam = params.get("folder");

  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [making, setMaking] = useState(false);
  const [landed, setLanded] = useState(0);

  const loadSpaces = useCallback(() => drive.spaces().then(
    (list) => { setSpaces(list); setProblem(null); },
    (error) => { setProblem(error instanceof Error ? error.message : "Drive isn't answering."); },
  ), []);
  useEffect(() => {
    let live = true;
    drive.spaces().then((list) => { if (live) setSpaces(list); }, (error) => { if (live) setProblem(error instanceof Error ? error.message : "Drive isn't answering."); });
    return () => { live = false; };
  }, []);
  useEffect(() => { void drive.people().then((list) => setPeople(Object.fromEntries(list.map((p) => [p.username.toLowerCase(), p])))).catch(() => {}); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 8000); return () => clearTimeout(timer); }, [toast]);

  /* Where you are in Drive is this page's own state, kept in the address: no crossing, just the next entry in history. */
  const go = useCallback((to: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(to)) if (value) next.set(key, value);
    window.history.pushState(null, "", `/drive${next.size ? `?${next}` : ""}`);
  }, []);

  const current = spaces?.find((s) => s.id === spaceParam) ?? (view ? null : spaces?.[0] ?? null);

  const startUploads = useCallback((files: File[], folderId: string, spaceName: string) => {
    const added = files.map((file): [File, Upload] => [file, { id: crypto.randomUUID(), name: file.name, size: file.size, sent: 0, folderId, spaceName, controller: new AbortController() }]);
    setUploads((list) => [...list, ...added.map(([, item]) => item)]);
    for (const [file, item] of added) {
      const update = (change: Partial<Upload>) => setUploads((list) => list.map((u) => u.id === item.id ? { ...u, ...change } : u));
      upload(file, folderId, (sent) => update({ sent }), item.controller.signal)
        .then((fileId) => { update({ sent: item.size, done: fileId }); setLanded((n) => n + 1); })
        .catch((error) => { if (!item.controller.signal.aborted) update({ failed: error instanceof Error ? error.message : "That file couldn't be uploaded." }); });
    }
  }, []);

  const yours = spaces?.filter((s) => s.role === "owner") ?? [];
  const shared = spaces?.filter((s) => s.role !== "owner") ?? [];

  return <div className="dv">
    <div className="dv-body">
      <aside className="dv-side">
        <nav className="dv-nav">
          <button type="button" aria-current={view === "recent" ? "page" : undefined} onClick={() => go({ view: "recent" })}><Icon name="clock" />Recent</button>
        </nav>
        <div>
          <div className="dv-side-label">Your spaces <button type="button" aria-label="New space" onClick={() => setMaking(true)}><Icon name="plus" /></button></div>
          <div className="dv-nav">{yours.map((space) => <SpaceLink key={space.id} space={space} here={!view && current?.id === space.id} people={people} onOpen={() => go({ space: space.id })} />)}</div>
          {spaces && !yours.length ? <p className="dv-quiet-text" style={{ padding: "4px 12px" }}>None yet.</p> : null}
        </div>
        {shared.length ? <div>
          <div className="dv-side-label">Shared with you</div>
          <div className="dv-nav">{shared.map((space) => <SpaceLink key={space.id} space={space} here={!view && current?.id === space.id} people={people} onOpen={() => go({ space: space.id })} />)}</div>
        </div> : null}
        <nav className="dv-nav">
          <button type="button" aria-current={view === "trash" ? "page" : undefined} onClick={() => go({ view: "trash" })}><Icon name="trash" />Trash</button>
        </nav>
      </aside>

      {problem && !spaces ? <section className="dv-sheet"><div className="dv-empty"><h3>Drive isn&apos;t answering</h3><p>{problem}</p></div></section>
        : !spaces ? <section className="dv-sheet"><div className="dv-empty"><p>Opening Drive…</p></div></section>
        : view === "trash" ? <TrashView onToast={setToast} spaces={spaces} />
        : view === "recent" ? <RecentView spaces={spaces} people={people} onOpen={(node) => go({ space: node.spaceId, folder: node.parentId, file: node.id })} />
        : current && view === "settings" ? <SettingsView key={current.id} space={current} me={me} people={people} onChanged={loadSpaces} onLeft={() => { void loadSpaces(); go({}); }} back={() => go({ space: current.id })} />
        : current ? <SpaceView
            key={current.id}
            space={current}
            folderId={folderParam || current.rootId}
            openFile={params.get("file")}
            people={people}
            landed={landed}
            onGo={(folder, file) => go({ space: current.id, folder: folder === current.rootId ? null : folder, file: file ?? null })}
            onSettings={() => go({ space: current.id, view: "settings" })}
            onUpload={startUploads}
            onToast={setToast}
          />
        : <section className="dv-sheet"><div className="dv-empty">
            <h3>Spaces hold your files</h3>
            <p>Make one for yourself, or for the people you share things with. Everyone in a space can open everything in it.</p>
            <div className="k-seal-group"><Seal type="button" onClick={() => setMaking(true)}>New space</Seal></div>
          </div></section>}
    </div>

    {uploads.length ? <UploadTray uploads={uploads} onClear={() => setUploads((list) => list.filter((u) => !u.done && !u.failed))} onCancel={(id) => setUploads((list) => {
      list.find((u) => u.id === id)?.controller.abort();
      return list.filter((u) => u.id !== id);
    })} onToast={setToast} /> : null}

    {toast ? <div className="dv-toast" role="status" style={{ position: "fixed" }}>
      {toast.text}
      {toast.undo ? <Seal type="button" tone="quiet" compact onClick={async () => { const undo = toast.undo!; setToast(null); await undo(); }}>Undo</Seal> : null}
    </div> : null}

    {making ? <NewSpaceDialog onClose={() => setMaking(false)} onMade={async (space) => { setMaking(false); await loadSpaces(); go({ space: space.id }); }} /> : null}
  </div>;
}

/* ── the sidebar ── */

function Mark({ space, size = "" }: { space: Pick<Space, "mark">; size?: string }) {
  return <span className={`dv-mark mon ${size}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: space.mark ?? "" }} />;
}

function SpaceLink({ space, here, people, onOpen }: { space: Space; here: boolean; people: Record<string, Person>; onOpen: () => void }) {
  const owner = people[space.createdBy?.toLowerCase()];
  const meta = space.role === "owner"
    ? space.members === 1 ? "Only you" : `${space.members} people`
    : `${owner?.name.split(" ")[0] ?? space.createdBy}'s · ${space.role === "editor" ? "you edit" : "you view"}`;
  return <button type="button" className="dv-space" aria-current={here ? "page" : undefined} onClick={onOpen}>
    <Mark space={space} /><span><b>{space.name}</b><small>{meta}</small></span>
  </button>;
}

function Portrait({ person, username, size = 28 }: { person?: Person; username: string; size?: number }) {
  const style = { "--s": `${size}px` } as React.CSSProperties;
  const name = person?.name || username;
  // eslint-disable-next-line @next/next/no-img-element -- a portrait from this Portal, already sized
  if (person?.picture) return <span className="pfp" style={style} role="img" aria-label={name}><img src={person.picture} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /></span>;
  return <span className="pfp initials" style={style} role="img" aria-label={name}>{name.slice(0, 1).toUpperCase()}</span>;
}

/* ── a space ── */

type Sort = "name" | "modified" | "size";

function SpaceView({ space, folderId, openFile, people, landed, onGo, onSettings, onUpload, onToast }: {
  space: Space; folderId: string; openFile: string | null; people: Record<string, Person>; landed: number;
  onGo: (folder: string, file?: string | null) => void; onSettings: () => void;
  onUpload: (files: File[], folderId: string, spaceName: string) => void; onToast: (toast: Toast) => void;
}) {
  const [folder, setFolder] = useState<Folder | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /* A selection belongs to the folder it was made in. */
  const [selection, setSelection] = useState<{ folder: string; ids: Set<string> }>({ folder: folderId, ids: new Set() });
  const selected = selection.folder === folderId ? selection.ids : new Set<string>();
  const setSelected = useCallback((next: Set<string> | ((current: Set<string>) => Set<string>)) => setSelection((now) => {
    const base = now.folder === folderId ? now.ids : new Set<string>();
    return { folder: folderId, ids: typeof next === "function" ? next(base) : next };
  }), [folderId]);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<DriveNode[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [sort, setSort] = useState<Sort>("name");
  const [query, setQuery] = useState("");
  const [results, setFound] = useState<DriveNode[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [detail, setDetail] = useState<SpaceDetail | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const canEdit = space.role !== "viewer";

  const load = useCallback(() => drive.folder(folderId).then(
    (loaded) => { setFolder(loaded); setProblem(null); },
    (error) => { setProblem(error instanceof Error ? error.message : "That folder couldn't be opened."); },
  ), [folderId]);
  useEffect(() => {
    let live = true;
    drive.folder(folderId).then(
      (loaded) => { if (live) { setFolder(loaded); setProblem(null); } },
      (error) => { if (live) setProblem(error instanceof Error ? error.message : "That folder couldn't be opened."); },
    );
    return () => { live = false; };
  }, [folderId, landed]);
  useEffect(() => { void drive.space(space.id).then(setDetail).catch(() => {}); }, [space.id]);
  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(() => { void drive.search(query).then((items) => setFound(items.filter((n) => n.spaceId === space.id))).catch(() => setFound([])); }, 200);
    return () => clearTimeout(timer);
  }, [query, space.id]);
  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const act = useCallback(async (work: () => Promise<unknown>, done?: Toast) => {
    try { await work(); await load(); if (done) onToast(done); } catch (error) { onToast({ text: error instanceof Error ? error.message : "That didn't work." }); }
  }, [load, onToast]);

  /* Search results stand in for the folder only while there's something to search for. */
  const found = query.trim() ? results : null;
  const rows = useMemo(() => {
    const items = found ?? folder?.children ?? [];
    const sorted = [...items].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      : sort === "modified" ? b.updatedAt - a.updatedAt : b.size - a.size);
    return found ? sorted : [...sorted.filter((n) => n.kind === "folder"), ...sorted.filter((n) => n.kind === "file")];
  }, [folder, found, sort]);

  const trash = (nodes: DriveNode[]) => act(async () => { for (const node of nodes) await drive.trash(node.id); setSelected(new Set()); }, {
    text: `${nodes.length === 1 ? `“${nodes[0].name}”` : `${nodes.length} items`} moved to Trash. ${nodes.length === 1 ? "It stays" : "They stay"} there for 30 days.`,
    undo: async () => { for (const node of nodes) await drive.restore(node.id).catch(() => {}); await load(); },
  });
  const copyLink = (node: DriveNode) => act(async () => {
    const url = await drive.link(node.id);
    await navigator.clipboard.writeText(url).catch(() => {});
  }, { text: "Link copied. Anyone with it can open the file." });

  const chosen = rows.filter((n) => selected.has(n.id));
  const opened = openFile ? rows.find((n) => n.id === openFile) ?? null : null;
  const members = detail?.memberList ?? [];

  return <section className="dv-sheet"
    onDragOver={(event) => { if (canEdit && event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
    onDrop={(event) => {
      event.preventDefault(); setDragging(false);
      const files = Array.from(event.dataTransfer.files);
      if (canEdit && files.length && folder) onUpload(files, folder.folder.id, space.name);
    }}>
    <div className="dv-mast">
      <div className="dv-mast-id">
        <Mark space={space} size="lg" />
        <div>
          <div className="dv-kicker">Space · {roleWords[space.role]}</div>
          <h1>{space.name}</h1>
          <p style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="pfps">{members.slice(0, 6).map((m) => <Portrait key={m.username} person={people[m.username.toLowerCase()]} username={m.username} size={26} />)}</span>
            <button type="button" className="dv-linkbtn" style={{ padding: 0, minHeight: 0 }} onClick={onSettings}>{space.members === 1 ? "Only you" : `${space.members} people`}</button>
          </p>
        </div>
      </div>
      {canEdit ? <div className="k-seal-group">
        <Seal type="button" onClick={() => picker.current?.click()}><Icon name="upload" />Upload</Seal>
        <Seal type="button" tone="quiet" onClick={() => setNaming(true)}><Icon name="folder" />New folder</Seal>
        <input ref={picker} type="file" multiple hidden onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length && folder) onUpload(files, folder.folder.id, space.name);
          event.target.value = "";
        }} />
      </div> : null}
    </div>

    {chosen.length ? <div className="dv-selbar">
      <div className="count"><Check on={chosen.length === rows.length ? true : "part"} onClick={() => setSelected(new Set())} />{chosen.length} selected <small>· {readableSize(chosen.reduce((sum, n) => sum + n.size, 0))}</small></div>
      <div className="acts">
        {canEdit ? <Seal type="button" tone="quiet" compact onClick={() => setMoving(chosen)}><Icon name="move" />Move to…</Seal> : null}
        {canEdit ? <Seal type="button" tone="danger" compact onClick={() => void trash(chosen)}><Icon name="trash" />Move to Trash</Seal> : null}
        <button type="button" className="dv-linkbtn" onClick={() => setSelected(new Set())}>Clear</button>
      </div>
    </div> : <div className="dv-toolbar">
      <div className="dv-crumbs">
        {found ? <b>Found in {space.name}</b> : (folder ? [...folder.path, folder.folder] : []).map((node, index, all) => index === all.length - 1
          ? <b key={node.id}>{index === 0 ? space.name : node.name}</b>
          : <span key={node.id} style={{ display: "contents" }}><button type="button" onClick={() => onGo(node.id)}>{index === 0 ? space.name : node.name}</button><span className="sep">/</span></span>)}
      </div>
      <div className="dv-tools">
        <label className="dv-search"><Icon name="search" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this space" aria-label="Search this space" /></label>
        <label className="dv-select"><select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
          <option value="name">Name, A–Z</option><option value="modified">Newest first</option><option value="size">Largest first</option>
        </select><i className="k-cue" /></label>
      </div>
    </div>}

    <div className="dv-list">
      <div className="dv-lhead">
        <Check on={rows.length > 0 && chosen.length === rows.length ? true : chosen.length ? "part" : false} onClick={() => setSelected(chosen.length ? new Set() : new Set(rows.map((n) => n.id)))} />
        <span /><span className={sort === "name" ? "sorted" : ""}>Name{sort === "name" ? " ↑" : ""}</span><span>Sharing</span><span className={sort === "size" ? "sorted" : ""}>Size</span><span className={sort === "modified" ? "sorted" : ""}>Modified</span><span />
      </div>
      {problem ? <div className="dv-empty"><p>{problem}</p></div>
        : !folder ? <div className="dv-empty"><p>Opening…</p></div>
        : !rows.length ? <div className="dv-empty">
            <h3>{found ? "Nothing by that name" : "Nothing here yet"}</h3>
            <p>{found ? "Try another word, or look in another space." : canEdit ? "Drop files here, or upload them. Everyone in this space will see them." : "When someone adds files, they'll be here."}</p>
          </div>
        : rows.map((node) => <div key={node.id} style={{ display: "contents" }}>
            <div className={`dv-r ${selected.has(node.id) || opened?.id === node.id ? "sel" : ""}`}>
              <Check on={selected.has(node.id)} ghost={!selected.size} onClick={() => setSelected((s) => { const next = new Set(s); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })} />
              <Kind node={node} />
              <div className="nm">
                {renaming === node.id ? <RenameField node={node} onDone={(name) => { setRenaming(null); if (name && name !== node.name) void act(() => drive.rename(node.id, name)); }} />
                  : <button type="button" onClick={() => node.kind === "folder" ? onGo(node.id) : onGo(folder.folder.id, opened?.id === node.id ? null : node.id)}>
                      <b>{node.name}</b><small>{node.kind === "folder" ? "Folder" : `${extension(node.name)}${node.guest ? ` · added by ${node.guest}` : ""}`}</small>
                    </button>}
              </div>
              <span>{node.link ? <span className="dv-pub"><Icon name="link" />Public link</span> : node.kind === "file" ? <span className="dv-quiet-text">Space only</span> : null}</span>
              <span className="num">{node.kind === "folder" ? "—" : readableSize(node.size)}</span>
              <span className="num who" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Portrait person={people[node.createdBy?.toLowerCase()]} username={node.createdBy || "?"} size={22} /><span>{when(node.updatedAt)}</span>
              </span>
              <span style={{ position: "relative" }}>
                <button type="button" className={`dv-more ${menu === node.id ? "open" : ""}`} aria-label={`Actions for ${node.name}`} onClick={(event) => { event.stopPropagation(); setMenu(menu === node.id ? null : node.id); }}><Icon name="more" /></button>
                {menu === node.id ? <div className="dv-menu" style={{ right: 0, top: 36 }} onClick={(event) => event.stopPropagation()}>
                  {node.kind === "folder" ? <button type="button" onClick={() => { setMenu(null); onGo(node.id); }}><Icon name="open" />Open</button>
                    : <>
                      <button type="button" onClick={() => { setMenu(null); onGo(folder.folder.id, node.id); }}><Icon name="open" />Open</button>
                      <button type="button" onClick={() => { setMenu(null); window.location.href = `${contentUrl(node)}?download=1`; }}><Icon name="download" />Download</button>
                      {canEdit || node.link ? <button type="button" onClick={() => { setMenu(null); void copyLink(node); }}><Icon name="link" />Copy public link</button> : null}
                    </>}
                  {canEdit ? <>
                    <hr />
                    <button type="button" onClick={() => { setMenu(null); setRenaming(node.id); }}><Icon name="rename" />Rename</button>
                    <button type="button" onClick={() => { setMenu(null); setMoving([node]); }}><Icon name="move" />Move to…</button>
                    {node.link ? <button type="button" className="danger" onClick={() => { setMenu(null); void act(() => drive.unlink(node.id), { text: "The link no longer works." }); }}><Icon name="link" />Turn off link</button> : null}
                    <hr />
                    <button type="button" className="danger" onClick={() => { setMenu(null); void trash([node]); }}><Icon name="trash" />Move to Trash</button>
                  </> : null}
                </div> : null}
              </span>
            </div>
            {opened?.id === node.id ? <Drawer node={node} canEdit={canEdit} people={people} onCopy={() => void copyLink(node)} onUnlink={() => void act(() => drive.unlink(node.id), { text: "The link no longer works." })} onClose={() => onGo(folder.folder.id)} /> : null}
          </div>)}
    </div>

    {dragging ? <div className="dv-drop"><div>
      <span className="arrow"><Icon name="upload" /></span>
      <b>Drop to keep in {folder && folder.path.length ? folder.folder.name : space.name}</b>
      <small>Everyone in {space.name} will see them</small>
    </div></div> : null}

    {naming && folder ? <NameDialog title="New folder" action="Make it" onClose={() => setNaming(false)} onSave={async (name) => { await drive.createFolder(folder.folder.id, name); setNaming(false); await load(); }} /> : null}
    {moving && folder ? <MoveDialog space={space} nodes={moving} onClose={() => setMoving(null)} onMove={async (target) => {
      setMoving(null);
      await act(async () => { for (const node of moving) await drive.move(node.id, target); setSelected(new Set()); }, { text: `Moved ${moving.length === 1 ? `“${moving[0].name}”` : `${moving.length} items`}.` });
    }} /> : null}
  </section>;
}

function Check({ on, ghost, onClick }: { on: boolean | "part"; ghost?: boolean; onClick: () => void }) {
  return <button type="button" className={`dv-check ${on === "part" ? "part" : on ? "on" : ""} ${ghost && !on ? "ghost" : ""}`} aria-pressed={on === true} aria-label="Select" onClick={onClick}>
    {on === true ? <Icon name="check" /> : null}
  </button>;
}

function Kind({ node }: { node: DriveNode }) {
  const kind = kindOf(node);
  if (kind === "folder") return <span className="dv-kind folder"><Icon name="folder" /></span>;
  return <span className="dv-kind"><span className="ext">{extension(node.name)}</span></span>;
}

function RenameField({ node, onDone }: { node: DriveNode; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(node.name);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = field.current;
    if (!input) return;
    input.focus();
    /* The name without its extension is what people usually change. */
    const dot = node.kind === "file" ? node.name.lastIndexOf(".") : -1;
    input.setSelectionRange(0, dot > 0 ? dot : node.name.length);
  }, [node]);
  return <input ref={field} value={value} aria-label="New name" onChange={(e) => setValue(e.target.value)}
    onKeyDown={(e) => { if (e.key === "Enter") onDone(value.trim()); if (e.key === "Escape") onDone(null); }}
    onBlur={() => onDone(value.trim())} />;
}

/* ── a file's drawer: preview and its public link ── */

function Drawer({ node, canEdit, people, onCopy, onUnlink, onClose }: { node: DriveNode; canEdit: boolean; people: Record<string, Person>; onCopy: () => void; onUnlink: () => void; onClose: () => void }) {
  const kind = kindOf(node);
  const by = people[node.createdBy?.toLowerCase()];
  const url = linkUrl(node);
  return <div className="dv-drawer"><div className="dv-drawer-grid">
    <div className="dv-preview">
      {/* eslint-disable-next-line @next/next/no-img-element -- a preview of the file itself, from Drive */}
      {kind === "image" ? <img src={contentUrl(node)} alt="" />
        : kind === "video" ? <video src={contentUrl(node)} controls preload="metadata" />
        : kind === "audio" ? <audio src={contentUrl(node)} controls style={{ position: "absolute", left: 8, right: 8, bottom: 8, width: "calc(100% - 16px)" }} />
        : <span className="ext">{extension(node.name)}</span>}
    </div>
    <div>
      <div className="dv-head">
        <div>
          <div className="kick" style={{ display: "flex", alignItems: "center", gap: 8 }}><Portrait person={by} username={node.createdBy || "?"} size={22} /><span>{readableSize(node.size)} · {by?.name.split(" ")[0] ?? node.createdBy}, {when(node.updatedAt).toLowerCase()}</span></div>
          <h2>{node.name}</h2>
        </div>
        <div className="dv-acts">
          <Seal type="button" tone="quiet" compact onClick={() => { window.location.href = `${contentUrl(node)}?download=1`; }}>Download</Seal>
          <Seal type="button" tone="quiet" compact onClick={() => window.open(contentUrl(node), "_blank", "noopener")}>Open full size</Seal>
          <button type="button" className="dv-more" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
      </div>
      {url ? <>
        <div className="dv-addr"><code>{url}</code>
          <span className="k-seal-group" style={{ flexWrap: "nowrap", gap: 8 }}>
            <Seal type="button" compact onClick={onCopy}>Copy link</Seal>
            {canEdit ? <Seal type="button" tone="danger" compact onClick={onUnlink}>Turn off link</Seal> : null}
          </span>
        </div>
        <p>Anyone with this address can open the file. Turning it off stops the address at once; a new link later gets a new address.</p>
      </> : canEdit ? <>
        <div className="k-seal-group"><Seal type="button" onClick={onCopy}><Icon name="link" />Make public link</Seal></div>
        <p>Only people in this space can open it. A public link lets anyone with the address open just this file; it&apos;s copied as it&apos;s made.</p>
      </> : <p>Only people in this space can open it.</p>}
    </div>
  </div></div>;
}

/* ── dialogs ── */

function Dialog({ title, lead, children, footer, onClose }: { title: string; lead?: string; children?: React.ReactNode; footer: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  return <div className="dv-shade" onClick={onClose}>
    <div className="dv-dialog" role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
      <header><h2>{title}</h2>{lead ? <p>{lead}</p> : null}</header>
      {children}
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
    {problem ? <span className="left" style={{ color: "var(--k-suo-deep)" }}>{problem}</span> : <span className="left" />}
    <Seal type="button" tone="quiet" onClick={onClose}>Cancel</Seal>
    <Seal type="button" disabled={!name.trim() || busy} onClick={() => void save()}>{action}</Seal>
  </>}>
    <div style={{ padding: "0 26px 18px" }}>
      <label className="k-field"><span>Name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void save(); }} /></label>
    </div>
  </Dialog>;
}

function MoveDialog({ space, nodes, onClose, onMove }: { space: Space; nodes: DriveNode[]; onClose: () => void; onMove: (folderId: string) => Promise<void> }) {
  const [at, setAt] = useState<Folder | null>(null);
  const [where, setWhere] = useState(space.rootId);
  useEffect(() => { void drive.folder(where).then(setAt).catch(() => {}); }, [where]);
  const moving = new Set(nodes.map((n) => n.id));
  const here = at ? [...at.path, at.folder] : [];
  return <Dialog title={nodes.length === 1 ? `Move “${nodes[0].name}”` : `Move ${nodes.length} items`} lead={`Pick a folder in ${space.name}.`} onClose={onClose} footer={<>
    <span className="left">To {here.length > 1 ? here.slice(1).map((n) => n.name).join(" / ") : space.name}</span>
    <Seal type="button" tone="quiet" onClick={onClose}>Cancel</Seal>
    <Seal type="button" onClick={() => void onMove(where)}>Move here</Seal>
  </>}>
    <div className="dv-folders-pick">
      {at && at.path.length ? <button type="button" onClick={() => setWhere(at.folder.parentId ?? space.rootId)}><Icon name="back" />Up to {at.path.length === 1 ? space.name : at.path[at.path.length - 1].name}</button> : null}
      {at?.children.filter((n) => n.kind === "folder" && !moving.has(n.id)).map((n) => <button key={n.id} type="button" onClick={() => setWhere(n.id)}><Icon name="folder" />{n.name}</button>)}
      {at && !at.children.some((n) => n.kind === "folder" && !moving.has(n.id)) ? <p className="dv-quiet-text" style={{ padding: "8px 10px" }}>No folders inside.</p> : null}
    </div>
  </Dialog>;
}

function CrestPicker({ crest, color, onPick }: { crest: string; color: string; onPick: (crest: string, color: string) => void }) {
  const [catalogue, setCatalogue] = useState<Crests | null>(null);
  useEffect(() => { void drive.crests().then(setCatalogue).catch(() => {}); }, []);
  if (!catalogue) return <p className="dv-quiet-text">Loading crests…</p>;
  return <div>
    <div className="dv-colours">{catalogue.colors.map((c) => <button key={c.id} type="button" aria-pressed={c.id === color} aria-label={c.name} title={c.name} style={{ backgroundColor: c.hex }} onClick={() => onPick(crest, c.id)} />)}</div>
    <div className="dv-crests">{catalogue.crests.map((c) => <button key={c.id} type="button" aria-pressed={c.id === crest} aria-label={c.name} onClick={() => onPick(c.id, color)}>
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
  return <Dialog title="New space" lead="A space holds files for you and the people you add. You can add them next." onClose={onClose} footer={<>
    {problem ? <span className="left" style={{ color: "var(--k-suo-deep)" }}>{problem}</span> : <span className="left" />}
    <Seal type="button" tone="quiet" onClick={onClose}>Cancel</Seal>
    <Seal type="button" disabled={!name.trim() || busy} onClick={async () => {
      setBusy(true); setProblem(null);
      try { onMade(await drive.createSpace(name.trim(), crest, color, [])); } catch (error) { setProblem(error instanceof Error ? error.message : "That didn't work."); setBusy(false); }
    }}>Make it</Seal>
  </>}>
    <div style={{ padding: "0 26px 18px", display: "grid", gap: 14 }}>
      <label className="k-field"><span>Name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
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
  const owner = space.role === "owner";

  useEffect(() => { void drive.space(space.id).then(setDetail).catch((e) => setProblem(e instanceof Error ? e.message : "That space couldn't be opened.")); }, [space.id]);

  const change = async (work: () => Promise<SpaceDetail | { left: true }>, done?: string) => {
    setProblem(null);
    try {
      const next = await work();
      if ("left" in next) { onLeft(); return; }
      setDetail(next); setNotice(done ?? null); await onChanged();
    } catch (error) { setProblem(error instanceof Error ? error.message : "That didn't work."); }
  };

  const inSpace = new Set(detail?.memberList.map((m) => m.username.toLowerCase()) ?? []);
  const suggestions = find.trim() ? Object.values(people).filter((p) => !inSpace.has(p.username.toLowerCase())
    && (p.name.toLowerCase().includes(find.trim().toLowerCase()) || p.username.toLowerCase().includes(find.trim().toLowerCase().replace(/^@/, "")))).slice(0, 6) : [];

  return <section className="dv-sheet" style={{ background: "none", boxShadow: "none", border: 0 }}>
    <div className="k-tray">
      <div className="dv-mast" style={{ border: 0 }}>
        <div className="dv-mast-id">
          <Mark space={detail ?? space} size="lg" />
          <div>
            <div className="dv-kicker" style={{ display: "flex", gap: 6 }}><button type="button" className="dv-linkbtn" style={{ padding: 0, minHeight: 0 }} onClick={back}>{space.name}</button> / Settings</div>
            <h1>People and settings</h1>
            <p>Everyone here can open every file in {space.name}.</p>
          </div>
        </div>
      </div>
      {problem ? <p className="admin-notice error">{problem}</p> : notice ? <p className="admin-notice success">{notice}</p> : null}

      <div className="k-compartment"><div className="k-tab"><h2>People</h2></div><div className="k-body">
        {detail?.memberList.map((m) => {
          const person = people[m.username.toLowerCase()];
          const isMe = m.username.toLowerCase() === me.username.toLowerCase();
          return <div className="dv-person" key={m.username}>
            <span className="who" style={{ display: "flex", alignItems: "center", gap: 12 }}><Portrait person={person} username={m.username} size={36} /><span><b>{person?.name ?? m.username}</b><small>@{m.username}{isMe ? " · you" : ""}</small></span></span>
            {owner && !isMe ? <label className="k-field"><select aria-label={`Role for ${person?.name ?? m.username}`} value={m.role} onChange={(e) => void change(() => drive.setMember(space.id, m.username, e.target.value as Role), `${person?.name ?? m.username} is now ${e.target.value === "owner" ? "an owner" : `a${e.target.value === "editor" ? "n editor" : " viewer"}`}.`)}>
              <option value="owner">Owner</option><option value="editor">Editor</option><option value="viewer">Viewer</option>
            </select></label> : <span className="role-fixed">{roleNames[m.role]}</span>}
            {owner && !isMe ? <button type="button" className="dv-more" aria-label={`Take ${person?.name ?? m.username} out`} onClick={() => void change(() => drive.setMember(space.id, m.username, null), `${person?.name ?? m.username} is out of this space.`)}><Icon name="close" /></button> : <span />}
          </div>;
        })}
        {owner ? <div className="k-form k-after-rows">
          <div className="dv-inv">
            <label className="k-field"><span>Add someone with a Kimono account</span><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Name or @username" /></label>
            <label className="k-field"><span>Can</span><select value={addRole} onChange={(e) => setAddRole(e.target.value as Role)}><option value="viewer">View</option><option value="editor">Edit</option></select></label>
          </div>
          {find.trim() ? <div className="dv-sugg">
            {suggestions.map((p) => <button key={p.username} type="button" className="dv-linkbtn" style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textDecoration: "none", padding: "8px 12px" }}
              onClick={() => { setFind(""); void change(() => drive.setMember(space.id, p.username, addRole), `${p.name} can ${addRole === "editor" ? "edit" : "view"} ${space.name}.`); }}>
              <Portrait person={p} username={p.username} size={28} /><b>{p.name}</b><small>@{p.username}</small>
            </button>)}
            {!suggestions.length ? <p className="dv-quiet-text" style={{ padding: "8px 12px", margin: 0 }}>No Kimono account by that name.</p> : null}
          </div> : null}
        </div> : null}
      </div></div>

      <div className="k-compartment"><div className="k-tab"><h2>What each role can do</h2></div><div className="k-body">
        <p className="k-note"><strong>View</strong> opens and downloads. <strong>Edit</strong> also uploads, renames, moves, deletes and makes public links. The <strong>owner</strong> also manages people and renames the space.</p>
      </div></div>

      {owner ? <div className="k-compartment"><div className="k-tab"><h2>Space</h2></div><div className="k-body"><div className="k-form">
        <label className="k-field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="k-form-actions"><Seal type="button" disabled={!name.trim() || name.trim() === (detail?.name ?? space.name)} onClick={() => void change(() => drive.editSpace(space.id, { name: name.trim() }), "Renamed.")}>Save</Seal></div>
        <div className="k-field"><span>Crest</span>{detail ? <CrestPicker crest={detail.crest} color={detail.color} onPick={(crest, color) => void change(() => drive.editSpace(space.id, { crest, color }))} /> : null}</div>
      </div></div></div> : null}

      <div className="k-compartment"><div className="k-tab"><h2>Leave</h2></div><div className="k-body">
        <p className="k-note">{owner ? "Owners can leave once someone else is an owner too. The files stay with the space." : "You'll stop seeing this space. Someone who owns it can add you back."}</p>
        <div className="k-form-actions" style={{ marginTop: 12 }}><Seal type="button" tone="danger" onClick={() => void change(() => drive.setMember(space.id, me.username, null))}>Leave {space.name}</Seal></div>
      </div></div>
    </div>
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
  const spaceName = (id: string) => spaces.find((s) => s.id === id)?.name ?? "";
  return <section className="dv-sheet">
    <div className="dv-mast"><div className="dv-mast-id"><span className="dv-kind folder" style={{ width: 56, height: 56 }}><Icon name="trash" /></span><div><div className="dv-kicker">Across your spaces</div><h1>Trash</h1><p>Deleted things stay here for 30 days, then they&apos;re gone for good.</p></div></div></div>
    <div className="dv-list">
      {!items ? <div className="dv-empty"><p>Opening…</p></div> : !items.length ? <div className="dv-empty"><h3>Nothing in the Trash</h3><p>What you delete waits here for 30 days.</p></div>
        : items.map((node) => <div className="dv-r" key={node.id} style={{ gridTemplateColumns: "40px minmax(0, 1fr) 160px 120px auto" }}>
            <Kind node={node} />
            <div className="nm"><b>{node.name}</b><small>From {spaceName(node.spaceId)}</small></div>
            <span className="num">{node.trashedAt ? `${Math.max(0, 30 - Math.floor((now - node.trashedAt) / 86400000))} days left` : ""}</span>
            <span className="num">{node.kind === "folder" ? "—" : readableSize(node.size)}</span>
            <Seal type="button" tone="quiet" compact onClick={async () => {
              try { await drive.restore(node.id); onToast({ text: `“${node.name}” is back where it was.` }); await load(); } catch (error) { onToast({ text: error instanceof Error ? error.message : "That didn't work." }); }
            }}><Icon name="restore" />Put back</Seal>
          </div>)}
    </div>
  </section>;
}

function RecentView({ spaces, people, onOpen }: { spaces: Space[]; people: Record<string, Person>; onOpen: (node: DriveNode) => void }) {
  const [items, setItems] = useState<DriveNode[] | null>(null);
  useEffect(() => { void drive.recent().then(setItems).catch(() => setItems([])); }, []);
  const spaceName = (id: string) => spaces.find((s) => s.id === id)?.name ?? "";
  return <section className="dv-sheet">
    <div className="dv-mast"><div className="dv-mast-id"><span className="dv-kind folder" style={{ width: 56, height: 56 }}><Icon name="clock" /></span><div><div className="dv-kicker">Across your spaces</div><h1>Recent</h1><p>The files changed most lately, in every space you&apos;re in.</p></div></div></div>
    <div className="dv-list">
      {!items ? <div className="dv-empty"><p>Opening…</p></div> : !items.length ? <div className="dv-empty"><h3>Nothing yet</h3><p>Files people add will show here.</p></div>
        : items.map((node) => <div className="dv-r" key={node.id} style={{ gridTemplateColumns: "40px minmax(0, 1fr) 84px 160px" }}>
            <Kind node={node} />
            <div className="nm"><button type="button" onClick={() => onOpen(node)}><b>{node.name}</b><small>{spaceName(node.spaceId)}</small></button></div>
            <span className="num">{readableSize(node.size)}</span>
            <span className="num who" style={{ display: "flex", alignItems: "center", gap: 8 }}><Portrait person={people[node.createdBy?.toLowerCase()]} username={node.createdBy || "?"} size={22} /><span>{when(node.updatedAt)}</span></span>
          </div>)}
    </div>
  </section>;
}

/* ── the upload tray ── */

function UploadTray({ uploads, onClear, onCancel, onToast }: { uploads: Upload[]; onClear: () => void; onCancel: (id: string) => void; onToast: (toast: Toast) => void }) {
  const going = uploads.filter((u) => !u.done && !u.failed);
  return <div className="dv-uploads" style={{ position: "fixed" }}>
    <header><span>{going.length ? `Uploading ${uploads.length - going.length + 1} of ${uploads.length}` : `${uploads.length} ${uploads.length === 1 ? "upload" : "uploads"}`}</span>
      {!going.length ? <button type="button" className="dv-linkbtn" onClick={onClear}>Close</button> : null}</header>
    {uploads.map((u) => <div className="dv-up" key={u.id}>
      <span className="dv-kind"><span className="ext">{extension(u.name)}</span></span>
      <div><b>{u.name}</b>
        {u.failed ? <small className="err">{u.failed}</small>
          : u.done ? <small>Done · {readableSize(u.size)} · in {u.spaceName}</small>
          : <><div className="dv-bar"><i style={{ width: `${u.size ? Math.round(u.sent / u.size * 100) : 100}%` }} /></div><small>{readableSize(u.sent)} of {readableSize(u.size)}</small></>}
      </div>
      {u.done ? <Seal type="button" compact onClick={async () => {
        try { await navigator.clipboard.writeText(await drive.link(u.done!)); onToast({ text: "Link copied. Anyone with it can open the file." }); } catch (error) { onToast({ text: error instanceof Error ? error.message : "That didn't work." }); }
      }}><Icon name="link" />Copy public link</Seal>
        : <button type="button" className="dv-more" aria-label={u.failed ? "Dismiss" : "Cancel"} onClick={() => onCancel(u.id)}><Icon name="close" /></button>}
    </div>)}
  </div>;
}
