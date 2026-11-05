"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Choice, cx, InkCard, Seal } from "@kimono/ui";
import { useCrossTo } from "@/components/crossing";
import { SkeletonChat, SkeletonRows } from "@/components/skeleton";
import {
  code, drive, efforts, elapsed, isPicture, readableSize, when, type DriveItem, type DriveSpace,
  type Attachment, type Changes, type CodeEvent, type Entry, type Repository, type StoredEvent, type Workspace, type Effort, type Usage,
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

type Tab = "chat" | "files" | "changes" | "app";
const problemText = (error: unknown, fallback = "That didn't work.") => error instanceof Error ? error.message : fallback;
const repoName = (w: Pick<Workspace, "repo">) => `${w.repo.owner}/${w.repo.name}`;
/** Kimono Git and attachments open in their own tab; nothing here leaves the page it is on. */
const openOutside = (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); };

/*
 * Code's screens (which task, which view, a new task) live after the # in the
 * address. Back and forward then move between screens inside this page; a
 * query string would make Next.js treat each one as a new page to fetch, and
 * going back would wait on that.
 */
const codeNav = "kimono-code-nav";
function goTo(to: Record<string, string | null>, replace = false) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(to)) if (value) next.set(key, value);
  const url = `/code${next.size ? `#${next}` : ""}`;
  /* Keep Next.js's own history state, so its back button handling sees this as the same page. */
  if (replace) window.history.replaceState(window.history.state, "", url); else window.history.pushState(window.history.state, "", url);
  window.dispatchEvent(new Event(codeNav));
}

function hashNow() { return window.location.hash.slice(1); }
function subscribeNav(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  window.addEventListener(codeNav, listener);
  return () => { window.removeEventListener("hashchange", listener); window.removeEventListener("popstate", listener); window.removeEventListener(codeNav, listener); };
}
function useCodeParams() {
  const hash = useSyncExternalStore(subscribeNav, hashNow, () => "");
  return useMemo(() => new URLSearchParams(hash), [hash]);
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

/* Whether the task list is folded away: per browser, read on the device only. */
const foldKey = "kimono-code-tasks-folded";
const foldListeners = new Set<() => void>();
function foldedNow() { try { return window.localStorage.getItem(foldKey) === "1"; } catch { return false; } }
function setFolded(folded: boolean) {
  try { window.localStorage.setItem(foldKey, folded ? "1" : "0"); } catch { /* private window: this page only */ }
  foldListeners.forEach((listener) => listener());
}
function useFolded() {
  return useSyncExternalStore((listener) => { foldListeners.add(listener); return () => { foldListeners.delete(listener); }; }, foldedNow, () => false);
}

/* How hard the agent thinks: each person's own choice, remembered in this browser. */
const effortKey = "kimono-code-effort";
const effortListeners = new Set<() => void>();
function effortNow(): Effort { try { const v = window.localStorage.getItem(effortKey); return (efforts as readonly string[]).includes(v ?? "") ? v as Effort : "high"; } catch { return "high"; } }
function setEffort(effort: Effort) {
  try { window.localStorage.setItem(effortKey, effort); } catch { /* private window: this page only */ }
  effortListeners.forEach((listener) => listener());
}
function useEffort() {
  return useSyncExternalStore((listener) => { effortListeners.add(listener); return () => { effortListeners.delete(listener); }; }, effortNow, () => "high" as Effort);
}
const effortWords: Record<Effort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };

/** The thinking level, as a compact chip in the message box. Opus 5.5 is the only model. */
function EffortPicker() {
  const effort = useEffort();
  return <Choice compact label="Opus 5.5 ·" aria-label="How hard Opus 5.5 thinks" className="cd-effort" value={effort} onChange={(next) => setEffort(next as Effort)}
    options={efforts.map((e) => ({ value: e, label: effortWords[e] }))} />;
}

