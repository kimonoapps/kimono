"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppBloom, Choice, cx, InkCard, Seal, type AppIdentity } from "@kimono/ui";
import { useCrossTo } from "@/components/crossing";
import { SkeletonChat, SkeletonRows } from "@/components/skeleton";
import { swap } from "@/components/motion";
import {
  code, drive, efforts, elapsed, gigabytes, isPicture, readableSize, when, type DriveItem, type DriveSpace,
  type AccessSettings, type ConnectableApp, type Connection, type AppHealth, type SandboxStatus, type Attachment, type Changes, type CodeEvent, type Entry, type Repository, type StoredEvent, type Workspace, type Effort, type Usage,
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
  return <Choice compact label="Thinking ·" aria-label="How hard it thinks" className="cd-effort" value={effort} onChange={(next) => setEffort(next as Effort)}
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

export function CodeApp({ blocked, admin, driveApp }: { blocked: string | null; admin: boolean; driveApp: AppIdentity }) {
  const [accessOpen, setAccessOpen] = useState(false);
  /* Drive's mark and each space's crest, for tool calls and access cards that touch the person's files. */
  const [spaces, setSpaces] = useState<DriveSpace[]>([]);
  useEffect(() => { drive.spaces().then(setSpaces, () => {}); }, []);
  const marks = useMemo<Marks>(() => ({ drive: driveApp, spaces: new Map(spaces.map((space) => [space.name.toLowerCase(), space])) }), [driveApp, spaces]);
  const params = useCodeParams();
  /* Old links carried the screen in the query string: move it after the #, once. */
  useEffect(() => {
    if (window.location.search) goTo(Object.fromEntries(new URLSearchParams(window.location.search)), true);
  }, []);
  const current = params.get("w");
  /* Connections: the apps this person has connected, a page of its own in the list. */
  const showingConnections = !current && params.get("connections") === "1";
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

  /* / jumps to a new task from anywhere on the page, unless you're typing. (⌘K is every app's.) */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); goTo({ new: "1" }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <MarksContext.Provider value={marks}><div className="cd-page">
    {accessOpen ? <AccessDialog onClose={() => setAccessOpen(false)} /> : null}
    <div className={cx("cd", current && "has-workspace", composing && "is-composing", folded && "is-folded")}>
    <aside className="cd-side" aria-label="Chats">
      <div className="cd-side-head"><button type="button" className="cd-roundbutton cd-fold" onClick={() => setFolded(true)} aria-label="Hide chats" title="Hide chats"><Icon name="panel" /></button><span>Chats</span><button type="button" className="cd-roundbutton" onClick={() => setAccessOpen(true)} aria-label="What Kimono AI can use" title="What Kimono AI can use"><Icon name="lock" /></button></div>
      <button type="button" className="cd-newchat" onClick={() => goTo({ new: "1" })} aria-keyshortcuts="/" aria-current={!current && !showingConnections ? "page" : undefined}><Icon name="plus" /><span>New chat</span></button>
      <nav className="cd-sidenav" aria-label="More">
        <button type="button" aria-current={showingConnections ? "page" : undefined} onClick={() => goTo({ connections: "1" })}><Icon name="link" /><span>Connections</span></button>
      </nav>
      {problem ? <p className="cd-quiet cd-side-note">{problem} <button type="button" className="cd-textbutton" onClick={() => void load()}>Retry</button></p> : null}
      {workspaces === null && !problem ? <SkeletonRows rows={4} mark={false} /> : null}
      <WorkspaceList list={chatsOf(workspaces ?? [])} current={current} now={now} />
      {projectsOf(workspaces ?? []).map((project) => <WorkspaceList key={project.key} label={project.name} list={project.tasks} current={current} now={now}
        onNew={admin ? () => { try { localStorage.setItem("kimono-code-repo", project.key); localStorage.setItem("kimono-ai-project", "1"); } catch { /* not remembered */ } goTo({ new: "1" }); } : undefined} />)}
      {workspaces && !workspaces.length ? <p className="cd-quiet cd-side-note">Your chats will be here.</p> : null}
    </aside>
    <main className="cd-main">
      {current && workspace
        ? <WorkspaceView key={workspace.id} workspace={workspace} others={workspaces?.filter((w) => w.id !== workspace.id && w.preview && !w.preview.stopped) ?? []} tab={tab} path={path} blocked={blocked} onChange={load} now={now} />
        : current && workspaces
          ? <div className="cd-sheet cd-empty"><p>That chat isn&rsquo;t here any more.</p><Seal type="button" tone="quiet" onClick={() => goTo({ new: "1" })}>New chat</Seal></div>
          : current
            ? <div className="cd-sheet cd-loading"><div className="cd-timeline"><SkeletonChat /></div></div>
            : showingConnections ? <ConnectionsView now={now} />
            : <Start blocked={blocked} admin={admin} onStarted={async (made) => { setWorkspaces((list) => [made, ...(list ?? []).filter((w) => w.id !== made.id)]); goTo({ w: made.id }); void load(); }} />}
    </main>
    </div>
  </div></MarksContext.Provider>;
}

/* ── connections: the person's own apps, as Composio keeps them ── */

function ConnectionsView({ now }: { now: number }) {
  const [state, setState] = useState<{ available: boolean; connections: Connection[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ q: string; apps: ConnectableApp[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const load = useCallback(() => code.connections().then((next) => { setState(next); setProblem(null); }, (error) => setProblem(problemText(error))), []);
  /* Connecting happens in another tab: coming back here shows it. */
  useEffect(() => {
    void load();
    const back = () => { void load(); };
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, [load]);
  useEffect(() => {
    if (!state?.available) return;
    const wait = setTimeout(() => { code.findApps(query).then((apps) => setFound({ q: query, apps }), (error) => setProblem(problemText(error))); }, query ? 250 : 0);
    return () => clearTimeout(wait);
  }, [query, state?.available]);
  const connect = (app: string) => {
    setBusy(app); setProblem(null);
    const opened = window.open("about:blank", "_blank");
    code.connect(app).then((url) => { if (opened) opened.location.href = url; else window.location.href = url; }, (error) => { opened?.close(); setProblem(problemText(error)); }).finally(() => setBusy(null));
  };
  const remove = (c: Connection) => {
    setBusy(c.account); setProblem(null);
    code.disconnect(c.account).then(() => { setConfirming(null); return load(); }, (error) => setProblem(problemText(error))).finally(() => setBusy(null));
  };
  const apps = found && found.q === query ? found.apps : null;
  return <section className="cd-sheet cd-conn">
    <header className="cd-conn-head">
      <button type="button" className="cd-roundbutton cd-back" onClick={() => goTo({})} aria-label="All chats" title="All chats"><Icon name="back" /></button>
      <button type="button" className="cd-roundbutton cd-unfold" onClick={() => setFolded(false)} aria-label="Show chats" title="Show chats"><Icon name="panel" /></button>
      <h1>Connections</h1>
    </header>
    <div className="cd-conn-body">
      {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
      {state === null && !problem ? <SkeletonRows rows={3} mark={false} /> : null}
      {state && !state.available ? <p className="cd-conn-empty">Connections aren&rsquo;t available on this Kimono yet.</p> : null}
      {state?.available ? <>
        {state.connections.length ? <ul className="cd-conn-list">{state.connections.map((c) => <li key={c.account} className="cd-conn-card">
          {/* eslint-disable-next-line @next/next/no-img-element -- the app's own logo, as Composio serves it */}
          <span className="cd-conn-logo"><img src={c.logo} alt="" /></span>
          <span className="cd-conn-id"><b>{c.name}</b><small>{c.status === "ACTIVE" ? c.since ? `Connected ${when(Date.parse(c.since), now).replace(/^(Today|Yesterday)/, (word) => word.toLowerCase())}` : "Connected" : c.status === "FAILED" ? "Needs connecting again" : "Connecting…"}</small></span>
          {confirming === c.account
            ? <span className="cd-conn-acts"><button type="button" className="cd-quietbutton is-danger" disabled={busy === c.account} onClick={() => remove(c)}>{busy === c.account ? "Disconnecting…" : "Disconnect"}</button><button type="button" className="cd-quietbutton" onClick={() => setConfirming(null)}>Keep</button></span>
            : <span className="cd-conn-acts">{c.status === "FAILED" ? <Seal type="button" compact onClick={() => connect(c.app)}>Connect again</Seal> : null}<button type="button" className="cd-quietbutton" onClick={() => setConfirming(c.account)}>Disconnect</button></span>}
        </li>)}</ul> : state ? <p className="cd-conn-empty">Nothing connected yet.</p> : null}
        <h2 className="cd-conn-sub">Connect an app</h2>
        <label className="cd-conn-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search apps" aria-label="Search apps" /></label>
        {apps === null ? <SkeletonRows rows={2} mark={false} /> : !apps.length ? <p className="cd-conn-empty">No app by that name.</p> : <ul className="cd-conn-grid">{apps.map((a) => <li key={a.app} className="cd-conn-tile">
          {/* eslint-disable-next-line @next/next/no-img-element -- the app's own logo, as Composio serves it */}
          <span className="cd-conn-logo"><img src={a.logo} alt="" /></span>
          <span className="cd-conn-id"><b>{a.name}</b>{a.description ? <small>{a.description}</small> : null}</span>
          {a.connected ? <span className="cd-conn-on"><Icon name="check" />Connected</span> : <Seal type="button" compact tone="quiet" disabled={busy === a.app} onClick={() => connect(a.app)}>{busy === a.app ? "Opening…" : "Connect"}</Seal>}
        </li>)}</ul>}
      </> : null}
    </div>
  </section>;
}

/* ── marks: what a call or a card is about, drawn as that thing ── */

type Marks = { drive: AppIdentity | null; spaces: Map<string, DriveSpace> };
const MarksContext = createContext<Marks>({ drive: null, spaces: new Map() });

/** A space's crest, as Drive draws it; nothing if the space isn't known. */
function SpaceCrest({ name }: { name: string }) {
  const space = useContext(MarksContext).spaces.get(name.toLowerCase());
  if (!space?.mark) return null;
  return <span className="cd-crest" aria-hidden="true" dangerouslySetInnerHTML={{ __html: space.mark }} />;
}

/** A space, as a chip: its crest and its name. */
function SpaceChip({ name }: { name: string }) {
  return <span className="cd-spacechip"><SpaceCrest name={name} />{name}</span>;
}

/** Kimono Drive's own mark. */
function DriveMark() {
  const drive = useContext(MarksContext).drive;
  return drive ? <AppBloom identity={drive} size="mark" className="cd-drivemark" /> : <Icon name="folder" />;
}

type Look = { name: string; logo: string };
const looks = new Map<string, Promise<Look>>();
const plainName = (slug: string) => slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** How Composio names and draws a person's own app; its plain name until that arrives. */
function useAppLook(slug: string): Look {
  const [look, setLook] = useState<(Look & { slug: string }) | null>(null);
  useEffect(() => {
    let live = true;
    let pending = looks.get(slug);
    if (!pending) {
      pending = code.appLook(slug).catch(() => ({ name: plainName(slug), logo: `https://logos.composio.dev/api/${encodeURIComponent(slug)}` }));
      looks.set(slug, pending);
    }
    void pending.then((found) => { if (live) setLook({ ...found, slug }); });
    return () => { live = false; };
  }, [slug]);
  return look?.slug === slug ? look : { name: plainName(slug), logo: "" };
}

function AppLogo({ slug }: { slug: string }) {
  const look = useAppLook(slug);
  // eslint-disable-next-line @next/next/no-img-element -- the app's own logo, as Composio serves it
  return look.logo ? <img className="cd-applogo" src={look.logo} alt="" /> : <Icon name="gear" />;
}

function AppName({ slug }: { slug: string }) {
  return <>{useAppLook(slug).name}</>;
}

/** What a call is about: the app it used, Drive, or what kind of step it was. */
function ToolMark({ tool }: { tool: Tool }) {
  if (tool.app) return <AppLogo slug={tool.app} />;
  if (tool.space) return <DriveMark />;
  return <Icon name={toolIcons[tool.label] ?? "gear"} />;
}

const working = (w: Workspace) => w.turn?.state === "running" ? 1 : 0;

/** Chats, a working one first, then the newest. */
function chatsOf(list: Workspace[]) {
  return list.filter((w) => w.kind === "chat").toSorted((a, b) => working(b) - working(a) || b.updatedAt - a.updatedAt);
}

/** Projects' chats under their project: the project with the latest activity first, and in each, a working chat first, then the newest. */
function projectsOf(list: Workspace[]) {
  const byRepo = new Map<string, Workspace[]>();
  for (const w of list) {
    if (w.kind !== "project") continue;
    const key = `${w.repo.owner}/${w.repo.name}`;
    byRepo.set(key, [...(byRepo.get(key) ?? []), w]);
  }
  return [...byRepo.entries()]
    .map(([key, tasks]) => ({ key, name: tasks[0].repo.name, tasks: tasks.toSorted((a, b) => working(b) - working(a) || b.updatedAt - a.updatedAt) }))
    .toSorted((a, b) => Math.max(...b.tasks.map(working)) - Math.max(...a.tasks.map(working)) || b.tasks[0].updatedAt - a.tasks[0].updatedAt);
}

function WorkspaceList({ label, list, current, now, onNew }: { label?: string; list: Workspace[]; current: string | null; now: number; onNew?: () => void }) {
  if (!list.length) return null;
  return <div className="cd-project">
    {label ? <div className="cd-side-label cd-project-head"><span>{label}</span><small>{list.length}</small>{onNew ? <button type="button" className="cd-roundbutton cd-project-new" onClick={onNew} aria-label={`New chat in ${label}`} title={`New chat in ${label}`}><Icon name="plus" /></button> : null}</div> : null}
    <nav className="cd-list">{list.map((w) => {
      const state = w.turn?.state;
      return <button type="button" key={w.id} aria-current={w.id === current ? "page" : undefined} onClick={() => goTo({ w: w.id })}>
        <b>{w.title}</b>
        <small>
          {/* One word, and only when it says something. */}
          {state === "running" ? <span className="cd-word running">working {elapsed(now - w.turn!.startedAt)}</span>
            : state === "failed" ? <span className="cd-word">stopped</span>
              : w.preview && !w.preview.stopped ? <span className="cd-word">live</span>
              : w.pullRequest ? <span className="cd-word">#{w.pullRequest.number}</span>
                : <span className="cd-when">{when(w.updatedAt, now)}</span>}
        </small>
      </button>;
    })}</nav>
  </div>;
}

/* ── a new task: which repository, which branch, and what to do ── */

function Start({ blocked, admin, onStarted }: { blocked: string | null; admin: boolean; onStarted: (w: Workspace) => Promise<void> }) {
  /* A new chat is just what you ask. Administrators can instead work on a project (a Kimono Git repository). */
  const [onProject, setOnProject] = useState(() => { try { return admin && localStorage.getItem("kimono-ai-project") === "1"; } catch { return false; } });
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
  const project = (on: boolean) => { setOnProject(on); try { localStorage.setItem("kimono-ai-project", on ? "1" : "0"); } catch { /* not remembered */ } };

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
    if (blocked || !onProject) return;
    code.repositories().then((list) => {
      setRepos(list);
      let remembered = "";
      try { remembered = localStorage.getItem("kimono-code-repo") ?? ""; } catch { /* private window */ }
      const first = list.find((r) => `${r.owner}/${r.name}` === remembered) ?? list[0];
      if (first) setRepo(`${first.owner}/${first.name}`);
    }, (error) => setProblem(problemText(error)));
  }, [blocked, onProject]);

  const chosen = onProject ? repos?.find((r) => `${r.owner}/${r.name}` === repo) : undefined;
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
  const ready = Boolean(prompt.trim()) && (!onProject || Boolean(chosen)) && !sending;

  async function send() {
    if (!ready) return;
    setSending(true);
    setProblem(null);
    try {
      await onStarted(await code.start(chosen
        ? { owner: chosen.owner, name: chosen.name, base: base || chosen.defaultBranch, prompt, effort: effortNow() }
        : { prompt, effort: effortNow() }));
    } catch (error) {
      setProblem(problemText(error));
      setSending(false);
    }
  }

  return <section className="cd-start">
    <div className="cd-start-head">
      <button type="button" className="cd-roundbutton cd-start-back" onClick={() => goTo({})} aria-label="All chats" title="All chats"><Icon name="back" /></button>
      <button type="button" className="cd-roundbutton cd-unfold" onClick={() => setFolded(false)} aria-label="Show chats" title="Show chats"><Icon name="panel" /></button>
    </div>
    <h2 className="cd-hello">{onProject ? "What should we build?" : "What can I do for you?"}</h2>
    <>
      {onProject && !blocked ? naming !== null || (repos && !repos.length) ? <div className="cd-naming">
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
      </div> : null}
      <div className="cd-hello-box">
        <textarea ref={field} value={prompt} rows={3} aria-label="Message" disabled={Boolean(blocked)} placeholder={onProject ? "Describe what you want, in your own words." : "Ask anything, or tell it what to do with your files."}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <div className="cd-hello-row">
          {admin && !blocked ? <button type="button" className={cx("cd-chip", onProject && "is-on")} aria-pressed={onProject} onClick={() => project(!onProject)}><Icon name="code" />Work on a project</button> : null}
          <span className="cd-grow" />
          <Seal type="button" compact disabled={!ready || Boolean(blocked)} onClick={() => void send()}>{sending ? "Starting…" : "Send"}</Seal>
        </div>
      </div>
      {blocked ? <p className="cd-hello-note">{blocked}</p> : null}
    </>
    {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
  </section>;
}

/* ── a workspace ── */

function WorkspaceView({ workspace, others, tab: asked, path, blocked, onChange, now }: { workspace: Workspace; others: Workspace[]; tab: Tab; path: string; blocked: string | null; onChange: () => void; now: number }) {
  const { events, connected } = useTimeline(workspace.id, onChange);
  /* A chat is a conversation and nothing else. Files, changes and the app (and repositories,
     branches, pull requests) belong to a chat that is building something: a project, or one with an app. */
  const project = workspace.kind === "project";
  const isApp = project || Boolean(workspace.preview);
  const tab: Tab = isApp ? asked : "chat";
  const running = workspace.turn?.state === "running";
  const [publishing, setPublishing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = (to: Partial<Record<"tab" | "path", string | null>>) => goTo({ w: workspace.id, tab: to.tab === "chat" ? null : to.tab ?? tab, path: to.path ?? null });
  // A new tab, or a new task, lifts its view into place.
  const segs = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { swap(segs.current?.parentElement?.lastElementChild ?? null); }, [tab, workspace.id]);

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
  return <div className={cx("cd-ws-grid", !isApp && "is-chat")}>
    <div className="cd-sheet cd-ws">
      <header className="cd-ws-head">
        <button type="button" className="cd-roundbutton cd-back" onClick={() => goTo({})} aria-label="All chats" title="All chats"><Icon name="back" /></button>
        <button type="button" className="cd-roundbutton cd-unfold" onClick={() => setFolded(false)} aria-label="Show chats" title="Show chats"><Icon name="panel" /></button>
        <div className="cd-ws-id">
          <h1 title={workspace.title}>{workspace.title}</h1>
          {project ? <p className="cd-mono">{repoName(workspace)} · {workspace.branch}</p> : null}
        </div>
        {!isApp && (running || !connected) ? <span className={cx("cd-status", running && "running")} role="status">{running ? <><i aria-hidden="true" />Working {elapsed(now - workspace.turn!.startedAt)}</> : "Reconnecting…"}</span> : null}
        {confirmDelete
          ? <div className="cd-ws-acts"><span className="cd-faint">Delete this chat? Its files stay in Drive.</span><button type="button" className="cd-quietbutton is-danger" onClick={() => void remove()}>Delete</button><button type="button" className="cd-quietbutton" onClick={() => setConfirmDelete(false)}>Keep</button></div>
          : !project ? <div className="cd-ws-acts">
              {workspace.preview && !workspace.preview.stopped ? <button type="button" className="cd-linkbutton" onClick={() => openOutside(workspace.preview!.url)}><Icon name="open" />Open app</button> : null}
              {workspace.drive ? <button type="button" className="cd-roundbutton" aria-label="Open in Drive" title="Open in Drive" onClick={() => crossTo("kakejiku", `/drive?space=${workspace.drive!.spaceId}&folder=${workspace.drive!.folderId}`)}><Icon name="folder" /></button> : null}
              <button type="button" className="cd-roundbutton" aria-label="Delete chat" title="Delete chat" onClick={() => setConfirmDelete(true)}><Icon name="trash" /></button>
            </div>
          : <div className="cd-ws-acts">
              {workspace.preview && !workspace.preview.stopped ? <button type="button" className="cd-linkbutton" onClick={() => openOutside(workspace.preview!.url)}><Icon name="open" />Open app</button> : null}
              {workspace.pullRequest ? <button type="button" className="cd-linkbutton" onClick={() => openOutside(workspace.pullRequest!.url)}><Icon name="pr" />Pull request #{workspace.pullRequest.number}</button> : null}
              {workspace.drive ? <button type="button" className="cd-roundbutton" aria-label="Open in Drive" title="Open in Drive" onClick={() => crossTo("kakejiku", `/drive?space=${workspace.drive!.spaceId}&folder=${workspace.drive!.folderId}`)}><Icon name="folder" /></button> : null}
              <button type="button" className="cd-roundbutton" aria-label="Delete chat" title="Delete chat" onClick={() => setConfirmDelete(true)}><Icon name="trash" /></button>
              <Seal type="button" compact tone={workspace.pullRequest ? "quiet" : "primary"} disabled={running || publishing || Boolean(blocked)} onClick={() => void publish()}>
                {publishing ? "Pushing…" : workspace.pullRequest ? "Push changes" : "Open pull request"}
              </Seal>
            </div>}
      </header>
      {isApp ? <div className="cd-segs" ref={segs}>
        <div className="cd-seg" role="tablist" aria-label="Views">
          {(project ? [["chat", "Chat"], ["files", "Files"], ["changes", "Changes"], ["app", "App"]] as const : [["chat", "Chat"], ["files", "Files"], ["app", "App"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => go({ tab: id })}>{tab === id ? <Icon name="check" /> : id === "app" && workspace.preview && !workspace.preview.stopped ? <i className="cd-live-dot" aria-label="running" /> : null}{label}</button>
          ))}
        </div>
        {running ? <span className="cd-status running" role="status"><i aria-hidden="true" />Working {elapsed(now - workspace.turn!.startedAt)}</span>
          : !connected ? <span className="cd-status">Reconnecting…</span> : null}
      </div> : <div ref={segs} hidden />}
      {problem ? <p className="cd-problem cd-ws-problem" role="alert">{problem}</p> : null}
      {tab === "chat" ? <Chat workspace={workspace} events={events} running={running} blocked={blocked} />
        : tab === "files" ? <Files workspace={workspace} path={path} onOpen={(path) => go({ tab: "files", path })} />
          : tab === "app" ? <AppView workspace={workspace} running={running} blocked={blocked} onChange={onChange} />
            : <ChangesView workspace={workspace} running={running} lastSeq={events.at(-1)?.seq ?? 0} />}
    </div>
    {isApp ? <aside className="cd-deploy" aria-label="Running apps"><Deployments workspace={workspace} others={others} /></aside> : null}
  </div>;
}

/** On a wide window, beside the conversation: this task's running app, and every other task's. */
function Deployments({ workspace, others }: { workspace: Workspace; others: Workspace[] }) {
  return <div className="cd-deployments">
    <h2>Running apps</h2>
    {workspace.preview?.stopped
      ? <button type="button" className="cd-dep-row is-link" onClick={() => goTo({ w: workspace.id, tab: "app" })}><span className="cd-dep-icon"><Icon name="rocket" /></span><span><b>This task&rsquo;s app is stopped</b><small>Start it again from the App tab.</small></span></button>
      : workspace.preview
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
    <SandboxLimits workspace={workspace} />
  </div>;
  return <div className="cd-scroll cd-appview">
    {workspace.preview.stopped ? null : <AppReady workspace={workspace} url={workspace.preview.url} />}
    <AppRunning key={workspace.id} workspace={workspace} onChange={onChange} />
    <SandboxLimits workspace={workspace} />
    <LinkName key={workspace.preview.url} workspace={workspace} url={workspace.preview.url} onRenamed={onChange} />
    {workspace.preview.stopped ? null : <div className="cd-app-frame">
      <div className="cd-app-bar"><i /><i /><i /><span className="cd-mono">{workspace.preview.url.replace(/^https?:\/\//, "")}</span></div>
      <iframe src={workspace.preview.url} title="The running app" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
    </div>}
  </div>;
}

/** What the task's sandbox may use: its CPUs and memory, and its disk against the quota. */
function SandboxLimits({ workspace }: { workspace: Workspace }) {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  useEffect(() => {
    const look = () => code.sandbox(workspace.id).then(setStatus, () => {});
    void look();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void look(); }, 60_000);
    return () => clearInterval(timer);
  }, [workspace.id]);
  if (!status) return null;
  const { limits, disk } = status;
  const share = disk.used != null ? Math.min(disk.used / disk.quota, 1) : null;
  const full = disk.used != null && disk.used > disk.quota;
  return <p className={cx("cd-limits", full && "is-full")}>
    <span>{limits.cpus} {limits.cpus === 1 ? "CPU" : "CPUs"}</span>
    <span>{gigabytes(limits.memoryMb * 1024 ** 2)} memory</span>
    <span className="cd-limits-disk">
      {share != null ? <i aria-hidden="true"><b style={{ width: `${Math.round(share * 100)}%` }} /></i> : null}
      {disk.used != null ? `${gigabytes(disk.used)} of ${gigabytes(disk.quota)} disk` : `${gigabytes(disk.quota)} disk`}
    </span>
    {full ? <em>Full. Ask the agent to free space; a little past this, work stops.</em> : null}
  </p>;
}

const healthWords: Record<AppHealth["state"], string> = {
  running: "Running", starting: "Starting", crashed: "Crashing", stopped: "Stopped", asleep: "Asleep", down: "Not answering",
};

/** How the app is doing, what it printed last, and starting or stopping it. Looked at every few seconds while the tab is open. */
function AppRunning({ workspace, onChange }: { workspace: Workspace; onChange: () => void }) {
  const [status, setStatus] = useState<{ health: AppHealth; log: string } | null>(null);
  const [acting, setActing] = useState<"restart" | "stop" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const log = useRef<HTMLPreElement>(null);
  const filled = useRef(false);
  const stopped = workspace.preview?.stopped ?? false;
  const look = useCallback(() => code.previewStatus(workspace.id).then(setStatus, () => {}), [workspace.id]);
  useEffect(() => {
    void look();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void look(); }, 4000);
    return () => clearInterval(timer);
  }, [look, stopped]);
  /* The newest output is what matters: keep the log at its end unless someone scrolled up to read. */
  useLayoutEffect(() => {
    const box = log.current;
    if (!box || !status) return;
    if (!filled.current || box.scrollHeight - box.scrollTop - box.clientHeight < 48) box.scrollTop = box.scrollHeight;
    filled.current = true;
  }, [status]);
  async function act(what: "restart" | "stop") {
    setActing(what); setProblem(null);
    try {
      await (what === "restart" ? code.restartPreview(workspace.id) : code.pausePreview(workspace.id));
      onChange();
      await look();
    } catch (error) { setProblem(problemText(error)); await look(); } finally { setActing(null); }
  }
  const health = status?.health;
  const state = stopped ? "stopped" : health?.state;
  const word = acting === "restart" ? (stopped ? "Starting" : "Restarting") : acting === "stop" ? "Stopping" : state ? healthWords[state] : "Looking";
  const detail = state === "crashed" ? `Exited${health?.exit != null ? ` with code ${health.exit}` : ""}, restarted ${health!.restarts} ${health!.restarts === 1 ? "time" : "times"}`
    : state === "asleep" ? "Wakes when someone opens the link"
      : state === "stopped" ? "The link stays. Start it again any time."
        : state === "running" && health?.restarts ? `Restarted ${health.restarts} ${health.restarts === 1 ? "time" : "times"}` : null;
  return <section className="cd-run" aria-label="The app" data-state={acting ? "starting" : state ?? "starting"}>
    <div className="cd-run-head">
      <span className="cd-run-state" role="status"><i aria-hidden="true" /><b>{word}</b>{detail ? <small>{detail}</small> : null}</span>
      {stopped && workspace.preview?.kind ? <span className="cd-run-kind">{workspace.preview.kind}</span> : null}
      <div className="cd-run-acts">
        {stopped
          ? <Seal type="button" compact disabled={Boolean(acting)} onClick={() => void act("restart")}><Icon name="play" />Start</Seal>
          : <>
              <button type="button" className="cd-quietbutton" disabled={Boolean(acting)} onClick={() => void act("restart")}><Icon name="restart" />Restart</button>
              <button type="button" className="cd-quietbutton" disabled={Boolean(acting)} onClick={() => void act("stop")}><Icon name="stop" />Stop</button>
            </>}
      </div>
    </div>
    {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
    <pre ref={log} className="cd-run-log" aria-label="What the app printed" tabIndex={0}>{status ? status.log.trimEnd() || "Nothing printed yet." : " "}</pre>
  </section>;
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
    <span className="cd-ready-text"><b>Your app is ready</b>{workspace.preview?.kind ? <small>{workspace.preview.kind}</small> : null}<span className="cd-mono">{url.replace(/^https?:\/\//, "")}</span></span>
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
  | { type: "slept"; seq: number; for: string }
  | { type: "disk"; seq: number; event: Extract<CodeEvent, { kind: "disk" }> }
  | { type: "compacted"; seq: number; before?: number }
  | { type: "access"; seq: number; event: Extract<CodeEvent, { kind: "access" }>; answer?: Extract<CodeEvent, { kind: "access-answer" }> };

/** Events as the reader sees them: consecutive tool calls fold into one group, each call paired with its result. */
function itemsOf(events: StoredEvent[]): Item[] {
  const items: Item[] = [];
  const tools = new Map<string, Tool>();
  const answers = new Map<string, Extract<CodeEvent, { kind: "access-answer" }>>();
  for (const { event } of events) if (event.kind === "access-answer") answers.set(event.id, event);
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
      case "slept": items.push({ type: "slept", seq, for: event.for }); break;
      case "disk": items.push({ type: "disk", seq, event }); break;
      case "compacted": items.push({ type: "compacted", seq, before: event.before }); break;
      case "access": items.push({ type: "access", seq, event, answer: answers.get(event.id) }); break;
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
            case "slept": return <p key={item.seq} className="cd-note">Put to sleep to make room for &ldquo;{item.for}&rdquo;. It wakes when you open it.</p>;
            case "disk": return <p key={item.seq} className="cd-note is-failed">{item.event.full
              ? `Stopped: this task's files took ${gigabytes(item.event.used)}, past its ${gigabytes(item.event.quota)}. Its app was stopped too. Ask the agent to free space.`
              : `This task's files take ${gigabytes(item.event.used)} of its ${gigabytes(item.event.quota)}. The agent was asked to free space first.`}</p>;
            case "access": return <AccessCard key={item.seq} workspace={workspace} event={item.event} answer={item.answer} />;
            case "compacted": return <p key={item.seq} className="cd-note cd-compacted"><Icon name="diff" />Compacted the conversation{item.before ? <span className="cd-mono"> · it held {kTokens(item.before)} tokens</span> : null}</p>;
            case "published": return <p key={item.seq} className="cd-note"><Icon name="pr" />Opened <button type="button" className="cd-textbutton" onClick={() => openOutside(item.event.url)}>pull request #{item.event.number}</button></p>;
          }
        })}
        {running && items.at(-1)?.type !== "tools" ? <p className="cd-thinking"><i aria-hidden="true" />Working</p> : null}
        {!running && workspace.preview && !workspace.preview.stopped && items.at(-1)?.type !== "ask" ? <AppReady workspace={workspace} url={workspace.preview.url} /> : null}
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
      {live && pending ? <i className="cd-spin" aria-hidden="true" /> : <GroupMarks tools={tools} />}
      <span>{live && pending ? "Using tools" : `Used ${tools.length} ${tools.length === 1 ? "tool" : "tools"}`}</span>
      {touched.length ? <span className="cd-faint">· edited {touched.length === 1 ? touched[0] : `${touched.length} files`}</span> : null}
      {failed ? <span className="cd-word">{failed} failed</span> : null}
      <span className="chev" aria-hidden="true" />
    </summary>
    <div className="call-list">{tools.map((tool) => <ToolRow key={tool.id} tool={tool} />)}</div>
  </details>;
}

/** The apps and spaces a group of calls touched, side by side; a gear when it was only the sandbox. */
function GroupMarks({ tools }: { tools: Tool[] }) {
  const apps = [...new Set(tools.map((t) => t.app).filter((a): a is string => Boolean(a)))].slice(0, 3);
  const drive = tools.some((t) => t.space && !t.app);
  if (!apps.length && !drive) return <Icon name="gear" />;
  return <span className="cd-groupmarks">{drive ? <DriveMark /> : null}{apps.map((slug) => <AppLogo key={slug} slug={slug} />)}</span>;
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
      <span className={cx("ci", (tool.app || tool.space) && "is-mark")} aria-hidden="true">{state === "running" ? <i className="cd-spin" /> : <ToolMark tool={tool} />}</span>
      <span className="cv">{tool.label}{tool.app && /^(Used|Connecting|Read how to use)$/.test(tool.label) ? <> <AppName slug={tool.app} /></> : null}</span>
      {tool.space ? <SpaceChip name={tool.space} /> : null}
      {tool.detail ? <code>{(tool.space ? tool.detail.split(`/workspace/.kimono/files/${tool.space}/`).join("").split(`/files/${tool.space}/`).join("") : tool.detail).split("\n")[0] || "\u00a0"}</code> : null}
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

/* ── asking for the person's Drive ── */

const whatOf = (e: { space: string; path: string }) => e.path ? <><b>{e.path.split("/").pop()}</b> in <SpaceChip name={e.space} /></> : <SpaceChip name={e.space} />;

/** Kimono AI asking for some of the person's Drive, and how they answered. */
function AccessCard({ workspace, event, answer }: { workspace: Workspace; event: Extract<CodeEvent, { kind: "access" }>; answer?: Extract<CodeEvent, { kind: "access-answer" }> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const verb = event.need === "change" ? "change" : "read";
  if (event.state === "missing") return <p className="cd-note cd-access-note"><DriveMark /><span>It asked for {whatOf(event)}, which isn&rsquo;t in your Drive.</span></p>;
  if (event.state === "auto") return <p className="cd-note cd-access-note"><DriveMark /><span>Opened {whatOf(event)} to {verb}, as you allowed before.</span></p>;
  if (answer) {
    if (answer.state === "denied") return <p className="cd-note cd-access-note"><DriveMark /><span>You didn&rsquo;t let it {verb} {whatOf(event)}.</span></p>;
    const scope = answer.scope === "always" ? "from now on" : "in this chat";
    return <p className="cd-note cd-access-note"><DriveMark /><span>You let it {answer.need === "change" ? "read and change" : "read"} {answer.scope === "file" ? "one file from " : ""}{whatOf(event)} {scope}.</span></p>;
  }
  const say = (choice: "file" | "chat" | "always" | "deny", file?: string) => {
    setBusy(choice); setProblem(null);
    code.answerAccess(workspace.id, event.id, choice, file).catch((error) => { setProblem(problemText(error)); setBusy(null); });
  };
  return <div className="cd-access" role="group" aria-label={`Kimono AI wants to ${verb} ${event.path || event.space}`}>
    <span className="cd-access-mark" aria-hidden="true"><DriveMark /></span>
    <div className="cd-access-id">
      <b>Kimono AI wants to {verb} {event.path ? <>{event.path.split("/").pop()} in </> : <>files in </>}<SpaceChip name={event.space} /></b>
      <span>{event.why}</span>
    </div>
    <div className="cd-access-acts">
      <Seal type="button" compact disabled={busy !== null} onClick={() => say("chat")}>{busy === "chat" ? "Allowing…" : event.file ? "Allow" : "Allow for this chat"}</Seal>
      {!event.file && event.node ? <button type="button" className="cd-quietbutton" disabled={busy !== null} onClick={() => setPicking((p) => !p)}>Only one file…</button> : null}
      <button type="button" className="cd-quietbutton" disabled={busy !== null} onClick={() => say("always")}>{busy === "always" ? "Allowing…" : "Always allow"}</button>
      <button type="button" className="cd-quietbutton" disabled={busy !== null} onClick={() => say("deny")}>{busy === "deny" ? "…" : "Don\u2019t allow"}</button>
    </div>
    {picking && event.node ? <OneFilePicker root={event.node} onPick={(file) => { setPicking(false); say("file", file); }} /> : null}
    {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
  </div>;
}

/** The files in what it asked for, a folder at a time, to allow just one. */
function OneFilePicker({ root, onPick }: { root: string; onPick: (file: string) => void }) {
  const [at, setAt] = useState(root);
  const [stack, setStack] = useState<string[]>([]);
  /* What was loaded, and for which folder: a list for another folder is still loading. */
  const [loaded, setLoaded] = useState<{ at: string; items: DriveItem[] } | null>(null);
  const items = loaded?.at === at ? loaded.items : null;
  useEffect(() => {
    let live = true;
    drive.folder(at).then((f) => { if (live) setLoaded({ at, items: f.children }); }, () => { if (live) setLoaded({ at, items: [] }); });
    return () => { live = false; };
  }, [at]);
  return <div className="cd-access-pick">
    {stack.length ? <button type="button" className="cd-access-row" onClick={() => { setAt(stack.at(-1)!); setStack((s) => s.slice(0, -1)); }}><Icon name="back" />Back</button> : null}
    {items === null ? <p className="cd-note">Looking…</p> : !items.length ? <p className="cd-note">Nothing here.</p> : items.map((item) =>
      <button key={item.id} type="button" className="cd-access-row" onClick={() => { if (item.kind === "folder") { setStack((s) => [...s, at]); setAt(item.id); } else onPick(item.id); }}>
        <Icon name={item.kind === "folder" ? "folder" : "file"} /><span>{item.name}</span>
      </button>)}
  </div>;
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

/** What Kimono AI may use without asking: each space, and the folders and files always allowed. */
function AccessDialog({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<AccessSettings | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(() => code.access().then((next) => { setSettings(next); setProblem(null); }, (error) => setProblem(problemText(error))), []);
  useEffect(() => { box.current?.showModal(); }, []);
  useEffect(() => { void load(); }, [load]);
  const setSpace = (id: string, value: string) => {
    const need = value === "read" || value === "change" ? value : null;
    setSettings((s) => s && { ...s, spaces: s.spaces.map((x) => x.id === id ? { ...x, auto: need } : x) });
    code.setSpaceAccess(id, need).catch((error) => { setProblem(problemText(error)); void load(); });
  };
  const takeBack = (id: string) => {
    setSettings((s) => s && { ...s, grants: s.grants.filter((g) => g.id !== id) });
    code.revokeAccess(id).catch((error) => { setProblem(problemText(error)); void load(); });
  };
  return <dialog ref={box} className="cd-drivepick cd-accessdialog" onClose={onClose} onClick={(event) => { if (event.target === box.current) box.current?.close(); }}>
    <header>
      <b>What Kimono AI can use</b>
      <span className="cd-grow" />
      <button type="button" className="cd-iconbutton" aria-label="Close" onClick={() => box.current?.close()}><Icon name="close" /></button>
    </header>
    <ul>
      {settings?.spaces.map((space) => <li key={space.id} className="cd-access-space">
        <span className="cd-access-space-name"><Icon name="space" /><span>{space.name}</span></span>
        <Choice compact aria-label={`Kimono AI and ${space.name}`} value={space.auto ?? "ask"} onChange={(value) => setSpace(space.id, value)}
          options={[{ value: "ask", label: "Asks first" }, { value: "read", label: "May read" }, ...(space.canChange ? [{ value: "change", label: "May read and change" }] : [])]} />
      </li>)}
      {settings?.grants.length ? <li className="cd-faint cd-drivepick-note">Always allowed</li> : null}
      {settings?.grants.map((grant) => <li key={grant.id} className="cd-access-space">
        <span className="cd-access-space-name"><Icon name="folder" /><span>{grant.path.split("/").pop()} <small className="cd-faint">in {grant.spaceName} · {grant.need === "change" ? "read and change" : "read"}</small></span></span>
        <button type="button" className="cd-quietbutton" onClick={() => takeBack(grant.id)}>Take back</button>
      </li>)}
      {settings && !settings.spaces.length ? <li className="cd-faint cd-drivepick-note">You have no spaces in Drive.</li> : null}
      {!settings && !problem ? <li className="cd-faint cd-drivepick-note">…</li> : null}
    </ul>
    <footer>{problem ? <span className="cd-problem">{problem}</span> : <span className="cd-faint">Anything else, it asks you first.</span>}</footer>
  </dialog>;
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
