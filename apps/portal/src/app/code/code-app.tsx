"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { cx, InkCard, Seal } from "@kimono/ui";
import { useCrossTo } from "@/components/crossing";
import { SkeletonChat, SkeletonRows } from "@/components/skeleton";
import {
  code, drive, elapsed, isPicture, readableSize, when, type DriveItem, type DriveSpace,
  type Attachment, type Changes, type CodeEvent, type Entry, type Repository, type StoredEvent, type Workspace,
} from "./api";
import { Icon, type IconName } from "./icons";
import { Markdown } from "./markdown";
import { Picker } from "./picker";

/*
 * 工 Kimono Code on the web. One page: the sidebar of workspaces, and the
 * workspace you are in — its conversation with the agent, its files, and its
 * changes. Where you are lives in the address (?w=…&tab=…&path=…), so it
 * survives a reload and can be opened on the phone too.
 */

type Tab = "chat" | "files" | "changes" | "deploy";
const problemText = (error: unknown, fallback = "That didn't work.") => error instanceof Error ? error.message : fallback;
const repoName = (w: Pick<Workspace, "repo">) => `${w.repo.owner}/${w.repo.name}`;
/** Kimono Git and attachments open in their own tab; nothing here leaves the page it is on. */
const openOutside = (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); };

function goTo(to: Record<string, string | null>, replace = false) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(to)) if (value) next.set(key, value);
  const url = `/code${next.size ? `?${next}` : ""}`;
  if (replace) window.history.replaceState(null, "", url); else window.history.pushState(null, "", url);
}

/** A clock that ticks once a second while something is running. */
function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/* ── the timeline, replayed then live ── */

function useTimeline(id: string | null, onDone: () => void) {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [connected, setConnected] = useState(true);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    if (!id) return;
    const source = new EventSource(code.eventsUrl(id, 0));
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(source.readyState === EventSource.OPEN);
    source.onmessage = (message) => {
      const stored = JSON.parse(message.data) as StoredEvent;
      setEvents((list) => list.length && list[list.length - 1].seq >= stored.seq ? list : [...list, stored]);
      if (stored.event.kind === "done" || stored.event.kind === "ask" || stored.event.kind === "published") done.current();
    };
    return () => source.close();
  }, [id]);
  return { events, connected };
}

/* ── Code ── */

export function CodeApp({ blocked }: { blocked: string | null }) {
  const params = useSearchParams();
  const current = params.get("w");
  const tab = (["chat", "files", "changes", "deploy"].includes(params.get("tab") ?? "") ? params.get("tab") : "chat") as Tab;
  const path = params.get("path") ?? "";
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => code.workspaces().then((list) => { setWorkspaces(list); setProblem(null); }, (error) => setProblem(problemText(error, "Code isn't answering."))), [setWorkspaces]);
  useEffect(() => { void load(); }, [load]);

  const workspace = workspaces?.find((w) => w.id === current) ?? null;
  const running = workspaces?.some((w) => w.turn?.state === "running") ?? false;
  const now = useNow(running);

  /* ⌘K or / jumps to a new task from anywhere on the page. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); goTo({}); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <div className="cd-page">
    <div className={cx("cd", current && "has-workspace")}>
    <aside className="cd-side" aria-label="Tasks">
      <div className="cd-side-head"><span>Tasks</span><button type="button" className="cd-roundbutton" onClick={() => goTo({})} aria-keyshortcuts="Meta+K" aria-label="New task" title="New task (⌘K)" aria-current={!current ? "page" : undefined}><Icon name="plus" /></button></div>
      {problem ? <p className="cd-quiet cd-side-note">{problem} <button type="button" className="cd-textbutton" onClick={() => void load()}>Retry</button></p> : null}
      {workspaces === null && !problem ? <SkeletonRows rows={4} mark={false} /> : null}
      <WorkspaceList label="Working" list={workspaces?.filter((w) => w.turn?.state === "running") ?? []} current={current} now={now} />
      <WorkspaceList label="Recent" list={workspaces?.filter((w) => w.turn?.state !== "running") ?? []} current={current} now={now} />
      {workspaces && !workspaces.length ? <p className="cd-quiet cd-side-note">Nothing yet.</p> : null}
    </aside>
    <main className="cd-main">
      {current && workspace
        ? <WorkspaceView key={workspace.id} workspace={workspace} others={workspaces?.filter((w) => w.id !== workspace.id && w.preview) ?? []} tab={tab} path={path} blocked={blocked} onChange={load} now={now} />
        : current && workspaces
          ? <div className="cd-sheet cd-empty"><p>That workspace isn&rsquo;t here any more.</p><Seal type="button" tone="quiet" onClick={() => goTo({})}>New task</Seal></div>
          : current
            ? <div className="cd-sheet cd-loading"><div className="cd-timeline"><SkeletonChat /></div></div>
            : <Start blocked={blocked} onStarted={async (made) => { setWorkspaces((list) => [made, ...(list ?? []).filter((w) => w.id !== made.id)]); goTo({ w: made.id }); void load(); }} />}
    </main>
    </div>
  </div>;
}

function WorkspaceList({ label, list, current, now }: { label: string; list: Workspace[]; current: string | null; now: number }) {
  if (!list.length) return null;
  return <div>
    <div className="cd-side-label">{label}</div>
    <nav className="cd-list">{list.map((w) => {
      const state = w.turn?.state;
      return <button type="button" key={w.id} aria-current={w.id === current ? "page" : undefined} onClick={() => goTo({ w: w.id })}>
        <b>{w.title}</b>
        <small>
          <span className="cd-mono">{w.repo.name}</span>
          {/* One word, and only when it says something. */}
          {state === "running" ? <span className="cd-word running">working {elapsed(now - w.turn!.startedAt)}</span>
            : state === "failed" ? <span className="cd-word">stopped</span>
              : w.preview ? <span className="cd-word">live</span>
              : w.pullRequest ? <span className="cd-word">#{w.pullRequest.number}</span>
                : <span className="cd-when">{when(w.updatedAt, now)}</span>}
        </small>
      </button>;
    })}</nav>
  </div>;
}