/** A ring that fills as something is used: a pie chart's quieter cousin. */
function Ring({ value, label }: { value: number | null; label: string }) {
  const r = 8, c = 2 * Math.PI * r, v = value == null ? 0 : Math.max(0, Math.min(1, value));
  return <svg className={cx("cd-ring", v >= .9 && "is-high", value == null && "is-unknown")} viewBox="0 0 22 22" role="img" aria-label={label}>
    <circle cx="11" cy="11" r={r} className="track" />
    {v > 0 ? <circle cx="11" cy="11" r={r} className="arc" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 11 11)" /> : null}
  </svg>;
}

const fallbackWindow = 200_000;
const kTokens = (n: number) => n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const resetWords = (at: number | null) => at ? new Date(at).toLocaleString("en", { weekday: "short", hour: "numeric", minute: "2-digit" }) : null;

/** Context, the 5-hour window and the week, as three rings beside Send; open them for the numbers and to compact. */
function Meters({ workspace, context, running, blocked }: { workspace: Workspace; context: { used: number; window?: number } | null; running: boolean; blocked: string | null }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [open, setOpen] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { let live = true; code.usage().then((u) => { if (live) setUsage(u); }, () => {}); return () => { live = false; }; }, [running]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const window = context?.window ?? fallbackWindow;
  const ctx = context ? context.used / window : null;
  const share = (w: Usage["week"], plan: number | null) => !usage?.reported ? null : usage.unlimited ? plan : w.used / w.share;
  const five = usage ? share(usage.fiveHour, usage.plan?.fiveHour ?? null) : null;
  const week = usage ? share(usage.week, usage.plan?.week ?? null) : null;
  const whose = usage?.unlimited ? "of the plan" : "of your share";
  /* Usage arrives but never a 5-hour figure: this plan has no 5-hour window, so there's no ring for it. */
  const noFiveHour = Boolean(usage?.reported && usage.fiveHourLimited === false);
  return <div className="cd-meters" ref={box}>
    <button type="button" className="cd-meters-btn" aria-expanded={open} aria-label="Context and usage" title="Context and usage" onClick={() => setOpen(!open)}>
      <Ring value={ctx} label={ctx == null ? "Context not known yet" : `Context ${pct(ctx)} full`} />
      {noFiveHour ? null : <Ring value={five} label={five == null ? "5-hour use not reported" : `${pct(five)} of the 5-hour window`} />}
      <Ring value={week} label={week == null ? "Weekly use not reported" : `${pct(week)} of the week`} />
    </button>
    {open ? <div className="cd-meters-pop" role="dialog" aria-label="Context and usage">
      <div className="cd-meter"><Ring value={ctx} label="Context" /><span><b>Context</b><small>{context ? `${kTokens(context.used)} of ${kTokens(window)} tokens${context.window ? "" : " (about)"}` : "Known after the next reply"}</small></span>
        <Seal type="button" compact tone="quiet" disabled={compacting || Boolean(blocked) || !context} onClick={() => { setCompacting(true); setProblem(null); code.ask(workspace.id, "/compact", [], effortNow()).then(() => { setCompacting(false); setOpen(false); }, (error) => { setProblem(problemText(error)); setCompacting(false); }); }}>{compacting ? "Compacting…" : running ? "Compact after this" : "Compact now"}</Seal></div>
      <p className="cd-meter-note">Compacting folds the conversation so far into a summary, so there&rsquo;s room to keep going. It also happens by itself when the context fills.</p>
      <div className="cd-meter"><Ring value={five} label="5-hour window" /><span><b>5-hour window</b><small>{noFiveHour ? "This plan has no 5-hour limit" : five == null ? "Not reported yet" : `${pct(five)} ${whose}${usage?.fiveHour.resetsAt ? ` · resets ${resetWords(usage.fiveHour.resetsAt)}` : ""}`}</small></span></div>
      <div className="cd-meter"><Ring value={week} label="This week" /><span><b>This week</b><small>{week == null ? "Not reported yet" : `${pct(week)} ${whose}${usage?.week.resetsAt ? ` · resets ${resetWords(usage.week.resetsAt)}` : ""}`}</small></span></div>
      {usage && !usage.unlimited ? <p className="cd-meter-note">Your share is {noFiveHour ? `${pct(usage.week.share)} of the week` : `${pct(usage.fiveHour.share)} of each 5-hour window and ${pct(usage.week.share)} of the week`}.</p> : null}
      {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
    </div> : null}
  </div>;
}

export function CodeApp({ blocked }: { blocked: string | null }) {
  const params = useCodeParams();
  /* Old links carried the screen in the query string: move it after the #, once. */
  useEffect(() => {
    if (window.location.search) goTo(Object.fromEntries(new URLSearchParams(window.location.search)), true);
  }, []);
  const current = params.get("w");
  /* On a narrow screen Code opens on the task list; the new-task form is its own screen, as on the phone. */
  const composing = params.get("new") === "1";
  const tab = (["chat", "files", "changes", "app"].includes(params.get("tab") ?? "") ? params.get("tab") : "chat") as Tab;
  const path = params.get("path") ?? "";
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => code.workspaces().then((list) => { setWorkspaces(list); setProblem(null); }, (error) => setProblem(problemText(error, "Code isn't answering."))), [setWorkspaces]);
  useEffect(() => { void load(); }, [load]);

  const workspace = workspaces?.find((w) => w.id === current) ?? null;
  const folded = useFolded();
  const running = workspaces?.some((w) => w.turn?.state === "running") ?? false;
  const now = useNow(running);

  /* ⌘K or / jumps to a new task from anywhere on the page. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); goTo({ new: "1" }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <div className="cd-page">
    <div className={cx("cd", current && "has-workspace", composing && "is-composing", folded && "is-folded")}>
    <aside className="cd-side" aria-label="Tasks">
      <div className="cd-side-head"><button type="button" className="cd-roundbutton cd-fold" onClick={() => setFolded(true)} aria-label="Hide tasks" title="Hide tasks"><Icon name="panel" /></button><span>Tasks</span><button type="button" className="cd-roundbutton" onClick={() => goTo({ new: "1" })} aria-keyshortcuts="Meta+K" aria-label="New task" title="New task (⌘K)" aria-current={!current ? "page" : undefined}><Icon name="plus" /></button></div>
      {problem ? <p className="cd-quiet cd-side-note">{problem} <button type="button" className="cd-textbutton" onClick={() => void load()}>Retry</button></p> : null}
      {workspaces === null && !problem ? <SkeletonRows rows={4} mark={false} /> : null}
      {projectsOf(workspaces ?? []).map((project) => <WorkspaceList key={project.key} label={project.name} list={project.tasks} current={current} now={now}
        onNew={() => { try { localStorage.setItem("kimono-code-repo", project.key); } catch { /* not remembered */ } goTo({ new: "1" }); }} />)}
      {workspaces && !workspaces.length ? <p className="cd-quiet cd-side-note">Nothing yet.</p> : null}
    </aside>
    <main className="cd-main">
      {current && workspace
        ? <WorkspaceView key={workspace.id} workspace={workspace} others={workspaces?.filter((w) => w.id !== workspace.id && w.preview) ?? []} tab={tab} path={path} blocked={blocked} onChange={load} now={now} />
        : current && workspaces
          ? <div className="cd-sheet cd-empty"><p>That workspace isn&rsquo;t here any more.</p><Seal type="button" tone="quiet" onClick={() => goTo({ new: "1" })}>New task</Seal></div>
          : current
            ? <div className="cd-sheet cd-loading"><div className="cd-timeline"><SkeletonChat /></div></div>
            : <Start blocked={blocked} onStarted={async (made) => { setWorkspaces((list) => [made, ...(list ?? []).filter((w) => w.id !== made.id)]); goTo({ w: made.id }); void load(); }} />}
    </main>
    </div>
  </div>;
}