/* ── a new task: which repository, which branch, and what to do ── */

function Start({ blocked, onStarted }: { blocked: string | null; onStarted: (w: Workspace) => Promise<void> }) {
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [repo, setRepo] = useState("");
  const [fetched, setFetched] = useState<{ repo: string; list: string[] } | null>(null);
  const [picked, setPicked] = useState<{ repo: string; branch: string } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  async function makeProject() {
    if (!naming?.trim() || making) return;
    setMaking(true);
    setProblem(null);
    try {
      const made = await code.createRepository(naming);
      setRepos((list) => [made, ...(list ?? [])]);
      setRepo(`${made.owner}/${made.name}`);
      setNaming(null);
      field.current?.focus();
    } catch (error) { setProblem(problemText(error)); } finally { setMaking(false); }
  }

  useEffect(() => {
    if (blocked) return;
    code.repositories().then((list) => {
      setRepos(list);
      let remembered = "";
      try { remembered = localStorage.getItem("kimono-code-repo") ?? ""; } catch { /* private window */ }
      const first = list.find((r) => `${r.owner}/${r.name}` === remembered) ?? list[0];
      if (first) setRepo(`${first.owner}/${first.name}`);
    }, (error) => setProblem(problemText(error)));
  }, [blocked]);

  const chosen = repos?.find((r) => `${r.owner}/${r.name}` === repo);
  const listed = fetched?.repo === repo ? fetched.list : [];
  const branches = chosen ? (listed.includes(chosen.defaultBranch) ? listed : [chosen.defaultBranch, ...listed]) : [];
  const base = picked?.repo === repo ? picked.branch : chosen?.defaultBranch ?? "";
  const setBase = (branch: string) => setPicked({ repo, branch });
  useEffect(() => {
    if (!chosen) return;
    const key = `${chosen.owner}/${chosen.name}`;
    code.branches(chosen.owner, chosen.name).then((list) => setFetched({ repo: key, list }), () => {});
    try { localStorage.setItem("kimono-code-repo", key); } catch { /* not remembered */ }
  }, [chosen]);

  useEffect(() => { field.current?.focus(); }, [repos]);

  async function send() {
    if (!chosen || !prompt.trim() || sending) return;
    setSending(true);
    setProblem(null);
    try {
      await onStarted(await code.start({ owner: chosen.owner, name: chosen.name, base: base || chosen.defaultBranch, prompt }));
    } catch (error) {
      setProblem(problemText(error));
      setSending(false);
    }
  }

  return <section className="cd-start">
    <h2>What should we work on?</h2>
    {blocked ? <div className="cd-sheet cd-blocked"><p>{blocked}</p></div> : <div className="cd-sheet cd-new-task">
      {naming !== null || (repos && !repos.length) ? <div className="cd-naming">
        <label className="cd-task">
          <span>New project</span>
          <input autoFocus value={naming ?? ""} placeholder="Family recipes" maxLength={60}
            onChange={(event) => setNaming(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void makeProject(); } if (event.key === "Escape" && repos?.length) setNaming(null); }} />
        </label>
        <Seal type="button" onClick={() => void makeProject()} disabled={!naming?.trim() || making}>{making ? "Making…" : "Make project"}</Seal>
        {repos?.length ? <Seal type="button" tone="quiet" onClick={() => setNaming(null)}>Cancel</Seal> : null}
      </div> : <div className="cd-new-pickers">
        <Picker label="Project" placeholder={repos ? "None yet" : "Loading…"} value={repo} onChange={setRepo} disabled={!repos}
          action={{ label: "New project", onAction: () => setNaming("") }}
          options={(repos ?? []).map((r) => ({ value: `${r.owner}/${r.name}`, label: r.name, detail: r.description || r.owner, note: r.owner }))} />
        <Picker label="Starting from" value={base} onChange={setBase} disabled={!chosen} mono
          options={branches.map((b) => ({ value: b, label: b, detail: b === chosen?.defaultBranch ? "The main version" : undefined }))} />
      </div>}
      <label className="cd-task">
        <span>Task</span>
        <textarea ref={field} value={prompt} rows={5} placeholder="Describe what you want, in your own words. Paste screenshots or files once it starts."
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} />
      </label>
      <div className="cd-new-go">
        <span className="cd-faint">⌘↵ to start</span>
        <Seal type="button" onClick={() => void send()} disabled={!chosen || !prompt.trim() || sending} aria-keyshortcuts="Meta+Enter">
          {sending ? "Starting…" : "Start"}
        </Seal>
      </div>
    </div>}
    {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
  </section>;
}

/* ── a workspace ── */