/** Tasks under their project: the project with the latest activity first, and in each, a working task first, then the newest. */
function projectsOf(list: Workspace[]) {
  const byRepo = new Map<string, Workspace[]>();
  for (const w of list) {
    const key = `${w.repo.owner}/${w.repo.name}`;
    byRepo.set(key, [...(byRepo.get(key) ?? []), w]);
  }
  const working = (w: Workspace) => w.turn?.state === "running" ? 1 : 0;
  return [...byRepo.entries()]
    .map(([key, tasks]) => ({ key, name: tasks[0].repo.name, tasks: tasks.toSorted((a, b) => working(b) - working(a) || b.updatedAt - a.updatedAt) }))
    .toSorted((a, b) => Math.max(...b.tasks.map(working)) - Math.max(...a.tasks.map(working)) || b.tasks[0].updatedAt - a.tasks[0].updatedAt);
}

function WorkspaceList({ label, list, current, now, onNew }: { label: string; list: Workspace[]; current: string | null; now: number; onNew?: () => void }) {
  if (!list.length) return null;
  return <div className="cd-project">
    <div className="cd-side-label cd-project-head"><span className="cd-mono">{label}</span><small>{list.length}</small>{onNew ? <button type="button" className="cd-roundbutton cd-project-new" onClick={onNew} aria-label={`New task in ${label}`} title={`New task in ${label}`}><Icon name="plus" /></button> : null}</div>
    <nav className="cd-list">{list.map((w) => {
      const state = w.turn?.state;
      return <button type="button" key={w.id} aria-current={w.id === current ? "page" : undefined} onClick={() => goTo({ w: w.id })}>
        <b>{w.title}</b>
        <small>
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
      await onStarted(await code.start({ owner: chosen.owner, name: chosen.name, base: base || chosen.defaultBranch, prompt, effort: effortNow() }));
    } catch (error) {
      setProblem(problemText(error));
      setSending(false);
    }
  }

  return <section className="cd-start">
    <div className="cd-start-head"><button type="button" className="cd-roundbutton cd-start-back" onClick={() => goTo({})} aria-label="All tasks" title="All tasks"><Icon name="back" /></button><button type="button" className="cd-roundbutton cd-unfold" onClick={() => setFolded(false)} aria-label="Show tasks" title="Show tasks"><Icon name="panel" /></button><h2>What should we work on?</h2></div>
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

  const [confirmDelete, setConfirmDelete] = useState(false);
  const crossTo = useCrossTo();
  /* As on the phone: the title and repo, the few things you reach for (the running app, the
     pull request, Drive, delete) as quiet links and icons, one strong seal to publish, then the tabs. */
  return <div className="cd-ws-grid">
    <div className="cd-sheet cd-ws">
      <header className="cd-ws-head">
        <button type="button" className="cd-roundbutton cd-back" onClick={() => goTo({})} aria-label="All tasks" title="All tasks"><Icon name="back" /></button>
        <button type="button" className="cd-roundbutton cd-unfold" onClick={() => setFolded(false)} aria-label="Show tasks" title="Show tasks"><Icon name="panel" /></button>
        <div className="cd-ws-id">
          <h1 title={workspace.title}>{workspace.title}</h1>
          <p className="cd-mono">{repoName(workspace)} · {workspace.branch}</p>
        </div>
        {confirmDelete
          ? <div className="cd-ws-acts"><span className="cd-faint">Delete the sandbox? Its files stay in Drive.</span><button type="button" className="cd-quietbutton is-danger" onClick={() => void remove()}>Delete</button><button type="button" className="cd-quietbutton" onClick={() => setConfirmDelete(false)}>Keep</button></div>
          : <div className="cd-ws-acts">
              {workspace.preview ? <button type="button" className="cd-linkbutton" onClick={() => openOutside(workspace.preview!.url)}><Icon name="open" />Open app</button> : null}
              {workspace.pullRequest ? <button type="button" className="cd-linkbutton" onClick={() => openOutside(workspace.pullRequest!.url)}><Icon name="pr" />Pull request #{workspace.pullRequest.number}</button> : null}
              {workspace.drive ? <button type="button" className="cd-roundbutton" aria-label="Open in Drive" title="Open in Drive" onClick={() => crossTo("kakejiku", `/drive?space=${workspace.drive!.spaceId}&folder=${workspace.drive!.folderId}`)}><Icon name="folder" /></button> : null}
              <button type="button" className="cd-roundbutton" aria-label="Delete task" title="Delete task" onClick={() => setConfirmDelete(true)}><Icon name="trash" /></button>
              <Seal type="button" compact tone={workspace.pullRequest ? "quiet" : "primary"} disabled={running || publishing || Boolean(blocked)} onClick={() => void publish()}>
                {publishing ? "Pushing…" : workspace.pullRequest ? "Push changes" : "Open pull request"}
              </Seal>
            </div>}
      </header>
      <div className="cd-segs">
        <div className="cd-seg" role="tablist" aria-label="Views">
          {([["chat", "Chat"], ["files", "Files"], ["changes", "Changes"], ["app", "App"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => go({ tab: id })}>{tab === id ? <Icon name="check" /> : id === "app" && workspace.preview ? <i className="cd-live-dot" aria-label="running" /> : null}{label}</button>
          ))}
        </div>
        {running ? <span className="cd-status running" role="status"><i aria-hidden="true" />Working {elapsed(now - workspace.turn!.startedAt)}</span>
          : !connected ? <span className="cd-status">Reconnecting…</span> : null}
      </div>
      {problem ? <p className="cd-problem cd-ws-problem" role="alert">{problem}</p> : null}
      {tab === "chat" ? <Chat workspace={workspace} events={events} running={running} blocked={blocked} />
        : tab === "files" ? <Files workspace={workspace} path={path} onOpen={(path) => go({ tab: "files", path })} />
          : tab === "app" ? <AppView workspace={workspace} running={running} blocked={blocked} onChange={onChange} />
            : <ChangesView workspace={workspace} running={running} lastSeq={events.at(-1)?.seq ?? 0} />}
    </div>
    <aside className="cd-deploy" aria-label="Running apps"><Deployments workspace={workspace} others={others} /></aside>
  </div>;
}

/** On a wide window, beside the conversation: this task's running app, and every other task's. */
function Deployments({ workspace, others }: { workspace: Workspace; others: Workspace[] }) {
  return <div className="cd-deployments">
    <h2>Running apps</h2>
    {workspace.preview
      ? <PreviewCard workspace={workspace} url={workspace.preview.url} live />
      : <div className="cd-dep-row"><span className="cd-dep-icon"><Icon name="rocket" /></span><span><b>This task isn&rsquo;t running an app</b><small>Ask the agent to run it and it appears here.</small></span></div>}
    {others.length ? <div className="cd-dep-list">{others.map((w) => <button type="button" key={w.id} className="cd-dep-row is-link" onClick={() => goTo({ w: w.id })}>
      <span className="cd-dep-icon is-live"><Icon name="rocket" /></span>
      <span><b>{w.title}</b><small className="cd-mono">{w.preview!.url.replace(/^https?:\/\//, "")}</small></span>
    </button>)}</div> : null}
  </div>;
}

/** The App tab: the running app, big, with everything you do to it, and the app itself below. */
function AppView({ workspace, running, blocked, onChange }: { workspace: Workspace; running: boolean; blocked: string | null; onChange: () => void }) {
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!workspace.preview) return <div className="cd-scroll cd-appview">
    <div className="cd-app-empty">
      <span className="cd-dep-icon"><Icon name="rocket" /></span>
      <b>Nothing is running</b>
      <p className="cd-faint">The agent runs the app when it changes something you can see. You can ask it to now.</p>
      <Seal type="button" disabled={asking || Boolean(blocked)} onClick={() => { setAsking(true); setProblem(null); code.ask(workspace.id, "Run the app and show it to me.", [], effortNow()).then(() => goTo({ w: workspace.id }), (error) => { setProblem(problemText(error)); setAsking(false); }); }}>{asking ? "Asking…" : running ? "Run it after this step" : "Run the app"}</Seal>
      {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
    </div>
  </div>;
  return <div className="cd-scroll cd-appview">
    <AppReady workspace={workspace} url={workspace.preview.url} />
    <LinkName key={workspace.preview.url} workspace={workspace} url={workspace.preview.url} onRenamed={onChange} />
    <div className="cd-app-frame">
      <div className="cd-app-bar"><i /><i /><i /><span className="cd-mono">{workspace.preview.url.replace(/^https?:\/\//, "")}</span></div>
      <iframe src={workspace.preview.url} title="The running app" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
    </div>
  </div>;
}

/** The app's link, renamed by its owner: [recipes].example.dev. */
function LinkName({ workspace, url, onRenamed }: { workspace: Workspace; url: string; onRenamed: () => void }) {
  const address = new URL(url);
  const [label, ...rest] = address.hostname.split(".");
  const suffix = `.${rest.join(".")}${address.port ? `:${address.port}` : ""}`;
  const [name, setName] = useState(label);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const clean = name.trim().toLowerCase();
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!clean || clean === label || saving) return;
    setSaving(true); setProblem(null);
    try { await code.renamePreview(workspace.id, clean); onRenamed(); } catch (error) { setProblem(problemText(error)); setSaving(false); }
  }
  return <form className="cd-linkname" onSubmit={(event) => void save(event)}>
    <label className="cd-linkname-field">
      <small>Link name</small>
      <span><input value={name} maxLength={50} spellCheck={false} autoCapitalize="off" aria-label="Link name" style={{ width: `${Math.max(4, name.length + 1)}ch` }}
        onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} /><em>{suffix}</em></span>
    </label>
    <Seal type="submit" compact disabled={!clean || clean === label || saving}>{saving ? "Saving…" : "Rename"}</Seal>
    {problem ? <p className="cd-problem" role="alert">{problem}</p>
      : <p className="cd-faint">The old link stops working. A name of your own is easier to share, and easier to guess: anyone with the link can open the app.</p>}
  </form>;
}

/** The app, ready: one big card to open it, copy its link or take it down. */
function AppReady({ workspace, url }: { workspace: Workspace; url: string }) {
  const [copied, setCopied] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return <InkCard colour="#5c7150" seed={`ready-${workspace.id}`} className="cd-ready-ink"><div className="cd-ready">
    <span className="cd-ready-mark" aria-hidden="true"><Icon name="open" /></span>
    <span className="cd-ready-text"><b>Your app is ready</b><span className="cd-mono">{url.replace(/^https?:\/\//, "")}</span></span>
    <div className="cd-ready-acts">
      <Seal type="button" className="cd-ready-open" onClick={() => openOutside(url)}><Icon name="open" />Open app</Seal>
      <button type="button" className="cd-quietbutton" onClick={() => { void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => setProblem("Couldn't copy. Select the address above.")); }}>{copied ? "Copied" : "Copy link"}</button>
      <button type="button" className="cd-quietbutton" disabled={stopping} onClick={() => { setStopping(true); code.stopPreview(workspace.id).catch((error) => { setProblem(problemText(error)); setStopping(false); }); }}>{stopping ? "Taking down…" : "Take down"}</button>
    </div>
    {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
  </div></InkCard>;
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
  | { type: "preview-stopped"; seq: number }
  | { type: "compacted"; seq: number; before?: number };

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
      case "compacted": items.push({ type: "compacted", seq, before: event.before }); break;
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
  const lastContext = (items.findLast((i) => i.type === "done" && i.event.context) as Extract<Item, { type: "done" }> | undefined)?.event.context ?? null;
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
            case "preview": return <PreviewCard key={item.seq} workspace={workspace} url={item.event.url} live={running && workspace.preview?.url === item.event.url && item.seq === lastPreview} />;
            case "preview-stopped": return <p key={item.seq} className="cd-note">The app&rsquo;s link was taken down.</p>;
            case "compacted": return <p key={item.seq} className="cd-note cd-compacted"><Icon name="diff" />Compacted the conversation{item.before ? <span className="cd-mono"> · it held {kTokens(item.before)} tokens</span> : null}</p>;
            case "published": return <p key={item.seq} className="cd-note"><Icon name="pr" />Opened <button type="button" className="cd-textbutton" onClick={() => openOutside(item.event.url)}>pull request #{item.event.number}</button></p>;
          }
        })}
        {running && items.at(-1)?.type !== "tools" ? <p className="cd-thinking"><i aria-hidden="true" />Working</p> : null}
        {!running && workspace.preview && items.at(-1)?.type !== "ask" ? <AppReady workspace={workspace} url={workspace.preview.url} /> : null}
      </div>
      {away ? <div className="cd-latest-wrap"><button type="button" className="cd-latest" onClick={() => { const el = scroller.current; if (el) { el.scrollTop = el.scrollHeight; pinned.current = true; setAway(false); } }}>Latest ↓</button></div> : null}
    </div>
    <Composer workspace={workspace} running={running} blocked={blocked} context={lastContext} />
  </div>;
}

function Ask({ workspace, item }: { workspace: Workspace; item: Extract<Item, { type: "ask" }> }) {
  const { text, attachments, queued } = item.event;
  if (text.trim() === "/compact" && !attachments.length) return <p className="cd-note"><Icon name="diff" />You asked it to compact the conversation{queued ? " after this step" : ""}</p>;
  return <div className={cx("cd-ask", queued && "is-queued")} title={queued ? "Sent while it was working: read as soon as the current step ends" : undefined}>
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

function Composer({ workspace, running, blocked, context }: { workspace: Workspace; running: boolean; blocked: string | null; context: { used: number; window?: number } | null }) {
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
  const canSend = !sending && !uploading && !blocked && (text.trim().length > 0 || ready.length > 0);

  async function send() {
    if (!canSend) return;
    setSending(true);
    setProblem(null);
    try {
      await code.ask(workspace.id, text, ready, effortNow());
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
      placeholder={blocked ? blocked : running ? "Steer it: this is read as soon as the current step ends" : "Ask for a change, or reply"}
      disabled={Boolean(blocked)}
      onChange={(event) => setText(event.target.value)}
      onPaste={(event) => { const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); add(files); } }}
      onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} />
    <div className="cd-composer-bar">
      <input ref={picker} type="file" multiple hidden onChange={(event) => { add([...(event.target.files ?? [])]); event.target.value = ""; }} />
      <button type="button" className="cd-iconbutton" aria-label="Attach files" disabled={Boolean(blocked)} onClick={() => picker.current?.click()}><Icon name="clip" /></button>
      {workspace.drive ? <button type="button" className="cd-iconbutton" aria-label="Attach from Drive" title="Attach from Drive" disabled={Boolean(blocked)} onClick={() => setChoosing(true)}><Icon name="folder" /></button> : null}
      <EffortPicker />
      {problem ? <span className="cd-problem" role="alert">{problem}</span> : null}
      <span className="cd-grow" />
      <Meters workspace={workspace} context={context} running={running} blocked={blocked} />
      {running ? <button type="button" className="cd-roundbutton cd-stop" aria-label="Stop the agent" title="Stop the agent" onClick={() => void code.stop(workspace.id).catch((error) => setProblem(problemText(error)))}><Icon name="stop" /></button> : null}
      <Seal type="button" compact disabled={!canSend} onClick={() => void send()} aria-keyshortcuts="Meta+Enter" title="Send (⌘↵)">Send</Seal>
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