function WorkspaceView({ workspace, others, tab, path, blocked, onChange, now }: { workspace: Workspace; others: Workspace[]; tab: Tab; path: string; blocked: string | null; onChange: () => void; now: number }) {
  const { events, connected } = useTimeline(workspace.id, onChange);
  const running = workspace.turn?.state === "running";
  const [publishing, setPublishing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = (to: Partial<Record<"tab" | "path", string | null>>) => goTo({ w: workspace.id, tab: to.tab === "chat" ? null : to.tab ?? tab, path: to.path ?? null });

  async function publish() {
    setPublishing(true);
    setProblem(null);
    try { await code.publish(workspace.id, workspace.title); onChange(); } catch (error) { setProblem(problemText(error)); } finally { setPublishing(false); }
  }
  async function remove() {
    try { await code.remove(workspace.id); goTo({}, true); onChange(); } catch (error) { setProblem(problemText(error)); }
  }

  const deployments = <Deployments workspace={workspace} others={others} running={running} blocked={blocked} publishing={publishing} onPublish={() => void publish()} onRemove={() => void remove()} />;
  /* No header: a row of icons says where you are, and what the task has made lives in Deployments. */
  return <div className="cd-ws-grid">
    <div className="cd-sheet cd-ws">
      <nav className="cd-bar" aria-label="Task">
        <button type="button" className="cd-roundbutton cd-back" onClick={() => goTo({})} aria-label="All tasks" title="All tasks"><Icon name="back" /></button>
        <div className="cd-iconTabs" role="tablist" aria-label="Views">
          {([["chat", "Chat", "chat"], ["files", "Files", "folder"], ["changes", "Changes", "diff"], ["deploy", "Deployments", "rocket"]] as const).map(([id, label, icon]) => (
            <button key={id} type="button" role="tab" className={id === "deploy" ? "cd-deploy-tab" : undefined} aria-selected={tab === id} aria-label={label} title={label} onClick={() => go({ tab: id })}><Icon name={icon} /><span>{label}</span></button>
          ))}
        </div>
        <span className="cd-bar-title" title={workspace.title}>{workspace.title}</span>
        {running ? <span className="cd-status running" role="status"><i aria-hidden="true" />Working {elapsed(now - workspace.turn!.startedAt)}</span>
          : !connected ? <span className="cd-status">Reconnecting…</span> : null}
      </nav>
      {problem ? <p className="cd-problem cd-ws-problem" role="alert">{problem}</p> : null}
      {tab === "chat" ? <Chat workspace={workspace} events={events} running={running} blocked={blocked} />
        : tab === "files" ? <Files workspace={workspace} path={path} onOpen={(path) => go({ tab: "files", path })} />
          : tab === "changes" ? <ChangesView workspace={workspace} running={running} lastSeq={events.at(-1)?.seq ?? 0} />
            : <div className="cd-scroll cd-deploy-inline">{deployments}</div>}
    </div>
    <aside className="cd-deploy" aria-label="Deployments">{deployments}</aside>
  </div>;
}

/** What a task has made, and where it lives: the running app, the pull request, the branch, the files. */
function Deployments({ workspace, others, running, blocked, publishing, onPublish, onRemove }: { workspace: Workspace; others: Workspace[]; running: boolean; blocked: string | null; publishing: boolean; onPublish: () => void; onRemove: () => void }) {
  const crossTo = useCrossTo();
  const [confirmDelete, setConfirmDelete] = useState(false);
  return <div className="cd-deployments">
    <h2>Deployments</h2>
    {workspace.preview
      ? <PreviewCard workspace={workspace} url={workspace.preview.url} live />
      : <div className="cd-dep-row"><span className="cd-dep-icon"><Icon name="rocket" /></span><span><b>Not running</b><small>Ask the agent to run the app and it appears here.</small></span></div>}
    <div className="cd-dep-list">
      <div className="cd-dep-row">
        <span className="cd-dep-icon"><Icon name="pr" /></span>
        <span><b>{workspace.pullRequest ? `Pull request #${workspace.pullRequest.number}` : "No pull request yet"}</b><small>{workspace.pullRequest ? "Changes are pushed as you go" : "Push the branch for review"}</small></span>
        {workspace.pullRequest
          ? <button type="button" className="cd-roundbutton" aria-label="Open pull request" title="Open pull request" onClick={() => openOutside(workspace.pullRequest!.url)}><Icon name="open" /></button>
          : null}
      </div>
      <div className="cd-dep-row">
        <span className="cd-dep-icon"><Icon name="branch" /></span>
        <span><b className="cd-mono">{workspace.branch}</b><small>{repoName(workspace)} · from {workspace.base}</small></span>
        <button type="button" className="cd-roundbutton" disabled={running || publishing || Boolean(blocked)} aria-label={workspace.pullRequest ? "Push changes" : "Open a pull request"} title={workspace.pullRequest ? "Push changes" : "Open a pull request"} onClick={onPublish}>{publishing ? <i className="cd-spin" /> : <Icon name="send" />}</button>
      </div>
      {workspace.drive ? <div className="cd-dep-row">
        <span className="cd-dep-icon"><Icon name="folder" /></span>
        <span><b>Files in Drive</b><small>The sandbox, kept in step both ways</small></span>
        <button type="button" className="cd-roundbutton" aria-label="Open in Drive" title="Open in Drive" onClick={() => crossTo("kakejiku", `/drive?space=${workspace.drive!.spaceId}&folder=${workspace.drive!.folderId}`)}><Icon name="chevron" /></button>
      </div> : null}
    </div>
    {others.length ? <>
      <h3>Also running</h3>
      <div className="cd-dep-list">{others.map((w) => <button type="button" key={w.id} className="cd-dep-row is-link" onClick={() => goTo({ w: w.id, tab: "deploy" })}>
        <span className="cd-dep-icon is-live"><Icon name="rocket" /></span>
        <span><b>{w.title}</b><small className="cd-mono">{w.preview!.url.replace(/^https?:\/\//, "")}</small></span>
      </button>)}</div>
    </> : null}
    <div className="cd-dep-foot">{confirmDelete
      ? <><span>Delete the sandbox? Its files stay in Drive.</span><button type="button" className="cd-quietbutton is-danger" onClick={onRemove}>Delete</button><button type="button" className="cd-quietbutton" onClick={() => setConfirmDelete(false)}>Keep</button></>
      : <button type="button" className="cd-quietbutton" onClick={() => setConfirmDelete(true)}><Icon name="trash" />Delete task</button>}</div>
  </div>;
}

/* ── chat ── */

type Tool = Extract<CodeEvent, { kind: "tool" }> & { result?: Extract<CodeEvent, { kind: "tool-result" }> };
type Item =
  | { type: "ask"; seq: number; at: number; event: Extract<CodeEvent, { kind: "ask" }> }
  | { type: "text"; seq: number; text: string }
  | { type: "tools"; seq: number; tools: Tool[]; open: boolean }
  | { type: "done"; seq: number; event: Extract<CodeEvent, { kind: "done" }> }
  | { type: "published"; seq: number; event: Extract<CodeEvent, { kind: "published" }> }
  | { type: "shots"; seq: number; shots: { name: string; caption?: string }[] }
  | { type: "preview"; seq: number; event: Extract<CodeEvent, { kind: "preview" }> }
  | { type: "preview-stopped"; seq: number };

/** Events as the reader sees them: consecutive tool calls fold into one group, each call paired with its result. */
function itemsOf(events: StoredEvent[]): Item[] {
  const items: Item[] = [];
  const tools = new Map<string, Tool>();
  for (const { seq, at, event } of events) {
    const last = items.at(-1);
    switch (event.kind) {
      case "ask": items.push({ type: "ask", seq, at, event }); break;
      case "text": items.push({ type: "text", seq, text: event.text }); break;
      case "tool": {
        const tool: Tool = { ...event };
        tools.set(event.id, tool);
        if (last?.type === "tools") last.tools.push(tool); else items.push({ type: "tools", seq, tools: [tool], open: false });
        break;
      }
      case "tool-result": { const tool = tools.get(event.id); if (tool) tool.result = event; break; }
      case "done": items.push({ type: "done", seq, event }); break;
      case "published": items.push({ type: "published", seq, event }); break;
      case "image": if (last?.type === "shots") last.shots.push(event); else items.push({ type: "shots", seq, shots: [event] }); break;
      case "preview": items.push({ type: "preview", seq, event }); break;
      case "preview-stopped": items.push({ type: "preview-stopped", seq }); break;
    }
  }
  return items;
}

function Chat({ workspace, events, running, blocked }: { workspace: Workspace; events: StoredEvent[]; running: boolean; blocked: string | null }) {
  const items = useMemo(() => itemsOf(events), [events]);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [away, setAway] = useState(false);

  /* Follows the agent while you're at the bottom; leaves you alone once you scroll up. */
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items]);
  /* Pictures and opened tool groups grow the timeline after it renders; stay at the bottom through that too. */
  const timeline = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    const inner = timeline.current;
    if (!el || !inner) return;
    const observer = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight; });
    observer.observe(inner);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    pinned.current = atBottom;
    setAway(!atBottom);
  };

  /* Only the turn under way may hold a group open; earlier turns stay as they were left. */
  const lastAsk = items.findLastIndex((i) => i.type === "ask");
  const lastTools = items.slice(lastAsk + 1).findLast((i) => i.type === "tools");
  const lastPreview = items.findLast((i) => i.type === "preview")?.seq;
  return <div className="cd-chat">
    <div className="cd-scroll" ref={scroller} onScroll={onScroll}>
      <div className="cd-timeline" ref={timeline} aria-live="polite">
        {items.length === 0 ? <SkeletonChat /> : null}
        {items.map((item) => {
          switch (item.type) {
            case "ask": return <Ask key={item.seq} workspace={workspace} item={item} />;
            case "text": return <div key={item.seq} className="cd-say"><Markdown text={item.text} /></div>;
            case "tools": return <ToolGroup key={item.seq} tools={item.tools} live={running && item === lastTools} />;
            case "done": return <Done key={item.seq} event={item.event} />;
            case "shots": return <Shots key={item.seq} workspace={workspace} shots={item.shots} />;
            case "preview": return <p key={item.seq} className="cd-note"><Icon name="rocket" />{workspace.preview?.url === item.event.url && item.seq === lastPreview ? <>Started the app · <button type="button" className="cd-textbutton" onClick={() => goTo({ w: workspace.id, tab: "deploy" })}>see Deployments</button></> : <>The app ran at <span className="cd-mono">{item.event.url.replace(/^https?:\/\//, "")}</span></>}</p>;
            case "preview-stopped": return <p key={item.seq} className="cd-note">The app&rsquo;s link was taken down.</p>;
            case "published": return <p key={item.seq} className="cd-note"><Icon name="pr" />Opened <button type="button" className="cd-textbutton" onClick={() => openOutside(item.event.url)}>pull request #{item.event.number}</button></p>;
          }
        })}
        {running && items.at(-1)?.type !== "tools" ? <p className="cd-thinking"><i aria-hidden="true" />Working</p> : null}
      </div>
      {away ? <div className="cd-latest-wrap"><button type="button" className="cd-latest" onClick={() => { const el = scroller.current; if (el) { el.scrollTop = el.scrollHeight; pinned.current = true; setAway(false); } }}>Latest ↓</button></div> : null}
    </div>
    <Composer workspace={workspace} running={running} blocked={blocked} />
  </div>;
}

function Ask({ workspace, item }: { workspace: Workspace; item: Extract<Item, { type: "ask" }> }) {
  const { text, attachments } = item.event;
  return <div className="cd-ask">
    {text ? <p>{text}</p> : null}
    {attachments.length ? <div className="cd-attached">{attachments.map((a) => isPicture(a.type)
      // eslint-disable-next-line @next/next/no-img-element
      ? <button type="button" key={a.path} className="cd-thumb" aria-label={a.name} onClick={() => openOutside(code.attachmentUrl(workspace.id, a))}><img src={code.attachmentUrl(workspace.id, a)} alt={a.name} /></button>
      : <button type="button" key={a.path} className="cd-filechip" onClick={() => openOutside(code.attachmentUrl(workspace.id, a))}><Icon name="file" /><span>{a.name}</span><small>{readableSize(a.size)}</small></button>)}</div> : null}
  </div>;
}

/** Tool calls as one pill — "Used 5 tools" — open while the agent is still in them, unless you closed it. Each call opens to show what it did. */
function ToolGroup({ tools, live }: { tools: Tool[]; live: boolean }) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? live;
  const failed = tools.filter((t) => t.result && !t.result.ok).length;
  const pending = tools.some((t) => !t.result);
  const touched = [...new Set(tools.filter((t) => t.label === "Edited" || t.label === "Wrote").map((t) => t.detail).filter(Boolean))];
  return <details className="calls" open={open} onToggle={(event) => { const next = (event.currentTarget as HTMLDetailsElement).open; if (next !== open) setChosen(next); }}>
    <summary className="tools-used">
      {live && pending ? <i className="cd-spin" aria-hidden="true" /> : <Icon name="gear" />}
      <span>{live && pending ? "Using tools" : `Used ${tools.length} ${tools.length === 1 ? "tool" : "tools"}`}</span>
      {touched.length ? <span className="cd-faint">· edited {touched.length === 1 ? touched[0] : `${touched.length} files`}</span> : null}
      {failed ? <span className="cd-word">{failed} failed</span> : null}
      <span className="chev" aria-hidden="true" />
    </summary>
    <div className="call-list">{tools.map((tool) => <ToolRow key={tool.id} tool={tool} />)}</div>
  </details>;
}

const toolIcons: Record<string, IconName> = { Read: "file", Wrote: "file", Edited: "diff", Ran: "code", "Searched for": "search", "Looked for": "search", Fetched: "link", "Searched the web for": "search", "Asked a helper": "chat" };

/** A few words on how a call went: how much it read, what it changed, how many matches. */
function toolMeta(tool: Tool): string {
  if (!tool.result) return "running";
  if (!tool.result.ok) return "failed";
  const count = (text: string) => text ? text.split("\n").filter(Boolean).length : 0;
  const added = tool.change?.split("\n").filter((line) => line.startsWith("+ ")).length ?? 0;
  const removed = tool.change?.split("\n").filter((line) => line.startsWith("- ")).length ?? 0;
  switch (tool.label) {
    case "Read": return `${count(tool.result.output)} lines`;
    case "Wrote": return `+${added}`;
    case "Edited": return `+${added} −${removed}`;
    case "Searched for": case "Looked for": { const n = count(tool.result.output); return n ? `${n} match${n === 1 ? "" : "es"}` : "nothing found"; }
    case "Ran": return "done";
    default: return "";
  }
}

function ToolRow({ tool }: { tool: Tool }) {
  const state = !tool.result ? "running" : tool.result.ok ? "ok" : "failed";
  const command = tool.label === "Ran" && tool.detail;
  const output = tool.result?.output.trim();
  return <details className="call" data-state={state}>
    <summary>
      <span className="ci" aria-hidden="true">{state === "running" ? <i className="cd-spin" /> : <Icon name={toolIcons[tool.label] ?? "gear"} />}</span>
      <span className="cv">{tool.label}</span>
      {tool.detail ? <code>{tool.detail.split("\n")[0]}</code> : null}
      <span className={state === "failed" ? "cm is-failed" : "cm"}>{toolMeta(tool)}</span>
      <span className="chev" aria-hidden="true" />
    </summary>
    <div className="cbody">
      {tool.change && state !== "failed"
        ? <div className="diff">{tool.change.split("\n").map((line, index) => <div key={index} className={line.startsWith("+ ") ? "add" : line.startsWith("- ") ? "del" : "gap"}>{line}</div>)}</div>
        : command || output
          ? <pre className="urushi">{command ? <span className="c">$ {command}{output ? "\n" : ""}</span> : null}{output}</pre>
          : <p className="cd-faint">{state === "running" ? "Still running." : "Nothing came back."}</p>}
    </div>
  </details>;
}

function Done({ event }: { event: Extract<CodeEvent, { kind: "done" }> }) {
  if (event.cancelled) return <p className="cd-note">Stopped.</p>;
  if (!event.ok) return <p className="cd-note is-failed" role="alert"><Icon name="close" />{event.error || "The agent stopped with an error."}</p>;
  const facts = [event.durationMs ? elapsed(event.durationMs) : null, event.costUsd ? `$${event.costUsd.toFixed(2)}` : null].filter(Boolean);
  return <p className="cd-note cd-done"><Icon name="check" />Done{facts.length ? <span className="cd-mono">{facts.join(" · ")}</span> : null}</p>;
}

/* ── what the agent shows: screenshots, and the app it is running ── */

function Shots({ workspace, shots }: { workspace: Workspace; shots: { name: string; caption?: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return <>
    <div className={cx("cd-shots", shots.length === 1 && "is-one")}>
      {shots.map((shot, n) => <figure key={shot.name}>
        <button type="button" onClick={() => setOpen(n)} aria-label={shot.caption ? `Enlarge: ${shot.caption}` : "Enlarge screenshot"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={code.shotUrl(workspace.id, shot.name)} alt={shot.caption ?? "Screenshot"} loading="lazy" />
        </button>
        {shot.caption ? <figcaption>{shot.caption}</figcaption> : null}
      </figure>)}
    </div>
    {open !== null ? <Lightbox workspace={workspace} shots={shots} at={open} onMove={setOpen} onClose={() => setOpen(null)} /> : null}
  </>;
}

function Lightbox({ workspace, shots, at, onMove, onClose }: { workspace: Workspace; shots: { name: string; caption?: string }[]; at: number; onMove: (n: number) => void; onClose: () => void }) {
  const box = useRef<HTMLDialogElement>(null);
  useEffect(() => { box.current?.showModal(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && at < shots.length - 1) onMove(at + 1);
      if (event.key === "ArrowLeft" && at > 0) onMove(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, shots.length, onMove]);
  const shot = shots[at];
  return <dialog ref={box} className="cd-lightbox" onClose={onClose} onClick={(event) => { if (event.target === box.current) box.current?.close(); }}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={code.shotUrl(workspace.id, shot.name)} alt={shot.caption ?? "Screenshot"} />
    <div className="cd-lightbox-bar">
      <span>{shot.caption ?? ""}</span>
      {shots.length > 1 ? <span className="cd-mono">{at + 1} / {shots.length}</span> : null}
      <button type="button" className="cd-iconbutton" aria-label="Close" onClick={() => box.current?.close()}><Icon name="close" /></button>
    </div>
  </dialog>;
}

/** The app the agent is running: a link anyone can open while it's up. */
function PreviewCard({ workspace, url, live }: { workspace: Workspace; url: string; live: boolean }) {
  const [copied, setCopied] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!live) return <p className="cd-note"><Icon name="link" />The app ran at <span className="cd-mono">{url.replace(/^https?:\/\//, "")}</span></p>;
  return <InkCard colour="#5c7150" seed={`preview-${workspace.id}`} className="cd-preview-ink"><div className="cd-preview">
    <span className="cd-preview-mark" aria-hidden="true"><Icon name="open" /></span>
    <div className="cd-preview-id">
      <b>Your app is running</b>
      <span className="cd-mono">{url.replace(/^https?:\/\//, "")}</span>
      <small>Anyone with the link can open it while it&rsquo;s up.</small>
    </div>
    <div className="cd-preview-acts">
      <Seal type="button" compact onClick={() => openOutside(url)}>Open</Seal>
      <button type="button" className="cd-quietbutton" onClick={() => { void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Copied" : "Copy link"}</button>
      <button type="button" className="cd-quietbutton" disabled={stopping} onClick={() => { setStopping(true); code.stopPreview(workspace.id).catch((error) => { setProblem(problemText(error)); setStopping(false); }); }}>{stopping ? "Stopping…" : "Take down"}</button>
    </div>
    {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
  </div></InkCard>;
}

/* ── the composer: what to say next, and what to show it ── */

type Pending = { id: string; name: string; size: number; preview: string | null; attachment?: Attachment; failed?: string };

function Composer({ workspace, running, blocked }: { workspace: Workspace; running: boolean; blocked: string | null }) {
  const draftKey = `kimono-code-draft-${workspace.id}`;
  const [text, setText] = useState(() => { try { return sessionStorage.getItem(draftKey) ?? ""; } catch { return ""; } });
  const [pending, setPending] = useState<Pending[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => { try { if (text) sessionStorage.setItem(draftKey, text); else sessionStorage.removeItem(draftKey); } catch { /* not kept */ } }, [text, draftKey]);
  useEffect(() => () => { for (const p of pending) if (p.preview) URL.revokeObjectURL(p.preview); }, [pending]);
  /* The field grows with what you type, up to a third of the screen. */
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    const max = window.innerHeight / 3;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text]);

  const add = useCallback((files: File[]) => {
    const fresh = files.slice(0, 10).map((file) => ({ file, item: { id: crypto.randomUUID(), name: file.name, size: file.size, preview: isPicture(file.type) ? URL.createObjectURL(file) : null } as Pending }));
    setPending((list) => [...list, ...fresh.map((f) => f.item)].slice(0, 10));
    for (const { file, item } of fresh) {
      if (file.size > 20 * 1024 * 1024) { setPending((list) => list.map((p) => p.id === item.id ? { ...p, failed: "Over 20 MB" } : p)); continue; }
      code.attach(workspace.id, file).then(
        (attachment) => setPending((list) => list.map((p) => p.id === item.id ? { ...p, attachment } : p)),
        (error) => setPending((list) => list.map((p) => p.id === item.id ? { ...p, failed: problemText(error, "Didn't attach") } : p)),
      );
    }
  }, [workspace.id]);

  const uploading = pending.some((p) => !p.attachment && !p.failed);
  const ready = pending.filter((p) => p.attachment).map((p) => p.attachment!);
  const canSend = !running && !sending && !uploading && !blocked && (text.trim().length > 0 || ready.length > 0);

  async function send() {
    if (!canSend) return;
    setSending(true);
    setProblem(null);
    try {
      await code.ask(workspace.id, text, ready);
      setText("");
      setPending([]);
    } catch (error) { setProblem(problemText(error)); } finally { setSending(false); field.current?.focus(); }
  }

  return <div className={cx("cd-composer", dragging && "is-dropping")}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
    onDrop={(event) => { event.preventDefault(); setDragging(false); add([...event.dataTransfer.files]); }}>
    {pending.length ? <div className="cd-pending">{pending.map((p) => <span key={p.id} className={cx("cd-filechip", !p.attachment && !p.failed && "is-sending", p.failed && "is-failed")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {p.preview ? <img src={p.preview} alt="" /> : <Icon name="file" />}
      <span>{p.name}</span>
      <small>{p.failed ?? (p.attachment ? readableSize(p.size) : "Attaching…")}</small>
      <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPending((list) => list.filter((x) => x.id !== p.id))}><Icon name="close" /></button>
    </span>)}</div> : null}
    <textarea ref={field} value={text} rows={1} aria-label="Message"
      placeholder={blocked ? blocked : running ? "The agent is working…" : "Ask for a change, or reply"}
      disabled={Boolean(blocked)}
      onChange={(event) => setText(event.target.value)}
      onPaste={(event) => { const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); add(files); } }}
      onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} />
    <div className="cd-composer-bar">
      <input ref={picker} type="file" multiple hidden onChange={(event) => { add([...(event.target.files ?? [])]); event.target.value = ""; }} />
      <button type="button" className="cd-iconbutton" aria-label="Attach files" disabled={Boolean(blocked)} onClick={() => picker.current?.click()}><Icon name="clip" /></button>
      {workspace.drive ? <button type="button" className="cd-iconbutton" aria-label="Attach from Drive" title="Attach from Drive" disabled={Boolean(blocked)} onClick={() => setChoosing(true)}><Icon name="folder" /></button> : null}
      {problem ? <span className="cd-problem" role="alert">{problem}</span> : null}
      <span className="cd-grow" />
      {running
        ? <Seal type="button" compact tone="quiet" onClick={() => void code.stop(workspace.id).catch((error) => setProblem(problemText(error)))}><Icon name="stop" />Stop</Seal>
        : <Seal type="button" compact disabled={!canSend} onClick={() => void send()} aria-keyshortcuts="Meta+Enter" title="Send (⌘↵)">Send</Seal>}
    </div>
    {dragging ? <div className="cd-drop" aria-hidden="true">Drop to attach</div> : null}
    {choosing ? <DrivePicker onClose={() => setChoosing(false)} onPick={async (items) => {
      setChoosing(false);
      const shown = items.map((item): Pending => ({ id: item.id, name: item.name, size: item.size, preview: null }));
      setPending((list) => [...list, ...shown].slice(0, 10));
      try {
        const attached = await code.fromDrive(workspace.id, items.map((i) => i.id));
        setPending((list) => list.map((p) => {
          const at = shown.findIndex((s) => s.id === p.id);
          if (at < 0) return p;
          const attachment = attached[at];
          return { ...p, attachment, preview: attachment && isPicture(attachment.type) ? code.attachmentUrl(workspace.id, attachment) : null };
        }));
      } catch (error) {
        setPending((list) => list.map((p) => shown.some((s) => s.id === p.id) ? { ...p, failed: problemText(error, "Didn't attach") } : p));
      }
    }} /> : null}
  </div>;
}

/** Files from Drive: spaces, then folders, then files to tick. */
function DrivePicker({ onClose, onPick }: { onClose: () => void; onPick: (items: DriveItem[]) => void }) {
  const box = useRef<HTMLDialogElement>(null);
  const [spaces, setSpaces] = useState<DriveSpace[] | null>(null);
  const [at, setAt] = useState<{ folder: DriveItem; path: DriveItem[]; children: DriveItem[] } | null>(null);
  const [chosen, setChosen] = useState<Map<string, DriveItem>>(new Map());
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { box.current?.showModal(); }, []);
  useEffect(() => { drive.spaces().then(setSpaces, (error) => setProblem(problemText(error))); }, []);
  const open = (id: string) => drive.folder(id).then((f) => { setAt(f); setProblem(null); }, (error) => setProblem(problemText(error)));
  const toggle = (item: DriveItem) => setChosen((m) => { const next = new Map(m); if (next.has(item.id)) next.delete(item.id); else if (next.size < 10) next.set(item.id, item); return next; });

  return <dialog ref={box} className="cd-drivepick" onClose={onClose} onClick={(event) => { if (event.target === box.current) box.current?.close(); }}>
    <header>
      <b>From Drive</b>
      <nav className="cd-drivepick-path">
        <button type="button" onClick={() => setAt(null)}>Spaces</button>
        {at ? [...at.path, at.folder].map((step) => <span key={step.id}><Icon name="chevron" /><button type="button" onClick={() => void open(step.id)}>{step.name}</button></span>) : null}
      </nav>
      <button type="button" className="cd-iconbutton" aria-label="Close" onClick={() => box.current?.close()}><Icon name="close" /></button>
    </header>
    <ul>
      {!at ? (spaces ?? []).map((space) => <li key={space.id}><button type="button" onClick={() => void open(space.rootId)}><Icon name="space" /><span>{space.name}</span><Icon name="chevron" /></button></li>)
        : at.children.map((item) => item.kind === "folder"
          ? <li key={item.id}><button type="button" onClick={() => void open(item.id)}><Icon name="folder" /><span>{item.name}</span><Icon name="chevron" /></button></li>
          : <li key={item.id}><label><input type="checkbox" checked={chosen.has(item.id)} onChange={() => toggle(item)} /><Icon name="file" /><span>{item.name}</span><small>{readableSize(item.size)}</small></label></li>)}
      {spaces === null && !problem ? <li className="cd-faint cd-drivepick-note">…</li> : null}
      {at && !at.children.length ? <li className="cd-faint cd-drivepick-note">Nothing here.</li> : null}
    </ul>
    <footer>
      {problem ? <span className="cd-problem">{problem}</span> : <span className="cd-faint">{chosen.size ? `${chosen.size} chosen` : "Tick the files to add"}</span>}
      <span className="cd-grow" />
      <Seal type="button" compact tone="quiet" onClick={() => box.current?.close()}>Cancel</Seal>
      <Seal type="button" compact disabled={!chosen.size} onClick={() => onPick([...chosen.values()])}>Add</Seal>
    </footer>
  </dialog>;
}

/* ── files ── */

function Files({ workspace, path, onOpen }: { workspace: Workspace; path: string; onOpen: (path: string) => void }) {
  const [tree, setTree] = useState<Record<string, Entry[] | "loading" | string>>({});
  const [open, setOpen] = useState<Set<string>>(() => new Set(path.split("/").slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join("/"))));

  const list = useCallback((dir: string) => {
    code.files(workspace.id, dir).then((r) => setTree((t) => ({ ...t, [dir]: r.entries })), (error) => setTree((t) => ({ ...t, [dir]: problemText(error) })));
  }, [workspace.id]);
  useEffect(() => { list(""); for (const dir of open) if (dir) list(dir); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (dir: string) => {
    setOpen((set) => { const next = new Set(set); if (next.has(dir)) next.delete(dir); else { next.add(dir); if (!tree[dir]) list(dir); } return next; });
  };

  const render = (dir: string, depth: number): React.ReactNode => {
    const entries = tree[dir];
    if (entries === undefined || entries === "loading") return <li className="cd-faint" style={{ paddingLeft: 12 + depth * 14 }}>…</li>;
    if (typeof entries === "string") return <li className="cd-problem" style={{ paddingLeft: 12 + depth * 14 }}>{entries}</li>;
    return entries.map((entry) => {
      const full = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.kind === "dir") return <li key={full}>
        <button type="button" className="cd-tree-row" aria-expanded={open.has(full)} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(full)}>
          <Icon name="chevron" /><Icon name="folder" /><span>{entry.name}</span>
        </button>
        {open.has(full) ? <ul>{render(full, depth + 1)}</ul> : null}
      </li>;
      return <li key={full}>
        <button type="button" className="cd-tree-row" aria-current={full === path ? "true" : undefined} style={{ paddingLeft: 30 + depth * 14 }} onClick={() => onOpen(full)}>
          <Icon name="file" /><span>{entry.name}</span>
        </button>
      </li>;
    });
  };

  return <div className="cd-files">
    <nav className="cd-tree" aria-label="Files"><ul>{render("", 0)}</ul></nav>
    <div className="cd-viewer">{path ? <Viewer key={path} workspace={workspace} path={path} /> : <p className="cd-quiet cd-pad">Choose a file.</p>}</div>
  </div>;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function Viewer({ workspace, path }: { workspace: Workspace; path: string }) {
  const [state, setState] = useState<{ text: string } | { picture: string } | { binary: number } | { problem: string } | null>(null);
  useEffect(() => {
    let picture: string | null = null;
    code.file(workspace.id, path).then((bytes) => {
      const extension = path.split(".").pop()?.toLowerCase() ?? "";
      const type = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[extension];
      if (type) { picture = URL.createObjectURL(new Blob([bytes], { type })); setState({ picture }); return; }
      try { setState({ text: decoder.decode(bytes) }); } catch { setState({ binary: bytes.byteLength }); }
    }, (error) => setState({ problem: problemText(error) }));
    return () => { if (picture) URL.revokeObjectURL(picture); };
  }, [workspace.id, path]);

  return <>
    <div className="cd-viewer-head"><span className="cd-mono">{path}</span><CopyPath path={path} /></div>
    {!state ? <div className="cd-lacquer cd-loading" aria-busy="true" />
      : "problem" in state ? <p className="cd-problem cd-pad">{state.problem}</p>
        // eslint-disable-next-line @next/next/no-img-element
        : "picture" in state ? <div className="cd-picture"><img src={state.picture} alt={path} /></div>
          : "binary" in state ? <p className="cd-quiet cd-pad">Not a text file · {readableSize(state.binary)}</p>
            : <pre className="cd-lacquer cd-source">{state.text.split("\n").map((line, n) => <span key={n} className="cd-line"><i>{n + 1}</i>{line || " "}</span>)}</pre>}
  </>;
}

function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="cd-iconbutton" aria-label={copied ? "Copied" : "Copy path"}
    onClick={() => { void navigator.clipboard.writeText(path).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
    <Icon name={copied ? "check" : "copy"} />
  </button>;
}

/* ── changes ── */

type FileDiff = { path: string; lines: string[] };

function splitDiff(diff: string): FileDiff[] {
  const out: FileDiff[] = [];
  for (const line of diff.split("\n")) {
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (head) { out.push({ path: head[2], lines: [] }); continue; }
    const current = out.at(-1);
    if (!current || /^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) |old mode|new mode)/.test(line)) continue;
    current.lines.push(line);
  }
  return out;
}

function ChangesView({ workspace, running, lastSeq }: { workspace: Workspace; running: boolean; lastSeq: number }) {
  const [changes, setChanges] = useState<Changes | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  /* Refreshes as the agent works, at most every few seconds. */
  useEffect(() => {
    const timer = setTimeout(() => code.changes(workspace.id).then((c) => { setChanges(c); setProblem(null); }, (error) => setProblem(problemText(error))), changes ? 2500 : 0);
    return () => clearTimeout(timer);
  }, [workspace.id, lastSeq, running]); // eslint-disable-line react-hooks/exhaustive-deps

  if (problem && !changes) return <p className="cd-problem cd-pad">{problem}</p>;
  if (!changes) return <div className="cd-pad"><SkeletonRows rows={4} /></div>;
  if (!changes.files.length) return <p className="cd-quiet cd-pad">No changes from {changes.base} yet.</p>;
  const diffs = new Map(splitDiff(changes.diff).map((d) => [d.path, d]));
  const added = changes.files.reduce((n, f) => n + f.additions, 0);
  const removed = changes.files.reduce((n, f) => n + f.deletions, 0);
  const letter = { added: "A", modified: "M", deleted: "D", renamed: "R" } as const;

  return <div className="cd-changes">
    <p className="cd-changes-sum"><b>{changes.files.length} {changes.files.length === 1 ? "file" : "files"}</b><span className="cd-mono">+{added} −{removed}</span><span className="cd-faint">against {changes.base}</span></p>
    {changes.files.map((file) => {
      const diff = diffs.get(file.path);
      const isOpen = !closed.has(file.path);
      return <section key={file.path} className="cd-diff">
        <button type="button" className="cd-diff-head" aria-expanded={isOpen} onClick={() => setClosed((set) => { const next = new Set(set); if (isOpen) next.add(file.path); else next.delete(file.path); return next; })}>
          <Icon name="chevron" />
          <span className="cd-status-letter" title={file.status}>{letter[file.status]}</span>
          <span className="cd-mono cd-diff-path">{file.path}</span>
          <span className="cd-mono cd-counts">+{file.additions} −{file.deletions}</span>
        </button>
        {isOpen ? diff?.lines.length
          ? <pre className="cd-lacquer cd-difflines">{diff.lines.map((line, n) => {
            const kind = line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
            return <span key={n} className="cd-line" data-kind={kind}><i aria-hidden="true">{kind === "add" ? "+" : kind === "del" ? "−" : ""}</i>{kind === "hunk" ? line : line.slice(1) || " "}</span>;
          })}</pre>
          : <p className="cd-quiet cd-pad">No text to show.</p> : null}
      </section>;
    })}
    {changes.truncated ? <p className="cd-quiet cd-pad">The rest is too long to show here.</p> : null}
  </div>;
}
