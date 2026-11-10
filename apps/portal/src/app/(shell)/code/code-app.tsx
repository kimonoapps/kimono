"use client";

import { createContext, Fragment, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AppBloom, type AppIdentity, BusyFace, Choice, cx, InkBlot, InkCard, InkWave, InkLoader, Seal } from "@kimono/ui";
import { cardOf, cardWords } from "@/lib/code/progress-card";
import { Crossing, useCrossTo } from "@/components/crossing";
import { Scroller } from "@/components/scroller";
import { filesIn, useFileDrop } from "@/components/file-drop";
import { FileOverlay, FilePreview, FileThumb, previewable, TypeMark } from "@/components/file-preview/file-preview";
import { extensionLabel, lowerExtension, pictureExtensions, previewKind } from "@/components/file-preview/kinds";
import { SkeletonChat, SkeletonRows } from "@/components/skeleton";
import { swap } from "@/components/motion";
import { Portrait } from "@/components/portrait";
import { JointSwitch } from "@/components/joint-switch";
import {
  code, drive, efforts, modelChoices, modelKey, modelNow, type ModelChoice, elapsed, gigabytes, isPicture, readableSize, when, type DriveItem, type DriveSpace,
  artifactLinkUrl, chatLinkUrl, setShareLink, type Access, type ArtifactSharing, type ChatSharing, type Person, type SharedArtifact,
  type AccessSettings, type AppDetails, type ConnectableApp, type Profile, type SkillChoice, type Project, type Connection, type AppHealth, type SandboxStatus, type Attachment, type Changes, type CodeEvent, type Entry, type Repository, type StoredEvent, type Workspace, type Effort, type Usage, type Phase,
} from "./api";
import { Icon, type IconName } from "./icons";
import { Markdown } from "./markdown";
import { ArtifactFrame, SceneBar, type SceneControl, type SceneState } from "./artifact-frame";
import { Picker } from "./picker";
import { Dictation, joinSaid } from "./dictation";
import type { Answer as KeptAnswer } from "@/lib/code/feedback";

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
/* Working is quiet ink, not a colour: its shape is washed in --k-ink-soft. */
const workingInk = "#5b524d";
/* Thinking is the same ink, a little toward ai (indigo). */
const thinkingInk = "#4d5670";
const openOutside = (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); };
/** Saves [url] as [name], from this page. */
const saveAs = (url: string, name: string) => { const link = document.createElement("a"); link.href = url; link.download = name; link.rel = "noopener"; document.body.append(link); link.click(); link.remove(); };

/*
 * Code's screens (which task, which view, a new task) live after the # in the
 * address. Back and forward then move between screens inside this page; a
 * query string would make Next.js treat each one as a new page to fetch, and
 * going back would wait on that.
 */
const codeNav = "kimono-code-nav";
/* Where these screens live. */
const codeHome = "/code";
function goTo(to: Record<string, string | null>, replace = false) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(to)) if (value) next.set(key, value);
  const url = `${codeHome}${next.size ? `#${next}` : ""}`;
  /* Keep Next.js's own history state, so its back button handling sees this as the same page. */
  if (replace) window.history.replaceState(window.history.state, "", url); else window.history.pushState(window.history.state, "", url);
  window.dispatchEvent(new Event(codeNav));
}

/** A phone or tablet: a touch screen whose keyboard covers half of it. */
const onTouch = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

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

/** What it is writing right now: never kept, only sent while it writes (lib/code/artifacts.ts, Drafts). */
type Now = Extract<CodeEvent, { kind: "phase" }>;
type Drafts = { text: string | null; artifacts: Record<string, { id: string; content: string }>; now: Now | null };
const noDrafts: Drafts = { text: null, artifacts: {}, now: null };

function useTimeline(id: string | null, onDone: () => void) {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [drafts, setDrafts] = useState<Drafts>(noDrafts);
  const [connected, setConnected] = useState(true);
  /* Who's typing in this chat, and until when: each word they type keeps them here a few seconds more. */
  const [typers, setTypers] = useState<Record<string, number>>({});
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    if (!id) return;
    const source = new EventSource(code.eventsUrl(id, 0));
    /* Events land in bursts (a whole chat replays on open, a draft streams token by token):
       they're gathered and drawn once a frame, and the list is told once things settle. */
    let queue: StoredEvent[] = [];
    let frame = 0;
    let settle = 0;
    const tell = () => { window.clearTimeout(settle); settle = window.setTimeout(() => done.current(), 300); };
    let backup = 0;
    const flush = () => {
      if (frame > 0) window.cancelAnimationFrame(frame);
      window.clearTimeout(backup);
      frame = 0;
      const batch = queue;
      queue = [];
      let changed = false;
      let drafts: ((d: Drafts) => Drafts)[] = [];
      let kept: StoredEvent[] = [];
      for (const stored of batch) {
        const event = stored.event;
        if (stored.seq === 0) {
          if (event.kind === "typing") { const by = event.by, until = Date.now() + 6000; setTypers((now) => ({ ...now, [by]: until })); continue; }
          if (event.kind === "renamed") { changed = true; continue; }
          /* A message was changed: the chat from it on went, and runs again from there. */
          if (event.kind === "rewound") {
            const from = event.seq;
            kept = kept.filter((e) => e.seq < from);
            setEvents((list) => list.filter((e) => e.seq < from));
            drafts = [() => noDrafts];
            changed = true;
            continue;
          }
          if (event.kind === "draft") drafts.push((d) => ({ ...d, text: event.text }));
          if (event.kind === "artifact-draft") drafts.push((d) => ({ ...d, artifacts: { ...d.artifacts, [event.name]: { id: event.id, content: event.content } } }));
          if (event.kind === "phase") drafts.push((d) => ({ ...d, now: event }));
          continue;
        }
        if (event.kind === "text" || event.kind === "tool" || event.kind === "artifact") drafts.push((d) => d.text === null ? d : { ...d, text: null });
        /* What they typed has arrived: they've stopped typing. */
        if (event.kind === "ask") { const by = event.by.toLowerCase(); setTypers((now) => { if (!(by in now)) return now; const rest = { ...now }; delete rest[by]; return rest; }); }
        if (event.kind === "artifact-saved") drafts.push((d) => { if (!(event.name in d.artifacts)) return d; const rest = { ...d.artifacts }; delete rest[event.name]; return { ...d, artifacts: rest }; });
        if (event.kind === "done") drafts.push(() => noDrafts);
        kept.push(stored);
        if (event.kind === "done" || event.kind === "ask" || event.kind === "published") changed = true;
      }
      if (drafts.length) setDrafts((d) => drafts.reduce((now, step) => step(now), d));
      if (kept.length) setEvents((list) => {
        const last = list.length ? list[list.length - 1].seq : -1;
        const fresh = kept.filter((e) => e.seq > last);
        return fresh.length ? [...list, ...fresh] : list;
      });
      if (changed) tell();
    };
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(source.readyState === EventSource.OPEN);
    source.onmessage = (message) => {
      queue.push(JSON.parse(message.data) as StoredEvent);
      /* Drawn on the next frame; a window that gets no frames (hidden, covered, in the background) has a short timer stand in. */
      if (!frame) { frame = window.requestAnimationFrame(flush); backup = window.setTimeout(flush, 120); }
    };
    return () => {
      source.close();
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(backup);
      window.clearTimeout(settle);
    };
  }, [id]);
  /* Let go of anyone who stopped: looked at each second while someone's typing. */
  const anyone = Object.keys(typers).length > 0;
  useEffect(() => {
    if (!anyone) return;
    const timer = setInterval(() => setTypers((now) => {
      const at = Date.now();
      const left = Object.fromEntries(Object.entries(now).filter(([, until]) => until > at));
      return Object.keys(left).length === Object.keys(now).length ? now : left;
    }), 1000);
    return () => clearInterval(timer);
  }, [anyone]);
  const typing = useMemo(() => Object.keys(typers), [typers]);
  return { events, connected, drafts, typing };
}

/* Who's typing in each of the person's chats, for the list: asked every few seconds while some chat is shared. */
const TypingContext = createContext<Record<string, string[]>>({});
function useTypingInList(on: boolean) {
  const [typing, setTyping] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!on) return;
    let live = true;
    const look = () => { if (document.hidden) return; code.typers().then((t) => { if (live) setTyping((now) => JSON.stringify(now) === JSON.stringify(t) ? now : t); }, () => {}); };
    look();
    const timer = setInterval(look, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [on]);
  return on ? typing : noTyping;
}
const noTyping: Record<string, string[]> = {};

/** A person's first name, as the household knows them. */
function FirstName({ username }: { username: string }) {
  const person = usePerson(username);
  return <>{(person.name || username).split(" ")[0]}</>;
}

/** "Mina is typing", "Mina and Jo are typing", "3 people are typing", after three dots that rise in turn. */
function TypingWords({ names }: { names: string[] }) {
  return <span className="cd-typing"><i className="cd-typing-dots" aria-hidden="true"><b /><b /><b /></i>
    {names.length > 2 ? `${names.length} people are typing` : <>{names.map((n, i) => <Fragment key={n}>{i ? " and " : ""}<FirstName username={n} /></Fragment>)} {names.length > 1 ? "are" : "is"} typing</>}
  </span>;
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

const modelListeners = new Set<() => void>();
function setModel(model: ModelChoice) {
  try { window.localStorage.setItem(modelKey, model); } catch { /* private window: this page only */ }
  modelListeners.forEach((listener) => listener());
}
function useModel() {
  return useSyncExternalStore((listener) => { modelListeners.add(listener); return () => { modelListeners.delete(listener); }; }, modelNow, () => "auto" as ModelChoice);
}
const modelWords: Record<ModelChoice, { label: string; detail?: string }> = {
  auto: { label: "Auto" },
  fable: { label: "Fable", detail: "Experimental, usually overkill" },
  opus: { label: "Opus", detail: "Best for building things" },
  sonnet: { label: "Sonnet", detail: "Everyday work" },
  haiku: { label: "Haiku", detail: "Quick answers" },
};

/** Which Claude answers, as a compact chip in the message box. */
function ModelPicker() {
  const model = useModel();
  return <Choice compact aria-label="Which model answers" className="cd-model" value={model} onChange={(next) => setModel(next as ModelChoice)}
    options={modelChoices.map((m) => ({ value: m, label: modelWords[m].label, detail: modelWords[m].detail }))} />;
}

/** The thinking level, as a compact chip in the message box. */
function EffortPicker() {
  const effort = useEffort();
  const model = useModel();
  /* Auto picks how hard it thinks along with the model: nothing to choose. */
  if (model === "auto") return null;
  /* Sonnet and Haiku think at low or medium only (the Portal holds them there too); Fable and Opus offer all of it. The choice made for them is kept for when it comes back. */
  const light = model === "sonnet" || model === "haiku";
  const offered: readonly Effort[] = light ? efforts.filter((e) => e === "low" || e === "medium") : efforts;
  const shown = light && !offered.includes(effort) ? "medium" : effort;
  return <Choice compact label="Thinking ·" aria-label="How hard it thinks" className="cd-effort" value={shown} onChange={(next) => setEffort(next as Effort)}
    options={offered.map((e) => ({ value: e, label: effortWords[e] }))} />;
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
/* Pro Tools are counted in credits, a hundred to the dollar: "247 of 1,000 credits". Under ten, to a tenth. */
const creditNumber = (usd: number) => { const c = usd * 100; return c > 0 && c < 10 ? String(Math.round(c * 10) / 10) : Math.round(c).toLocaleString("en"); };
const credits = (usd: number) => `${creditNumber(usd)} ${usd * 100 === 1 ? "credit" : "credits"}`;
const monthWords = (at: number) => new Date(at).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
const resetWords = (at: number | null) => at ? new Date(at).toLocaleString("en", { weekday: "short", hour: "numeric", minute: "2-digit" }) : null;

/** This person's usage, fetched again whenever a turn starts or ends. */
function useUsage(workspaceId: string, running: boolean) {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => { let live = true; code.usage(workspaceId).then((u) => { if (live) setUsage(u); }, () => {}); return () => { live = false; }; }, [running, workspaceId]);
  return usage;
}

type ContextUse = { used: number; window?: number } | null;

/** The figures behind every meter, as fractions (null while not known). */
function usageFacts(usage: Usage | null, context: ContextUse) {
  const window = context?.window ?? fallbackWindow;
  /* Always this person's own use: of their share, or (the owner, who has no share) of the whole plan. Never anyone else's. */
  const share = (w: Usage["week"]) => !usage?.reported ? null : w.used / w.share;
  const media = usage?.media ?? null;
  return {
    window,
    ctx: context ? context.used / window : null,
    five: usage ? share(usage.fiveHour) : null,
    week: usage ? share(usage.week) : null,
    whose: usage?.unlimited ? "of the plan, used by you" : "of your share",
    /* Usage arrives but never a 5-hour figure: this plan has no 5-hour window. */
    noFiveHour: Boolean(usage?.reported && usage.fiveHourLimited === false),
    media,
    tools: media?.spent == null ? null : Math.min(1, media.spent / media.budget),
  };
}

type Shown = { context: boolean; five: boolean; week: boolean; tools: boolean };

/** The meters in full, as rows: those `show` asks for; compacting goes with the context row. */
function UsageRows({ workspace, usage, context, running, blocked, show, onCompacted }: { workspace: Workspace; usage: Usage | null; context: ContextUse; running: boolean; blocked: string | null; show: Shown; onCompacted?: () => void }) {
  const [compacting, setCompacting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const f = usageFacts(usage, context);
  const { media } = f;
  return <>
    {show.context ? <>
      <div className="cd-meter"><Ring value={f.ctx} label="Context" /><span><b>Context</b><small>{context ? `${kTokens(context.used)} of ${kTokens(f.window)} tokens${context.window ? "" : " (about)"}` : "Known after the next reply"}</small></span>
        <Seal type="button" compact tone="quiet" busy={compacting} disabled={Boolean(blocked) || !context} onClick={() => { setCompacting(true); setProblem(null); code.ask(workspace.id, "/compact", [], effortNow()).then(() => { setCompacting(false); onCompacted?.(); }, (error) => { setProblem(problemText(error)); setCompacting(false); }); }}>{running ? "Compact after this" : "Compact now"}</Seal></div>
      <p className="cd-meter-note">Compacting folds the conversation so far into a summary, so there&rsquo;s room to keep going. It also happens by itself when the context fills.</p>
    </> : null}
    {show.five ? <div className="cd-meter"><Ring value={f.five} label="5-hour window" /><span><b>5-hour window</b><small>{f.noFiveHour ? "This plan has no 5-hour limit" : f.five == null ? "Not reported yet" : `${pct(f.five)} ${f.whose}${usage?.fiveHour.resetsAt ? ` · resets ${resetWords(usage.fiveHour.resetsAt)}` : ""}`}</small></span></div> : null}
    {show.week ? <div className="cd-meter"><Ring value={f.week} label="This week" /><span><b>This week</b><small>{f.week == null ? "Not reported yet" : `${pct(f.week)} ${f.whose}${usage?.week.resetsAt ? ` · resets ${resetWords(usage.week.resetsAt)}` : ""}`}</small></span></div> : null}
    {show.tools && media ? <div className="cd-meter"><Ring value={f.tools} label="Pro Tools" /><span><b className="cd-pro"><Icon name="bolt" />Pro Tools</b><small>{media.spent == null ? "Not reported yet" : `${creditNumber(media.spent)} of ${credits(media.budget)} this month${media.chatSpent ? ` · ${creditNumber(media.chatSpent)} in this chat` : ""} · resets ${monthWords(media.resetsAt)}`}</small></span></div> : null}
    {usage && !usage.unlimited && (show.five || show.week) ? <p className="cd-meter-note">Your share is {f.noFiveHour ? `${pct(usage.week.share)} of the week` : `${pct(usage.fiveHour.share)} of each 5-hour window and ${pct(usage.week.share)} of the week`}.</p> : null}
    {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
  </>;
}

/** A pop-up anchored to a button in the message box, closed by a click elsewhere or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return { open, setOpen, box };
}

/**
 * Context, the 5-hour window, the week and the month's Pro Tools, as rings
 * beside Send, each only once it's past half (Pro Tools also once this chat
 * has spent some); open them for the numbers. Everything, always, is in the
 * message box's … menu.
 */
function Meters({ workspace, usage, context, running, blocked }: { workspace: Workspace; usage: Usage | null; context: ContextUse; running: boolean; blocked: string | null }) {
  const { open, setOpen, box } = usePopover();
  const f = usageFacts(usage, context);
  const past = (v: number | null): v is number => v != null && v > 0.5;
  const show = {
    context: past(f.ctx),
    five: !f.noFiveHour && past(f.five),
    week: past(f.week),
    tools: Boolean(f.media && (past(f.tools) || (f.media.chatSpent ?? 0) > 0)),
  };
  if (!show.context && !show.five && !show.week && !show.tools) return null;
  return <div className="cd-meters" ref={box}>
    <button type="button" className="cd-meters-btn" aria-expanded={open} aria-label="Context and usage" title="Context and usage" onClick={() => setOpen(!open)}>
      {show.context ? <Ring value={f.ctx} label={`Context ${pct(f.ctx!)} full`} /> : null}
      {show.five ? <Ring value={f.five} label={`${pct(f.five!)} of the 5-hour window`} /> : null}
      {show.week ? <Ring value={f.week} label={`${pct(f.week!)} of the week`} /> : null}
      {show.tools ? <Ring value={f.tools} label={f.tools == null ? "Pro Tools" : `${pct(f.tools)} of this month's Pro Tools`} /> : null}
    </button>
    {open ? <div className="cd-meters-pop" role="dialog" aria-label="Context and usage">
      <UsageRows workspace={workspace} usage={usage} context={context} running={running} blocked={blocked} show={show} onCompacted={() => setOpen(false)} />
    </div> : null}
  </div>;
}

/**
 * The message box's … menu: what it may do with your files, which Claude
 * answers and how hard it thinks, and all of your usage, whatever its level.
 */
function ComposerMore({ workspace, usage, context, running, blocked, files }: { workspace: Workspace; usage: Usage | null; context: ContextUse; running: boolean; blocked: string | null; files: boolean }) {
  const { open, setOpen, box } = usePopover();
  const f = usageFacts(usage, context);
  const everything = { context: true, five: !f.noFiveHour, week: true, tools: Boolean(f.media) };
  return <div className="cd-more" ref={box}>
    <button type="button" className="cd-more-btn" aria-expanded={open} aria-haspopup="dialog" aria-label="Settings and usage" title="Settings and usage" onClick={() => setOpen(!open)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18" cy="12" r="1.7" /></svg>
    </button>
    {open ? <div className="cd-meters-pop cd-more-pop" role="dialog" aria-label="Settings and usage">
      <div className="cd-more-settings cd-tuning">
        {files ? <div className="cd-more-row"><span>Files</span><AccessPicker /></div> : null}
        <div className="cd-more-row"><span>Model</span><ModelPicker /></div>
        <EffortRow />
      </div>
      <div className="cd-more-head">Usage</div>
      <UsageRows workspace={workspace} usage={usage} context={context} running={running} blocked={blocked} show={everything} onCompacted={() => setOpen(false)} />
    </div> : null}
  </div>;
}

/** Thinking, as a row of the … menu; Auto picks it along with the model, so there's nothing to choose then. */
function EffortRow() {
  const model = useModel();
  if (model === "auto") return null;
  return <div className="cd-more-row"><span>Thinking</span><EffortPicker /></div>;
}

export function CodeApp({ blocked, admin, driveApp, me }: { blocked: string | null; admin: boolean; driveApp: AppIdentity; me: string }) {
  /* Drive's mark and each space's crest, for tool calls and access cards that touch the person's files. */
  const [spaces, setSpaces] = useState<DriveSpace[]>([]);
  useEffect(() => { drive.spaces().then(setSpaces, () => {}); }, []);
  const marks = useMemo<Marks>(() => ({ drive: driveApp, spaces: new Map(spaces.map((space) => [space.name.toLowerCase(), space])) }), [driveApp, spaces]);
  /* The household, by name and picture: who shared a chat, who wrote in it, who to share with. */
  const [household, setHousehold] = useState<Person[]>([]);
  useEffect(() => { drive.people().then(setHousehold, () => {}); }, []);
  const viewer = useMemo<Viewer>(() => ({ me, guest: false, people: new Map(household.map((p) => [p.username.toLowerCase(), p])) }), [me, household]);
  const params = useCodeParams();
  /* Old links carried the screen in the query string: move it after the #, once. */
  useEffect(() => {
    if (window.location.search) goTo(Object.fromEntries(new URLSearchParams(window.location.search)), true);
  }, []);
  const current = params.get("w");
  /* Connections: the apps this person has connected, a page of its own in the list. */
  const showingConnections = !current && params.get("connections") === "1";
  const showingMemory = !current && !showingConnections && params.get("memory") === "1";
  const showingArchived = !current && !showingConnections && !showingMemory && params.get("archived") === "1";
  /* Moving between pages (a chat, connections, memory, archived, a new chat) carries the page in, as tabs do. */
  const mainRef = useRef<HTMLElement>(null);
  const page = current ? `w:${current}` : showingConnections ? `c:${params.get("app") ?? ""}` : showingMemory ? `memory:${params.get("page") ?? ""}` : showingArchived ? "archived" : `new:${params.get("in") ?? ""}:${params.get("repo") ?? ""}`;
  useLayoutEffect(() => { swap(mainRef.current?.firstElementChild ?? null); }, [page]);
  /* On a narrow screen Code opens on the task list; the new-task form is its own screen, as on the phone. */
  const composing = params.get("new") === "1";
  const tab = (["chat", "files", "changes", "app"].includes(params.get("tab") ?? "") ? params.get("tab") : "chat") as Tab;
  const path = params.get("path") ?? "";
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  /* What others shared with this person: chats to read or write in, and artifacts. */
  const [shared, setShared] = useState<{ chats: Workspace[]; artifacts: SharedArtifact[] }>({ chats: [], artifacts: [] });
  const [problem, setProblem] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  /* Only the newest answer is drawn: an older one landing late would put back what changed since. */
  const asked = useRef(0);
  const load = useCallback(() => { const n = ++asked.current; return Promise.all([code.lists(), code.projects().catch(() => [] as Project[])]).then(([lists, folders]) => { if (n !== asked.current) return; setWorkspaces(lists.workspaces); setShared({ chats: lists.shared, artifacts: lists.sharedArtifacts }); setProjects(folders); setProblem(null); }, (error) => { if (n === asked.current) setProblem(problemText(error, "Kimono AI isn't answering.")); }); }, []);
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null);
  const saveProject = async () => {
    if (!naming?.name.trim()) { setNaming(null); return; }
    try {
      if (naming.id) await code.renameProject(naming.id, naming.name); else await code.createProject(naming.name);
      setNaming(null); await load();
    } catch (error) { setProblem(problemText(error)); }
  };
  useEffect(() => { void load(); }, [load]);
  /* Something elsewhere on the page changed the list (a chat moved project). */
  useEffect(() => {
    const again = () => { void load(); };
    window.addEventListener("kimono-ai-reload", again);
    return () => window.removeEventListener("kimono-ai-reload", again);
  }, [load]);

  const workspace = workspaces?.find((w) => w.id === current) ?? shared.chats.find((w) => w.id === current) ?? null;
  const typingInList = useTypingInList(useMemo(() => [...(workspaces ?? []), ...shared.chats].some((w) => (w.people?.length ?? 0) > 0), [workspaces, shared.chats]));
  /* Archived chats leave the list for their own page. */
  const archived = useMemo(() => (workspaces ?? []).filter((w) => w.archivedAt).toSorted((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)), [workspaces]);
  const listed = useMemo(() => (workspaces ?? []).filter((w) => !w.archivedAt), [workspaces]);
  /* Chats on a Kimono Git repository, by repository. One whose name is a project's sits in that project. */
  const repoGroups = useMemo(() => projectsOf(listed), [listed]);
  const repoOf = (project: Project) => repoGroups.find((group) => group.name.toLowerCase() === project.name.trim().toLowerCase().replace(/\s+/g, "-"));
  /* Searching the list: every chat by its name, its project or its repository. */
  const [find, setFind] = useState("");
  const searching = find.trim().length > 0;
  /* What's folded, and the order of the projects: this device's own, kept between visits. */
  const [folds, setFolds] = useState<Set<string>>(() => new Set(readList("kimono-ai:folded")));
  const toggleFold = (key: string) => setFolds((now) => { const next = new Set(now); if (next.has(key)) next.delete(key); else next.add(key); writeList("kimono-ai:folded", [...next]); return next; });
  const [order, setOrder] = useState<string[]>(() => readList("kimono-ai:project-order"));
  type Group = { kind: "project"; key: string; project: Project } | { kind: "repo"; key: string; repo: ReturnType<typeof projectsOf>[number] };
  const groups: Group[] = [
    ...projects.map((project) => ({ kind: "project" as const, key: `p:${project.id}`, project })),
    ...repoGroups.filter((group) => !projects.some((project) => repoOf(project) === group)).map((repo) => ({ kind: "repo" as const, key: `r:${repo.key}`, repo })),
  ].map((group, n) => ({ group, n })).toSorted((a, b) => {
    const at = (key: string) => { const i = order.indexOf(key); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
    return at(a.group.key) - at(b.group.key) || a.n - b.n;
  }).map(({ group }) => group);
  /* Dropping one project on another puts it there, in the order as it now shows. */
  const reorder = (from: string, to: string) => {
    if (from === to) return;
    const keys = groups.map((g) => g.key).filter((key) => key !== from);
    keys.splice(keys.indexOf(to), 0, from);
    setOrder(keys);
    writeList("kimono-ai:project-order", keys);
  };
  const fileChat = (id: string, folder: string | null) => {
    const chat = listed.find((w) => w.id === id);
    if (!chat || (chat.folder?.id ?? null) === folder) return;
    void code.moveChat(id, folder).then(load, (error) => setProblem(problemText(error)));
  };
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

  return <ViewerContext.Provider value={viewer}><MarksContext.Provider value={marks}><TypingContext.Provider value={typingInList}><div className="cd-page">
    <div className={cx("cd", current && "has-workspace", composing && "is-composing", folded && "is-folded")}>
    <aside className="cd-side" aria-label="Chats">
      <div className="cd-side-head"><button type="button" className="cd-roundbutton cd-fold" onClick={() => setFolded(true)} aria-label="Hide chats" title="Hide chats"><Icon name="panel" /></button><span>Chats</span></div>
      <button type="button" className="cd-newchat" onClick={() => goTo({ new: "1" })} aria-keyshortcuts="/" aria-current={!current && !showingConnections && !showingMemory && !showingArchived ? "page" : undefined}><Icon name="plus" /><span>New chat</span></button>
      <label className="cd-conn-search cd-side-search"><Icon name="search" /><input type="search" value={find} placeholder="Search chats" aria-label="Search chats"
        onChange={(event) => setFind(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setFind(""); }} /></label>
      <span className="k-ink-rule cd-side-rule" aria-hidden="true" />
      <nav className="cd-sidenav" aria-label="More">
        <button type="button" aria-current={showingConnections ? "page" : undefined} onClick={() => goTo({ connections: "1" })}><Icon name="link" /><span>Connections</span></button>
        <button type="button" aria-current={showingMemory ? "page" : undefined} onClick={() => goTo({ memory: "1" })}><Icon name="spark" /><span>For you</span></button>
        <button type="button" aria-current={showingArchived ? "page" : undefined} onClick={() => goTo({ archived: "1" })}><Icon name="archive" /><span>Archived</span>{archived.length ? <small className="cd-sidenav-count">{archived.length}</small> : null}</button>
      </nav>
      <span className="k-ink-rule cd-side-rule" aria-hidden="true" />
      {problem ? <p className="cd-quiet cd-side-note">{problem} <button type="button" className="cd-textbutton" onClick={() => void load()}>Retry</button></p> : null}
      {workspaces === null && !problem ? <SkeletonRows rows={4} mark={false} /> : null}
      {searching ? <SearchResults words={find} chats={[...listed, ...shared.chats]} current={current} now={now} /> : <>
      <SideGroup gkey="recent" title={<span className="cd-folder-title">Recent</span>} icon="clock" chats={chatsOf(listed).filter((w) => !w.folder)} current={current} now={now} cap={5}
        collapsed={folds.has("recent")} onToggle={() => toggleFold("recent")} onDropChat={(id) => fileChat(id, null)}
        actions={<button type="button" className="cd-roundbutton cd-project-new" onClick={() => goTo({ new: "1" })} aria-label="New chat" title="New chat"><Icon name="plus" /></button>} />
      <SharedWithYou chats={chatsOf(shared.chats).concat(shared.chats.filter((w) => w.kind !== "chat"))} artifacts={shared.artifacts} current={current} now={now} />
      <div className="cd-side-label cd-folders-head"><span>Projects</span><button type="button" className="cd-roundbutton cd-project-new is-shown" onClick={() => setNaming({ id: null, name: "" })} aria-label="New project" title="New project"><Icon name="plus" /></button></div>
      {naming && !naming.id ? <form className="cd-folder-name" onSubmit={(event) => { event.preventDefault(); void saveProject(); }}>
        <input autoFocus value={naming.name} maxLength={60} placeholder="Project name" aria-label="Project name" onChange={(event) => setNaming({ id: null, name: event.target.value })} onBlur={() => void saveProject()} onKeyDown={(event) => { if (event.key === "Escape") setNaming(null); }} />
      </form> : null}
      {groups.map((group) => group.kind === "project"
        ? <FolderGroup key={group.key} gkey={group.key} project={group.project} chats={[...chatsOf(listed).filter((w) => w.folder?.id === group.project.id), ...(repoOf(group.project)?.tasks ?? [])]} current={current} now={now}
            renaming={naming?.id === group.project.id ? naming.name : null} onRename={(name) => setNaming({ id: group.project.id, name })} onSaveName={() => void saveProject()} onCancelName={() => setNaming(null)}
            onRemove={() => { void code.removeProject(group.project.id).then(load, (error) => setProblem(problemText(error))); }}
            collapsed={folds.has(group.key)} onToggle={() => toggleFold(group.key)} onDropChat={(id) => fileChat(id, group.project.id)} onDropGroup={(from) => reorder(from, group.key)} />
        /* A repository with no project of its name is a project of its own, in the same list. */
        : <SideGroup key={group.key} gkey={group.key} icon="branch" title={<span className="cd-folder-title" title={group.repo.key}>{group.repo.name}</span>} chats={group.repo.tasks} current={current} now={now}
            collapsed={folds.has(group.key)} onToggle={() => toggleFold(group.key)} onDropGroup={(from) => reorder(from, group.key)}
            actions={admin ? <button type="button" className="cd-roundbutton cd-project-new" onClick={() => goTo({ new: "1", repo: group.repo.key })} aria-label={`New chat in ${group.repo.name}`} title={`New chat in ${group.repo.name}`}><Icon name="plus" /></button> : null} />)}
      {!groups.length && !naming ? <p className="cd-quiet cd-side-note">Keep chats together in a project.</p> : null}
      {workspaces && !listed.length ? <p className="cd-quiet cd-side-note">Your chats will be here.</p> : null}
      </>}
    </aside>
    <main className="cd-main" ref={mainRef}>
      {current && workspace
        ? <WorkspaceView key={workspace.id} projects={projects} workspace={workspace} others={workspaces?.filter((w) => w.id !== workspace.id && w.preview && !w.preview.stopped) ?? []} tab={tab} path={path} blocked={blocked} onChange={load} now={now} />
        : current && workspaces
          ? <div className="cd-sheet cd-empty"><p>That chat isn&rsquo;t here any more.</p><Seal type="button" tone="quiet" onClick={() => goTo({ new: "1" })}>New chat</Seal></div>
          : current
            ? <div className="cd-sheet cd-loading"><div className="cd-timeline"><SkeletonChat /></div></div>
            : showingConnections ? <ConnectionsView now={now} app={params.get("app")} />
            : showingMemory ? <MemoryView now={now} page={params.get("page")} />
            : showingArchived ? <ArchivedView chats={archived} loaded={workspaces !== null} now={now} onChange={load} />
            : <Start key={`${params.get("in") ?? ""}|${params.get("repo") ?? ""}`} blocked={blocked} admin={admin} repoAsked={params.get("repo")} folder={projects.find((p) => p.id === params.get("in")) ?? null} onStarted={async (made) => { setWorkspaces((list) => [made, ...(list ?? []).filter((w) => w.id !== made.id)]); goTo({ w: made.id }); void load(); }} />}
    </main>
    </div>
  </div></TypingContext.Provider></MarksContext.Provider></ViewerContext.Provider>;
}

/* ── archived chats: out of the list, kept until deleted ── */

function ArchivedView({ chats, loaded, now, onChange }: { chats: Workspace[]; loaded: boolean; now: number; onChange: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const act = (id: string, run: () => Promise<unknown>) => {
    setBusy(id); setProblem(null);
    run().then(() => { setDeleting(null); onChange(); }, (error) => setProblem(problemText(error))).finally(() => setBusy(null));
  };
  return <section className="cd-sheet cd-conn cd-archived">
    <header className="cd-conn-head">
      <button type="button" className="cd-roundbutton cd-back" onClick={() => goTo({})} aria-label="All chats" title="All chats"><Icon name="back" /></button>
      <button type="button" className="cd-roundbutton cd-unfold" onClick={() => setFolded(false)} aria-label="Show chats" title="Show chats"><Icon name="panel" /></button>
      <h1>Archived</h1>
    </header>
    <div className="cd-conn-body">
      {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
      {!loaded ? <SkeletonRows rows={3} mark={false} /> : null}
      {loaded && !chats.length ? <p className="cd-quiet">Nothing archived.</p> : null}
      {chats.length ? <ul className="cd-archived-list">{chats.map((w) => <li key={w.id} className={cx("cd-archived-row", busy === w.id && "is-busy")}>
        <button type="button" className="cd-archived-open" onClick={() => goTo({ w: w.id })}>
          <b>{w.title}</b>
          <small>{w.kind === "project" ? `${repoName(w)} · ` : w.folder ? `${w.folder.name} · ` : ""}{when(w.updatedAt, now)}</small>
        </button>
        {deleting === w.id
          ? <span className="cd-archived-acts"><span className="cd-faint">Delete for good?</span><button type="button" className="cd-quietbutton is-danger" onClick={() => act(w.id, () => code.remove(w.id))}>Delete</button><button type="button" className="cd-quietbutton" onClick={() => setDeleting(null)}>Keep</button></span>
          : <span className="cd-archived-acts">
              <button type="button" className="cd-linkbutton" onClick={() => act(w.id, () => code.archive(w.id, false))}><Icon name="unarchive" />Unarchive</button>
              <button type="button" className="cd-roundbutton" aria-label={`Delete ${w.title}`} title="Delete chat" onClick={() => setDeleting(w.id)}><Icon name="trash" /></button>
            </span>}
      </li>)}</ul> : null}
    </div>
  </section>;
}

/* ── memory: the person's instructions, and what it keeps about them ── */

/*
 * Memory: the person's instructions and what Kimono AI keeps about them, as
 * pages. Each opens on a page of its own, a title and as many words as it
 * needs, saved as they're written. One the agent kept is a sentence; once
 * the person gives it a title, it's a page like theirs.
 */
const pageWords = (text: string, words = 30) => { const all = text.replace(/\s+/g, " ").trim().split(" "); return all.length > words ? `${all.slice(0, words).join(" ")}…` : all.join(" "); };

function MemoryView({ now, page }: { now: number; page: string | null }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { code.memory().then(setProfile, (error) => setProblem(problemText(error))); }, []);
  if (page) return <MemoryPage key={page} page={page} profile={profile} now={now} onProfile={setProfile} />;
  const drop = (id: string) => {
    setProfile((p) => p && { ...p, memories: p.memories.filter((m) => m.id !== id) });
    code.forget(id).then(setProfile, (error) => { setProblem(problemText(error)); void code.memory().then(setProfile); });
  };
  return <section className="cd-sheet cd-conn cd-memory">
    <header className="cd-conn-head">
      <button type="button" className="cd-roundbutton cd-back" onClick={() => goTo({})} aria-label="All chats" title="All chats"><Icon name="back" /></button>
      <button type="button" className="cd-roundbutton cd-unfold" onClick={() => setFolded(false)} aria-label="Show chats" title="Show chats"><Icon name="panel" /></button>
      <h1>For you</h1>
    </header>
    <div className="cd-conn-body">
      {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
      {profile === null && !problem ? <SkeletonRows rows={3} mark={false} /> : null}
      {/* Three parts, each named: how it should work for you, what it remembers, and the skills it can use. */}
      {profile ? <section className="cd-skills cd-for" aria-labelledby="cd-instructions-title">
        <h2 id="cd-instructions-title">Instructions</h2>
        <ul className="cd-pages"><li><button type="button" className="cd-page-card is-instructions" onClick={() => goTo({ memory: "1", page: "instructions" })}>
          <InkBlot className="cd-page-mark" tint={inkTint.suo} seed="instructions"><Icon name="spark" /></InkBlot>
          <span className="cd-page-words"><b>{profile.instructions ? pageWords(profile.instructions, 14) : "Add instructions"}</b><small>{profile.instructions ? "Followed in every chat" : "How it should work for you, in every chat"}</small></span>
        </button></li></ul>
      </section> : null}
      {profile ? <section className="cd-skills cd-for" aria-labelledby="cd-memories-title">
        <div className="cd-for-head">
          <h2 id="cd-memories-title">Memories</h2>
          <button type="button" className="cd-quietbutton" onClick={() => goTo({ memory: "1", page: "new" })}><Icon name="plus" />Add</button>
        </div>
        {profile.memories.length ? <ul className="cd-pages">{profile.memories.map((m) => <li key={m.id} className="cd-page-row">
          <button type="button" className="cd-page-card" onClick={() => goTo({ memory: "1", page: m.id })}>
            <InkBlot className="cd-page-mark" tint={m.source === "ai" ? inkTint.quiet : inkTint.live} seed={m.id}><Icon name={m.source === "ai" ? "chat" : "file"} /></InkBlot>
            <span className="cd-page-words">
              <b>{m.title ?? pageWords(m.text, 12)}</b>
              <small>{m.title ? `${pageWords(m.text, 18)} · ` : ""}{m.source === "ai" ? "Kimono AI kept this" : "Yours"} · {when(m.createdAt, now)}</small>
            </span>
          </button>
          <button type="button" className="cd-roundbutton cd-page-drop" aria-label={`Forget ${m.title ?? "this"}`} title="Forget this" onClick={() => drop(m.id)}><Icon name="trash" /></button>
        </li>)}</ul>
          : <p className="cd-for-empty">Nothing yet. Tell it to remember something in a chat, or add it here.</p>}
      </section> : null}
      <SkillsList />
    </div>
  </section>;
}

/** The skills catalog: well-known published skills, each turned on or off for every chat. */
function SkillsList() {
  const [list, setList] = useState<SkillChoice[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { code.skills().then(setList, (error) => setProblem(problemText(error))); }, []);
  const flip = (id: string, enabled: boolean) => {
    setList((l) => l && l.map((s) => s.id === id ? { ...s, enabled } : s));
    code.setSkill(id, enabled).then(setList, (error) => { setProblem(problemText(error)); void code.skills().then(setList); });
  };
  return <section className="cd-skills" aria-labelledby="cd-skills-title">
    <h2 id="cd-skills-title">Skills</h2>
    {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
    {list === null && !problem ? <SkeletonRows rows={4} mark={false} /> : null}
    {list ? <ul className="cd-pages">
      {list.map((s) => <li key={s.id} className="cd-skill">
        <InkBlot className="cd-page-mark" tint={s.enabled ? inkTint.live : inkTint.quiet} seed={s.id}><Icon name={s.icon as IconName} /></InkBlot>
        <span className="cd-page-words">
          <b>{s.name}</b>
          <small>{s.description} <a href={s.source} target="_blank" rel="noreferrer">{s.author}</a></small>
        </span>
        <JointSwitch name={`skill-${s.id}`} defaultChecked={s.enabled} label={s.name} onChange={(on) => flip(s.id, on)} />
      </li>)}
    </ul> : null}
  </section>;
}

/** One page of Memory: its title and its words, saved a moment after they stop changing. */
function MemoryPage({ page, profile, now, onProfile }: { page: string; profile: Profile | null; now: number; onProfile: (p: Profile) => void }) {
  const instructions = page === "instructions";
  const memory = profile?.memories.find((m) => m.id === page) ?? null;
  const [id, setId] = useState<string | null>(page === "new" || instructions ? null : page);
  const [title, setTitle] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<"saved" | "saving" | "idle">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const shownTitle = title ?? (instructions ? "Instructions" : memory?.title ?? "");
  const shownText = text ?? (instructions ? profile?.instructions ?? "" : memory?.text ?? "");
  const limit = instructions ? 20_000 : 8000;
  const body = useRef<HTMLTextAreaElement>(null);
  /* the page grows with its words; the sheet scrolls, not the field */
  useLayoutEffect(() => { const el = body.current; if (!el) return; el.style.height = "0px"; el.style.height = `${el.scrollHeight}px`; }, [shownText]);
  const saving = useRef(Promise.resolve());
  useEffect(() => {
    if (title === null && text === null) return;
    const timer = setTimeout(() => {
      const words = shownText.trim();
      if (!instructions && !words) return;
      setState("saving"); setProblem(null);
      /* one save at a time, in order, so a quick second edit never lands before the first */
      saving.current = saving.current.then(async () => {
        try {
          let next: Profile;
          if (instructions) next = await code.saveInstructions(shownText);
          else if (id) next = await code.changeMemory(id, shownText, shownTitle);
          else {
            next = await code.remember(shownText, shownTitle);
            const made = next.memories.find((m) => m.source === "person" && m.text === words.replace(/\r\n?/g, "\n"));
            if (made) { setId(made.id); window.history.replaceState(null, "", `/code#memory=1&page=${made.id}`); }
          }
          onProfile(next);
          setState("saved");
        } catch (error) { setProblem(problemText(error)); setState("idle"); }
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [title, text]); // eslint-disable-line react-hooks/exhaustive-deps -- saves what was written; the rest is read as it stands
  const missing = profile !== null && !instructions && page !== "new" && !memory && !id;
  return <section className="cd-sheet cd-conn cd-memory cd-page">
    <header className="cd-conn-head">
      <button type="button" className="cd-roundbutton cd-back" onClick={() => goTo({ memory: "1" })} aria-label="For you" title="For you"><Icon name="back" /></button>
      <button type="button" className="cd-roundbutton cd-unfold" onClick={() => setFolded(false)} aria-label="Show chats" title="Show chats"><Icon name="panel" /></button>
      <span className="cd-page-state" role="status">{problem ? <span className="cd-problem">{problem}</span> : state === "saving" ? "Saving…" : state === "saved" ? "Saved" : memory ? `${memory.source === "ai" ? "Kimono AI kept this" : "Yours"} · ${when(memory.createdAt, now)}` : ""}</span>
      <span className="cd-grow" />
      {id ? <button type="button" className="cd-roundbutton" aria-label="Forget this page" title="Forget this page" onClick={() => { void code.forget(id).then((next) => { onProfile(next); goTo({ memory: "1" }); }, (error) => setProblem(problemText(error))); }}><Icon name="trash" /></button> : null}
    </header>
    <div className="cd-conn-body cd-page-body">
      {profile === null ? <SkeletonRows rows={3} mark={false} />
        : missing ? <p className="cd-conn-empty">This page isn&rsquo;t here any more.</p>
        : <>
          {instructions ? <h1 className="cd-page-title is-fixed">Instructions</h1>
            : <input className="cd-page-title" value={shownTitle} maxLength={120} placeholder="Untitled" aria-label="Title" autoFocus={page === "new"}
                onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); body.current?.focus(); } }} />}
          <textarea ref={body} className="cd-page-text" value={shownText} maxLength={limit} aria-label={instructions ? "Instructions" : "Page"}
            placeholder={instructions ? "How it should work for you. Who you are, how you like answers, what to always or never do. Write as much as you like." : "Write anything it should know: about you, your household, how you like things done."}
            onChange={(event) => setText(event.target.value)} />
          {shownText.length > limit * .8 ? <p className="cd-faint cd-page-count">{shownText.length.toLocaleString("en")} / {limit.toLocaleString("en")}</p> : null}
        </>}
    </div>
  </section>;
}

/* ── connections: the person's own apps, as Composio keeps them ──
 * One page: what they've connected on top (when there is any), every app they could add below; and a page for one app in full. */

const connStatus = (c: Connection, now: number) => c.status === "ACTIVE" ? c.since ? `Connected ${when(Date.parse(c.since), now).replace(/^(Today|Yesterday)/, (word) => word.toLowerCase())}` : "Connected" : c.status === "FAILED" ? "Needs connecting again" : "Connecting…";

/** The person's connections, kept fresh: coming back from connecting (another tab) looks again. */
function useConnections() {
  const [state, setState] = useState<{ available: boolean; connections: Connection[]; pro?: ConnectableApp[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => code.connections().then((next) => { setState(next); setProblem(null); }, (error) => setProblem(problemText(error))), []);
  useEffect(() => {
    void load();
    const back = () => { void load(); };
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, [load]);
  const connect = (app: string) => {
    setBusy(app); setProblem(null);
    const opened = window.open("about:blank", "_blank");
    code.connect(app).then((url) => { if (opened) opened.location.href = url; else window.location.href = url; }, (error) => { opened?.close(); setProblem(problemText(error)); }).finally(() => setBusy(null));
  };
  const remove = (c: Connection) => {
    setBusy(c.account); setProblem(null);
    return code.disconnect(c.account).then(() => load(), (error) => setProblem(problemText(error))).finally(() => setBusy(null));
  };
  return { state, problem, setProblem, busy, connect, remove };
}

function ConnectionsView({ now, app }: { now: number; app: string | null }) {
  const conn = useConnections();
  const { state, problem } = conn;
  const head = (title: string, back: () => void) => <header className="cd-conn-head">
    <button type="button" className="cd-roundbutton cd-back" onClick={back} aria-label="Back" title="Back"><Icon name="back" /></button>
    <button type="button" className="cd-roundbutton cd-unfold" onClick={() => setFolded(false)} aria-label="Show chats" title="Show chats"><Icon name="panel" /></button>
    <h1>{title}</h1>
  </header>;
  if (app) return <AppPage key={app} slug={app} now={now} conn={conn} head={head} />;
  const mine = state?.connections ?? [];
  return <section className="cd-sheet cd-conn">
    {head("Connections", () => goTo({}))}
    <div className="cd-conn-body">
      {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
      {state === null && !problem ? <SkeletonRows rows={3} mark={false} /> : null}
      {state && !state.available ? <p className="cd-conn-empty">Connections aren&rsquo;t available on this Kimono yet.</p> : null}
      {state?.available ? <>
        {mine.length ? <><h2 className="cd-conn-sub is-first">Connected</h2><YourApps now={now} conn={conn} /></> : null}
        {state.pro?.length ? <ProApps apps={state.pro} first={!mine.length} /> : null}
        {mine.length || state.pro?.length ? <h2 className="cd-conn-sub">Add apps</h2> : null}
        <AddApps conn={conn} />
      </> : null}
    </div>
  </section>;
}

type Conn = ReturnType<typeof useConnections>;
const openApp = (slug: string) => goTo({ connections: "1", app: slug });
/** Composio's own toolkits are how apps connect, not apps of their own. */
const realApp = (a: { app: string }) => !a.app.startsWith("composio");

function YourApps({ now, conn }: { now: number; conn: Conn }) {
  const mine = conn.state?.connections ?? [];
  return <ul className="cd-conn-list">{mine.map((c) => <li key={c.account} className="cd-conn-card is-link">
    <button type="button" className="cd-conn-open" onClick={() => openApp(c.app)} aria-label={`${c.name}: ${connStatus(c, now)}`} />
    {/* eslint-disable-next-line @next/next/no-img-element -- the app's own logo, as Composio serves it */}
    <InkBlot className="cd-conn-logo" tint={inkTint.quiet} seed={c.app}><img src={c.logo} alt="" /></InkBlot>
    <span className="cd-conn-id"><b>{c.name}</b><small className={cx(c.status === "FAILED" && "is-bad")}>{connStatus(c, now)}</small></span>
    {c.status === "FAILED" ? <span className="cd-conn-acts"><Seal type="button" compact busy={conn.busy === c.app} onClick={() => conn.connect(c.app)}>Connect again</Seal></span> : null}
    <span className="cd-conn-chev" aria-hidden="true"><Icon name="chevron" /></span>
  </li>)}</ul>;
}

/** Apps that work as Pro Tools, with nothing to connect: the eight people reach for most, the rest folded away. */
function ProApps({ apps, first }: { apps: ConnectableApp[]; first: boolean }) {
  const [all, setAll] = useState(false);
  const [media, setMedia] = useState<Usage["media"]>(null);
  useEffect(() => { let live = true; code.usage().then((u) => { if (live) setMedia(u.media ?? null); }, () => {}); return () => { live = false; }; }, []);
  const shown = all ? apps : apps.slice(0, 8);
  return <>
    <div className={cx("cd-conn-prohead", first && "is-first")}>
      <span><h2 className="cd-conn-sub cd-pro"><Icon name="bolt" />Pro Tools</h2><small>No connection needed, with a limited budget each month.</small></span>
      {media ? <span className="cd-conn-budget"><b>{media.spent == null ? credits(media.budget) : `${creditNumber(Math.max(0, media.budget - media.spent))} of ${credits(media.budget)} left`}</b><small>Resets {monthWords(media.resetsAt)}</small></span> : null}
    </div>
    <ul className="cd-pro-grid" id="cd-pro-grid">{shown.map((a) => <li key={a.app} className="cd-pro-tile">
      <button type="button" className="cd-conn-open" onClick={() => openApp(a.app)} aria-label={`About ${a.name}`} title={a.description || undefined} />
      {/* eslint-disable-next-line @next/next/no-img-element -- the app's own logo, as Composio serves it */}
      <span className="cd-pro-logo"><InkBlot className="cd-conn-logo" tint={inkTint.quiet} seed={a.app}><img src={a.logo} alt="" /></InkBlot><svg className="cd-pro-bolt" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 3 5.5 13.5h6L10.5 21l8-10.5h-6z" /></svg></span>
      <b>{a.name}</b>
    </li>)}</ul>
    {apps.length > 8 ? <div className="cd-conn-more"><Seal type="button" tone="quiet" aria-expanded={all} aria-controls="cd-pro-grid" onClick={() => setAll(!all)}>{all ? "Show fewer" : `See all ${apps.length}`}</Seal></div> : null}
  </>;
}

/** The catalog, a page at a time: each page asked for by Composio's cursor, the ones already seen kept to go back to. */
function AddApps({ conn }: { conn: Conn }) {
  /* The search is ready to type into, without the page jumping down to it. */
  const searchFocused = useRef(false);
  const top = useRef<HTMLLabelElement>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ q: string; page: number; cursors: (string | null)[]; apps: ConnectableApp[]; next: string | null } | null>(null);
  const [turning, setTurning] = useState(false);
  const { setProblem } = conn;
  useEffect(() => {
    /* A search you've moved on from never answers over the one you're on. */
    let live = true;
    const wait = setTimeout(() => { code.findApps(query).then((page) => { if (live) setFound({ q: query, page: 0, cursors: [null], apps: page.apps.filter(realApp), next: page.next }); }, (error) => { if (live) setProblem(problemText(error)); }); }, query ? 250 : 0);
    return () => { live = false; clearTimeout(wait); };
  }, [query, setProblem]);
  /* What's connected is listed above, so the catalog leaves it out. */
  const apps = found && found.q === query ? found.apps.filter((a) => !a.connected) : null;
  const turn = (to: number) => {
    if (!found || turning) return;
    const asked = found;
    const cursors = to > asked.page ? [...asked.cursors.slice(0, asked.page + 1), asked.next] : asked.cursors;
    setTurning(true);
    code.findApps(asked.q, cursors[to]).then((page) => {
      setFound((now) => now?.q !== asked.q ? now : { q: asked.q, page: to, cursors, apps: page.apps.filter(realApp), next: page.next });
      top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, (error) => setProblem(problemText(error))).finally(() => setTurning(false));
  };
  return <>
    <label ref={top} className="cd-conn-search"><Icon name="search" /><input ref={(el) => { if (el && !searchFocused.current) { searchFocused.current = true; el.focus({ preventScroll: true }); } }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search apps" aria-label="Search apps" /></label>
    {apps === null ? <SkeletonRows rows={2} mark={false} /> : !found?.apps.length ? <p className="cd-conn-empty">No app by that name.</p> : <ul className={cx("cd-conn-grid", turning && "is-turning")}>{apps.map((a) => <li key={a.app} className="cd-conn-tile is-link">
      <button type="button" className="cd-conn-open" onClick={() => openApp(a.app)} aria-label={`About ${a.name}`} />
      {/* eslint-disable-next-line @next/next/no-img-element -- the app's own logo, as Composio serves it */}
      <InkBlot className="cd-conn-logo" tint={inkTint.quiet} seed={a.app}><img src={a.logo} alt="" /></InkBlot>
      <span className="cd-conn-id"><b>{a.name}</b>{a.description ? <small>{a.description}</small> : null}</span>
      <Seal type="button" compact tone="quiet" busy={conn.busy === a.app} onClick={() => conn.connect(a.app)}>Connect</Seal>
    </li>)}</ul>}
    {apps && found && (found.page > 0 || found.next) ? <nav className="cd-conn-pages" aria-label="Pages">
      <button type="button" className="cd-roundbutton cd-flip" disabled={found.page === 0 || turning} onClick={() => turn(found.page - 1)} aria-label="Previous page" title="Previous page"><Icon name="chevron" /></button>
      <span aria-live="polite">Page {found.page + 1}</span>
      <button type="button" className="cd-roundbutton" disabled={!found.next || turning} onClick={() => turn(found.page + 1)} aria-label="Next page" title="Next page"><Icon name="chevron" /></button>
    </nav> : null}
  </>;
}

/** One app in full: what it is, whether it's connected, and what Kimono AI can do with it. */
function AppPage({ slug, now, conn, head }: { slug: string; now: number; conn: Conn; head: (title: string, back: () => void) => React.ReactNode }) {
  const [about, setAbout] = useState<AppDetails | null>(null);
  const [confirming, setConfirming] = useState(false);
  const look = useAppLook(slug);
  useEffect(() => { let live = true; code.appDetails(slug).then((d) => { if (live) setAbout(d); }, () => {}); return () => { live = false; }; }, [slug]);
  const mine = conn.state?.connections.find((c) => c.app === slug) ?? null;
  const pro = conn.state?.pro?.some((a) => a.app === slug) ?? false;
  const name = about?.name ?? mine?.name ?? look.name;
  const logo = about?.logo ?? mine?.logo ?? look.logo;
  const more = about?.toolCount && about.toolCount > about.tools.length ? about.toolCount - about.tools.length : 0;
  return <section className="cd-sheet cd-conn cd-app">
    {head(name, () => goTo({ connections: "1" }))}
    <div className="cd-conn-body">
      {conn.problem ? <p className="cd-problem" role="alert">{conn.problem}</p> : null}
      <div className="cd-app-hero">
        {/* eslint-disable-next-line @next/next/no-img-element -- the app's own logo, as Composio serves it */}
        <InkBlot className="cd-conn-logo cd-app-logo" tint={inkTint.quiet} seed={slug}>{logo ? <img src={logo} alt="" /> : <Icon name="gear" />}</InkBlot>
        <span className="cd-conn-id">
          <b>{name}</b>
          {about?.categories.length ? <small>{about.categories.join(" · ")}</small> : null}
          <small className={cx(mine?.status === "FAILED" && "is-bad")}>{mine ? connStatus(mine, now) : pro ? <span className="cd-pro"><Icon name="bolt" />Pro Tool</span> : conn.state ? "Not connected" : "\u00a0"}</small>
        </span>
        <span className="cd-conn-acts">
          {!conn.state?.available ? null
            : !mine ? <Seal type="button" busy={conn.busy === slug} onClick={() => conn.connect(slug)}>Connect</Seal>
            : confirming ? <><button type="button" className="cd-quietbutton is-danger" disabled={conn.busy === mine.account} aria-busy={conn.busy === mine.account || undefined} onClick={() => { void conn.remove(mine).then(() => setConfirming(false)); }}><BusyFace busy={conn.busy === mine.account}>Disconnect</BusyFace></button><button type="button" className="cd-quietbutton" onClick={() => setConfirming(false)}>Keep</button></>
            : <>{mine.status === "FAILED" ? <Seal type="button" compact busy={conn.busy === slug} onClick={() => conn.connect(slug)}>Connect again</Seal> : null}<button type="button" className="cd-quietbutton" onClick={() => setConfirming(true)}>Disconnect</button></>}
        </span>
      </div>
      {about === null ? <SkeletonRows rows={3} mark={false} /> : <>
        {about.description ? <p className="cd-app-about">{about.description}</p> : null}
        {about.tools.length ? <>
          <h2 className="cd-conn-sub">What Kimono AI can do with it</h2>
          <ul className="cd-app-tools">{about.tools.map((t) => <li key={t.name}><b>{t.name}</b>{t.description ? <small>{t.description}</small> : null}</li>)}</ul>
          {more ? <p className="cd-conn-empty">And {more} more.</p> : null}
        </> : about.toolCount ? <p className="cd-app-count"><b>{about.toolCount}</b> things Kimono AI can do with it{mine || pro ? "" : " once it\u2019s connected"}.</p> : null}
      </>}
    </div>
  </section>;
}

/* ── marks: what a call or a card is about, drawn as that thing ── */

type Marks = { drive: AppIdentity | null; spaces: Map<string, DriveSpace> };
const MarksContext = createContext<Marks>({ drive: null, spaces: new Map() });

/* ── who is looking, and what they may do in the chat in front of them ──
   A chat can be shared (lib/code/sharing.ts): the person may own it, write
   in it, or only read it. Someone who opened its link without signing in is
   a guest, and sees the chat alone. */

type Viewer = { me: string | null; guest: boolean; people: Map<string, Person>; /** An administrator reading it from the feedback page. */ peek?: boolean };
const ViewerContext = createContext<Viewer>({ me: null, guest: false, people: new Map() });
const ChatAccess = createContext<{ access: Access; owner: string }>({ access: "owner", owner: "" });
/** Whether the person looking owns the chat in front of them: only they rename, share, run its app, answer for its Drive. */
const useOwns = () => useContext(ChatAccess).access === "owner";

/** Someone in the household by their username: their name and picture when Kimono knows them. */
function usePerson(username: string): Person {
  const found = useContext(ViewerContext).people.get(username.toLowerCase());
  return found ?? { username, name: username, picture: null };
}

function Face({ username, size = 20 }: { username: string; size?: number }) {
  const person = usePerson(username);
  return <Portrait name={person.name} username={person.username} picture={person.picture} size={size} className="cd-face" />;
}

/** A space's crest, as Drive draws it; nothing if the space isn't known. */
function SpaceCrest({ name }: { name: string }) {
  const space = useContext(MarksContext).spaces.get(name.toLowerCase());
  if (!space?.mark) return null;
  return <span className="cd-crest" aria-hidden="true" dangerouslySetInnerHTML={{ __html: space.mark }} />;
}

/** A space, as a chip: its crest and its name. It opens the space in Drive. */
function SpaceChip({ name }: { name: string }) {
  const space = useContext(MarksContext).spaces.get(name.toLowerCase());
  if (!space) return <span className="cd-spacechip"><SpaceCrest name={name} />{name}</span>;
  /* Inside a tool call's row the click opens Drive, not the row. */
  return <Crossing kind="kakejiku" className="cd-spacechip" href={`/drive?space=${encodeURIComponent(space.id)}`} title={`Open ${space.name} in Drive`} onClick={(event) => event.stopPropagation()}>
    <SpaceCrest name={name} />{name}
  </Crossing>;
}

/** A file or folder in a space, by name; it opens in Drive when Kimono knows which one it is. */
function DriveName({ space, node, children }: { space: string; node?: string; children: React.ReactNode }) {
  const known = useContext(MarksContext).spaces.get(space.toLowerCase());
  if (!known || !node) return <b>{children}</b>;
  return <Crossing kind="kakejiku" className="cd-drivename" href={`/drive?space=${encodeURIComponent(known.id)}&file=${encodeURIComponent(node)}`} onClick={(event) => event.stopPropagation()}>{children}</Crossing>;
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
    if (!slug) return;
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

/* Marks sit on a watercolour wash (InkBlot), never a flat tile: quiet for what's at rest, suō for the agent's own work and what's open, moss for what's live. */
const inkTint = { quiet: "#8a7c77", suo: "#a84d63", live: "#5c7150" } as const;

/** An app's logo; one used as a Pro Tool wears a filled bolt on its top right. */
function AppLogo({ slug, pro }: { slug: string; pro?: boolean }) {
  const look = useAppLook(slug);
  // eslint-disable-next-line @next/next/no-img-element -- the app's own logo, as Composio serves it
  const logo = look.logo ? <img className="cd-applogo" src={look.logo} alt="" /> : <Icon name="gear" />;
  if (!pro) return logo;
  return <span className="cd-pro-logo" title="Pro Tool">{logo}<svg className="cd-pro-bolt" viewBox="0 0 24 24" aria-label="Pro Tool"><path d="M13.5 3 5.5 13.5h6L10.5 21l8-10.5h-6z" /></svg></span>;
}

function AppName({ slug }: { slug: string }) {
  return <>{useAppLook(slug).name}</>;
}

/* The longest message it takes (the server refuses more): the box stops there, and counts down near it. */
const maxMessage = 32_000;
function MessageCount({ length }: { length: number }) {
  if (length < maxMessage * .9) return null;
  return <span className={cx("cd-entry-count", length >= maxMessage && "is-over")} aria-live="polite">{length.toLocaleString("en")} / {maxMessage.toLocaleString("en")}</span>;
}

/**
 * Send and Stop are one seal: while the agent works and nothing is written it
 * stops it; a word typed turns it back into Send. The arrow lifts away as the
 * square turns in, the seal's ink changing with it, and back again.
 */
function SendStop({ mode, disabled, busy, onSend, onStop }: { mode: "send" | "stop"; disabled?: boolean; busy?: boolean; onSend: () => void; onStop?: () => void }) {
  const stop = mode === "stop";
  return <Seal type="button" compact tone={stop ? "danger" : "primary"} className={cx("cd-sendstop", stop && "is-stop", busy && "is-sending")} disabled={disabled || busy}
    aria-label={stop ? "Stop" : "Send"} title={stop ? "Stop" : "Send (↵, Shift-↵ for a new line)"} aria-keyshortcuts={stop ? undefined : "Enter"}
    onClick={() => (stop ? onStop?.() : onSend())}>
    <span className="cd-ss" aria-hidden="true">
      <span className="cd-ss-send">{busy ? <InkLoader tone="plain" label="Sending" className="cd-morph" /> : <svg viewBox="0 0 24 24"><path className="cd-ss-shaft" d="M12 19V6" /><path className="cd-ss-head" d="M6.5 11 12 5.5l5.5 5.5" /></svg>}</span>
      <span className="cd-ss-stop"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2.2" /></svg></span>
    </span>
  </Seal>;
}

/**
 * A reply as it's written. Words reach the page in bursts of any size; they're
 * let out a word at a time and each fades in as it lands. It never holds the
 * reply back: whatever has arrived is out within about a fifth of a second.
 */
function DraftWords({ text }: { text: string }) {
  return <RevealWords text={text} className="cd-say is-draft" />;
}

/* How far the reply being written has been let out. A finished reply that takes its draft's place
   carries on from here instead of jumping to its end; any other starts from its first word. */
const revealed = { text: "", at: 0 };
/* How far each live reply got, by chat and seq, so one shown again doesn't fade in again. */
const lettedOut = new Map<string, number>();

/** Lets [text] out a word at a time: at least 150 letters a second, faster the further behind, each word fading in; plain once it's all out. */
function RevealWords({ text, className, id }: { text: string; className: string; id?: string }) {
  const [shown, setShown] = useState(() => {
    const kept = id ? lettedOut.get(id) : undefined;
    if (kept !== undefined && kept <= text.length) return kept;
    return revealed.at > 0 && revealed.at <= text.length && text.startsWith(revealed.text.slice(0, revealed.at)) ? revealed.at : 0;
  });
  const target = useRef(text);
  const at = useRef(shown);
  useEffect(() => {
    /* Rewritten rather than grown (a new reply): start again. */
    if (!text.startsWith(target.current.slice(0, at.current))) at.current = 0;
    target.current = text;
  }, [text]);
  useEffect(() => {
    let frame = 0, last = 0, owed = 0;
    const step = (now: number) => {
      frame = requestAnimationFrame(step);
      const dt = last ? Math.min(100, now - last) : 16;
      last = now;
      const goal = target.current.length;
      if (at.current >= goal) { owed = 0; revealed.text = target.current; revealed.at = goal; if (id) lettedOut.set(id, goal); return; }
      /* what's waiting goes out within ~200 ms; never slower than 150 letters a second */
      owed += dt * Math.max(0.15, (goal - at.current) / 200);
      if (owed < 1) return;
      let next = Math.min(goal, at.current + Math.floor(owed));
      owed -= Math.floor(owed);
      /* to the end of a word, so a word lands whole (unless it's a long one) */
      const space = target.current.slice(next).search(/\s/);
      if (space >= 0 && space <= 24) next = Math.min(goal, next + space);
      at.current = next;
      revealed.text = target.current; revealed.at = next;
      if (id) lettedOut.set(id, next);
      setShown(next);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [id]);
  /* A finished reply, once it's all out, is drawn as any reply is, with no fading words left to fade again.
     A draft keeps its words as they are: it may grow again any moment. */
  const done = id !== undefined && shown >= text.length;
  return <div className={className}><Markdown text={done ? text : text.slice(0, shown)} streaming={!done} /></div>;
}

/** One of the person's apps needs connecting: its logo, and a button that opens Composio's sign-in for it. Says so once it's connected. */
/* Every card in a chat asks at once: one answer serves them all for a few seconds. */
let connectionsAsked: { at: number; answer: ReturnType<typeof code.connections> } | null = null;
function connectionsNow() {
  if (!connectionsAsked || Date.now() - connectionsAsked.at > 4000) connectionsAsked = { at: Date.now(), answer: code.connections() };
  return connectionsAsked.answer;
}

function ConnectCard({ app, url }: { app: string; url: string }) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (connected) return;
    let live = true;
    const check = () => { if (document.hidden) return; connectionsNow().then((r) => { if (live && r.connections.some((c) => c.app === app && c.status === "ACTIVE")) setConnected(true); }, () => {}); };
    check();
    /* Back from signing in (another tab), look again. */
    window.addEventListener("focus", check);
    const timer = setInterval(check, 5000);
    return () => { live = false; window.removeEventListener("focus", check); clearInterval(timer); };
  }, [app, connected]);
  return <div className={cx("cd-connect", connected && "is-done")}>
    <InkBlot className="cd-connect-logo" tint={connected ? inkTint.live : inkTint.quiet} seed={app}><AppLogo slug={app} /></InkBlot>
    <span className="cd-connect-words"><b>{connected ? <><AppName slug={app} /> is connected</> : <>Connect <AppName slug={app} /></>}</b><small>{connected ? "Kimono AI can use it now." : "Sign in, then come back here."}</small></span>
    {connected ? <span className="cd-conn-on"><Icon name="check" />Connected</span>
      : <Seal type="button" compact onClick={() => openOutside(url)}>Connect</Seal>}
  </div>;
}

/** What a call is about: the app it used, Drive, or what kind of step it was. */
function ToolMark({ tool }: { tool: Tool }) {
  if (tool.app) return <AppLogo slug={tool.app} pro={tool.pro} />;
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

/** The chat's name: Kimono names it after the first reply; a click renames it. */
function ChatTitle({ workspace, onRenamed }: { workspace: Workspace; onRenamed: () => void }) {
  const owns = useOwns();
  const [editing, setEditing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const saving = useRef(false);
  async function save() {
    if (editing === null || saving.current) return;
    const title = editing.trim().replace(/\s+/g, " ");
    if (!title || title === workspace.title) { setEditing(null); return; }
    saving.current = true;
    try { await code.rename(workspace.id, title); setEditing(null); setProblem(null); onRenamed(); } catch (error) { setProblem(problemText(error)); } finally { saving.current = false; }
  }
  if (editing !== null) return <form className="cd-title-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <h1><input autoFocus className="cd-title-input" value={editing} maxLength={120} aria-label="Chat name" onFocus={(event) => event.target.select()}
      onChange={(event) => setEditing(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => { if (event.key === "Escape") { setEditing(null); setProblem(null); } }} /></h1>
    {problem ? <span className="cd-faint" role="alert">{problem}</span> : null}
  </form>;
  if (!owns) return <h1 title={workspace.title}>{workspace.title}</h1>;
  return <h1 title={workspace.title}><button type="button" className="cd-title-button" title="Rename" onClick={() => setEditing(workspace.title)}>{workspace.title}</button></h1>;
}

/** A project in the list: its name (rename, remove), a new chat in it, and its chats. */
const readList = (key: string): string[] => { try { const v = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };
const writeList = (key: string, list: string[]) => { try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* not kept */ } };

/* What a drag in the list carries: a chat, or a project being moved. */
const chatDrag = "application/x-kimono-chat";
const groupDrag = "application/x-kimono-group";

/**
 * A group in the list: Recent, a project, or a repository's chats. It folds; a chat dropped on it is
 * filed there, and a project dragged by its head goes where it's dropped. A long one shows its newest first.
 */
function SideGroup({ gkey, icon, title, actions, chats, current, now, collapsed, onToggle, onDropChat, onDropGroup, cap, empty, head }: {
  gkey: string; icon: IconName; title: React.ReactNode; actions?: React.ReactNode; chats: Workspace[]; current: string | null; now: number;
  collapsed: boolean; onToggle: () => void; onDropChat?: (id: string) => void; onDropGroup?: (from: string) => void; cap?: number; empty?: React.ReactNode; head?: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const [all, setAll] = useState(false);
  const shown = cap && !all ? chats.slice(0, cap) : chats;
  const takes = (event: React.DragEvent) => (onDropChat && event.dataTransfer.types.includes(chatDrag)) || (onDropGroup && event.dataTransfer.types.includes(groupDrag));
  return <div className={cx("cd-project cd-folder", over && "is-over", collapsed && "is-folded")}
    onDragOver={(event) => { if (!takes(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(true); }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(false); }}
    onDrop={(event) => {
      setOver(false);
      const chat = event.dataTransfer.getData(chatDrag), group = event.dataTransfer.getData(groupDrag);
      if (chat && onDropChat) { event.preventDefault(); onDropChat(chat); }
      else if (group && onDropGroup) { event.preventDefault(); onDropGroup(group); }
    }}>
    {head ?? <div className="cd-folder-head" draggable={Boolean(onDropGroup)} onDragStart={(event) => { event.dataTransfer.setData(groupDrag, gkey); event.dataTransfer.effectAllowed = "move"; }}>
      <button type="button" className="cd-fold-toggle" aria-expanded={!collapsed} aria-label={collapsed ? "Show" : "Fold"} title={collapsed ? "Show" : "Fold"} onClick={onToggle}><Icon name="chevron" /></button>
      <Icon name={icon} />
      {title}
      {collapsed && chats.length ? <small className="cd-folder-count">{chats.length}</small> : null}
      {actions}
    </div>}
    {collapsed ? null : chats.length ? <>
      <WorkspaceList list={shown} current={current} now={now} />
      {cap && chats.length > cap ? <button type="button" className="cd-textbutton cd-folder-more" onClick={() => setAll(!all)}>{all ? "Fewer" : `··· ${chats.length - cap} more`}</button> : null}
    </> : empty ?? null}
  </div>;
}

function FolderGroup({ gkey, project, chats, current, now, renaming, onRename, onSaveName, onCancelName, onRemove, collapsed, onToggle, onDropChat, onDropGroup }: {
  gkey: string; project: Project; chats: Workspace[]; current: string | null; now: number;
  renaming: string | null; onRename: (name: string) => void; onSaveName: () => void; onCancelName: () => void; onRemove: () => void;
  collapsed: boolean; onToggle: () => void; onDropChat: (id: string) => void; onDropGroup: (from: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return <SideGroup gkey={gkey} icon="folder" chats={chats} current={current} now={now} collapsed={collapsed} onToggle={onToggle} onDropChat={onDropChat} onDropGroup={onDropGroup}
    empty={<p className="cd-quiet cd-folder-empty">No chats yet. Drag one here.</p>}
    /* Its name is edited where it sits: a double click turns the name into a field of the same size, Enter or a click away keeps it, Escape leaves it. */
    title={renaming !== null
      ? <input className="cd-folder-title is-editing" autoFocus value={renaming} maxLength={60} aria-label="Project name" size={Math.max(4, renaming.length + 1)}
          onFocus={(event) => event.target.select()} onClick={(event) => event.stopPropagation()}
          onChange={(event) => onRename(event.target.value)} onBlur={onSaveName}
          onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); onSaveName(); } if (event.key === "Escape") onCancelName(); }} />
      : <span className="cd-folder-title" title="Double-click to rename" onDoubleClick={(event) => { event.stopPropagation(); onRename(project.name); }}>{project.name}</span>}
    actions={confirm
      ? <><button type="button" className="cd-quietbutton is-danger" onClick={onRemove}>Remove</button><button type="button" className="cd-quietbutton" onClick={() => setConfirm(false)}>Keep</button></>
      : <>
          <button type="button" className="cd-roundbutton cd-project-new" onClick={() => goTo({ new: "1", in: project.id })} aria-label={`New chat in ${project.name}`} title={`New chat in ${project.name}`}><Icon name="plus" /></button>
          <button type="button" className="cd-roundbutton cd-project-new" onClick={() => setConfirm(true)} aria-label={`Remove ${project.name}`} title="Remove the project (its chats stay)"><Icon name="trash" /></button>
        </>} />;
}

/** What a search finds: chats by their name, their project or their repository, newest first. */
function SearchResults({ words, chats, current, now }: { words: string; chats: Workspace[]; current: string | null; now: number }) {
  const terms = words.toLowerCase().split(/\s+/).filter(Boolean);
  const found = [...new Map(chats.map((w) => [w.id, w])).values()].filter((w) => {
    const text = `${w.title} ${w.folder?.name ?? ""} ${w.kind === "project" ? `${w.repo.owner}/${w.repo.name}` : ""}`.toLowerCase();
    return terms.every((t) => text.includes(t));
  }).toSorted((a, b) => b.updatedAt - a.updatedAt);
  return <div className="cd-search-results">
    <div className="cd-side-label"><span>{found.length ? `${found.length} found` : "Nothing found"}</span></div>
    <WorkspaceList list={found.slice(0, 50)} current={current} now={now} />
  </div>;
}

/** Puts a chat in a project, or takes it out: a chip in its header. */
function FolderChip({ workspace, projects }: { workspace: Workspace; projects: Project[] }) {
  const options = [{ value: "", label: "No project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))];
  if (!projects.length) return null;
  return <Choice compact aria-label="Project" className="cd-folderchip" value={workspace.folder?.id ?? ""}
    onChange={(next) => { void code.moveChat(workspace.id, next || null).then(() => window.dispatchEvent(new Event("kimono-ai-reload"))); }}
    options={options} />;
}

function WorkspaceList({ label, list, current, now, onNew }: { label?: string; list: Workspace[]; current: string | null; now: number; onNew?: () => void }) {
  if (!list.length) return null;
  return <div className="cd-project">
    {label ? <div className="cd-side-label cd-project-head"><span>{label}</span><small>{list.length}</small>{onNew ? <button type="button" className="cd-roundbutton cd-project-new" onClick={onNew} aria-label={`New chat in ${label}`} title={`New chat in ${label}`}><Icon name="plus" /></button> : null}</div> : null}
    <nav className="cd-list">{list.map((w) => <ChatRow key={w.id} w={w} current={current} now={now} />)}</nav>
  </div>;
}

/** A chat in the list: opens it; its ··· menu renames, archives or deletes it. */
function ChatRow({ w, current, now }: { w: Workspace; current: string | null; now: number }) {
  const typingHere = useContext(TypingContext)[w.id];
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  /* The share dialog, drawn outside the list so the list's own styles don't reach it. */
  const [sharing, setSharing] = useState<Element | null>(null);
  const [reporting, setReporting] = useState<Element | null>(null);
  const [busy, setBusy] = useState(false);
  const owns = !w.access || w.access === "owner";
  const state = w.turn?.state;
  const act = (run: () => Promise<unknown>, leaves = true) => {
    setBusy(true);
    run().then(() => {
      if (leaves && w.id === current) goTo({}, true);
      setBusy(false); setRenaming(null);
      window.dispatchEvent(new Event("kimono-ai-reload"));
    }, () => { setBusy(false); setConfirming(false); });
  };
  const saveName = () => {
    const name = renaming?.trim();
    if (!name || name === w.title) { setRenaming(null); return; }
    act(() => code.rename(w.id, name), false);
  };
  /* Renamed where it sits: the name becomes a field of the same size, the rest of the row stays as it was. */
  if (renaming !== null) return <form className={cx("cd-row", busy && "is-busy")} onSubmit={(event) => { event.preventDefault(); saveName(); }}>
    <div className="cd-row-open is-naming">
      <input className="cd-row-name" autoFocus value={renaming} maxLength={120} aria-label="Chat name" onFocus={(event) => event.target.select()}
        onChange={(event) => setRenaming(event.target.value)} onBlur={saveName} onKeyDown={(event) => { if (event.key === "Escape") setRenaming(null); }} />
      <small><span className="cd-when">{when(w.updatedAt, now)}</span></small>
    </div>
  </form>;
  return <div className={cx("cd-row", busy && "is-busy", confirming && "is-confirming")}>
    <button type="button" className="cd-row-open" aria-current={w.id === current ? "page" : undefined} onClick={() => goTo({ w: w.id })}
      draggable={owns && w.kind === "chat"} onDragStart={(event) => { event.dataTransfer.setData(chatDrag, w.id); event.dataTransfer.effectAllowed = "move"; }}>
      <b onDoubleClick={owns ? (event) => { event.preventDefault(); event.stopPropagation(); setRenaming(w.title); } : undefined}>{w.title}</b>
      <small>
        {/* A shared chat shows who else is in it. */}
        {w.people?.length ? <span className="cd-row-faces" title={w.people.join(", ")}>{w.people.slice(0, 3).map((who) => <Face key={who} username={who} size={18} />)}{w.people.length > 3 ? <span className="cd-row-more">+{w.people.length - 3}</span> : null}</span> : null}
        {/* One word, and only when it says something; someone typing in it says so first. */}
        {typingHere?.length ? <TypingWords names={typingHere} />
          : state === "running" ? <span className="cd-word running"><InkLoader ink={workingInk} label="Working" className="cd-working-ink" />working {elapsed(now - w.turn!.startedAt)}</span>
          : state === "failed" ? <span className="cd-word">stopped</span>
            : w.preview && !w.preview.stopped ? <span className="cd-word">live</span>
            : w.pullRequest ? <span className="cd-word">#{w.pullRequest.number}</span>
              : <span className="cd-when">{when(w.updatedAt, now)}</span>}
      </small>
    </button>
    {!owns ? null : confirming
      ? <span className="cd-row-confirm"><span>Delete?</span><button type="button" className="cd-quietbutton is-danger" onClick={() => act(() => code.remove(w.id))}>Delete</button><button type="button" className="cd-quietbutton" onClick={() => setConfirming(false)}>Keep</button></span>
      : <RowMenu label={`More for ${w.title}`} items={[
          { icon: "people", label: "Share", run: () => setSharing(document.querySelector(".cd") ?? document.body) },
          { icon: "rename", label: "Rename", run: () => setRenaming(w.title) },
          { icon: "archive", label: "Archive", run: () => act(() => code.archive(w.id, true)) },
          { icon: "flag", label: "Report", run: () => setReporting(document.querySelector(".cd") ?? document.body) },
          { icon: "trash", label: "Delete", danger: true, run: () => setConfirming(true) },
        ]} />}
    {sharing ? createPortal(<ShareChat workspace={w} onClose={() => setSharing(null)} />, sharing) : null}
    {reporting ? createPortal(<ReportChat workspace={w} onClose={() => setReporting(null)} />, reporting) : null}
  </div>;
}

type MenuItem = { icon: IconName; label: string; danger?: boolean; run: () => void };

/** A ··· button and its menu, drawn over everything so a scrolling list doesn't cut it off. */
function RowMenu({ label, items, className }: { label: string; items: MenuItem[]; className?: string }) {
  const [at, setAt] = useState<{ top: number; right: number; host: Element } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setAt(null); };
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape") { setAt(null); root.current?.querySelector("button")?.focus(); } };
    const close = () => setAt(null);
    /* Only a scroll that moves the button closes it, not one elsewhere on the page. */
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
    /* Below the button, or above it when there isn't room. */
    const below = box.bottom + 4 + items.length * 48 + 8 < window.innerHeight;
    setAt({ top: below ? box.bottom + 4 : box.top - 4 - (items.length * 48 + 8), right: document.documentElement.clientWidth - box.right, host: button.closest(".cd") ?? document.body });
  };
  const step = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const all = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const now = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(now + (event.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus({ preventScroll: true });
  };
  return <span ref={root} className={cx("cd-row-more", at && "is-open", className)}>
    <button type="button" aria-label={label} title="More" aria-haspopup="menu" aria-expanded={Boolean(at)}
      onClick={(event) => { event.stopPropagation(); if (at) setAt(null); else open(event.currentTarget); }}><Icon name="more" /></button>
    {at ? createPortal(<div ref={menu} className="cd-attach-menu cd-row-menu" role="menu" aria-label={label} style={{ top: at.top, right: at.right }} onKeyDown={step}>
      {items.map((item) => <button key={item.label} type="button" role="menuitem" className={cx(item.danger && "is-danger")}
        onClick={(event) => { event.stopPropagation(); setAt(null); item.run(); }}><Icon name={item.icon} />{item.label}</button>)}
    </div>, at.host) : null}
  </span>;
}

/** Chats and artifacts others shared with this person: each with whose it is. An artifact opens on its own page. */
function SharedWithYou({ chats: allChats, artifacts: allArtifacts, current, now }: { chats: Workspace[]; artifacts: SharedArtifact[]; current: string | null; now: number }) {
  const [all, setAll] = useState(false);
  if (!allChats.length && !allArtifacts.length) return null;
  /* Like Recent, the newest few; the rest a tap away. */
  const cap = 5, total = allChats.length + allArtifacts.length;
  const chats = all ? allChats : allChats.slice(0, cap), artifacts = all ? allArtifacts : allArtifacts.slice(0, Math.max(0, cap - chats.length));
  return <div className="cd-project cd-shared">
    <div className="cd-side-label cd-folders-head"><span>Shared with you</span></div>
    <nav className="cd-list">
      {chats.map((w) => <button type="button" key={w.id} aria-current={w.id === current ? "page" : undefined} onClick={() => goTo({ w: w.id })}>
        <b>{w.title}</b>
        <small><SharedBy username={w.owner ?? ""} />{w.turn?.state === "running" ? <span className="cd-word running">working</span> : <span className="cd-when">{when(w.updatedAt, now)}</span>}</small>
      </button>)}
      {artifacts.map((a) => <button type="button" key={a.token} onClick={() => openOutside(`/ai/a/${a.token}`)}>
        <b><Icon name="spark" />{a.title}</b>
        <small><SharedBy username={a.owner} /><span className="cd-when">{when(a.updatedAt, now)}</span></small>
      </button>)}
    </nav>
    {total > cap ? <button type="button" className="cd-textbutton cd-folder-more" onClick={() => setAll(!all)}>{all ? "Fewer" : `··· ${total - cap} more`}</button> : null}
  </div>;
}

function SharedBy({ username, words = "" }: { username: string; words?: string }) {
  const person = usePerson(username);
  return <span className="cd-sharedby"><Face username={username} size={18} /><span>{words}{person.name}</span></span>;
}

/* ── what's typed and attached but not sent yet ── */

/*
 * Files waiting in a composer, per chat ("new" for one not started yet), kept outside the
 * composer so they're still there after you look at another chat and come back. An upload
 * that finishes meanwhile lands here too. Gone on a reload: a picked file can't be kept.
 */
const unsent = new Map<string, unknown>();
const unsentListeners = new Map<string, Set<() => void>>();

function useUnsent<T>(key: string, empty: T): [T, (next: T | ((previous: T) => T)) => void] {
  const subscribe = useCallback((listener: () => void) => {
    const set = unsentListeners.get(key) ?? new Set();
    set.add(listener);
    unsentListeners.set(key, set);
    return () => { set.delete(listener); };
  }, [key]);
  const value = useSyncExternalStore(subscribe, () => (unsent.has(key) ? unsent.get(key) : empty) as T, () => empty);
  const update = useCallback((next: T | ((previous: T) => T)) => {
    const previous = (unsent.has(key) ? unsent.get(key) : empty) as T;
    unsent.set(key, typeof next === "function" ? (next as (previous: T) => T)(previous) : next);
    for (const listener of unsentListeners.get(key) ?? []) listener();
  }, [key, empty]);
  return [value, update];
}

/** The text typed into a composer, kept for this tab (a reload keeps it too). */
function useUnsentText(key: string): [string, (text: string) => void] {
  const storageKey = `kimono-code-draft-${key}`;
  const [text, setText] = useUnsent<string | null>(`${key}:text`, null);
  const shown = text ?? (typeof window === "undefined" ? "" : (() => { try { return sessionStorage.getItem(storageKey) ?? ""; } catch { return ""; } })());
  const change = useCallback((next: string) => {
    setText(next);
    try { if (next) sessionStorage.setItem(storageKey, next); else sessionStorage.removeItem(storageKey); } catch { /* not kept */ }
  }, [setText, storageKey]);
  return [shown, change];
}

/** A photo or video picked on this device, shown from the device before it's sent. */
const localPreview = (file: File) => {
  const video = isVideo({ name: file.name, type: file.type });
  return { preview: isPicture(file.type) || video ? URL.createObjectURL(file) : null, video };
};
const forget = (previews: (string | null)[]) => { for (const url of previews) if (url?.startsWith("blob:")) URL.revokeObjectURL(url); };
const noHeld: Held[] = [];
const noPending: Pending[] = [];

/* ── a new task: which repository, which branch, and what to do ── */

/** A file chosen for a chat that doesn't exist yet: from this device, or a Drive file by its id. */
type Held = { id: string; name: string; size: number; preview: string | null; video?: boolean; file?: File; node?: string; failed?: string };

function Start({ blocked, admin, folder, repoAsked, onStarted }: { blocked: string | null; admin: boolean; folder: Project | null; repoAsked: string | null; onStarted: (w: Workspace) => Promise<void> }) {
  /* A new chat is just what you ask. Administrators can instead work on a project (a Kimono Git repository).
     Opened from a project's +, it's in that project; from a repository's +, on that repository. */
  const [onProject, setOnProject] = useState(() => { if (repoAsked) return admin; if (folder) return false; try { return admin && localStorage.getItem("kimono-ai-project") === "1"; } catch { return false; } });
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [repo, setRepo] = useState(repoAsked ?? "");
  const [fetched, setFetched] = useState<{ repo: string; list: string[] } | null>(null);
  const [picked, setPicked] = useState<{ repo: string; branch: string } | null>(null);
  const [prompt, setPrompt] = useUnsentText("new");
  const promptNow = useRef(prompt);
  promptNow.current = prompt;
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const slash = useSlashMenu(prompt, setPrompt, field);
  /* Files for the first message: held here until the chat exists, then sent with it. */
  const [files, setFiles] = useUnsent<Held[]>("new:files", noHeld);
  const [choosing, setChoosing] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const marks = useContext(MarksContext);
  const hasDrive = marks.spaces.size > 0;
  /* Drive is known from the start; its spaces arrive later, and an early click shouldn't skip the menu. */
  const drivePresent = marks.drive !== null;
  const hold = (picked: File[]) => setFiles((list) => [...list, ...picked.map((file): Held => ({ id: crypto.randomUUID(), name: file.name, size: file.size, file, ...localPreview(file), failed: file.size > 20 * 1024 * 1024 ? "Over 20 MB" : undefined }))].slice(0, 10));
  useFileDrop(blocked ? null : { label: "Drop to attach", onDrop: (data) => hold(filesIn(data)) });
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
      const first = list.find((r) => `${r.owner}/${r.name}` === repoAsked) ?? list.find((r) => `${r.owner}/${r.name}` === remembered) ?? list[0];
      if (first) setRepo(`${first.owner}/${first.name}`);
    }, (error) => setProblem(problemText(error)));
  }, [blocked, onProject, repoAsked]);

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

  /* Ready to type on a computer; on a phone the keyboard waits for a tap, so it doesn't cover the screen on arrival. */
  useEffect(() => { if (!onTouch()) field.current?.focus(); }, [repos]);
  /* The field grows with what's written, up to a third of the screen, as the chat's does. */
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    const max = window.innerHeight / 3;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [prompt]);
  const ready = Boolean(prompt.trim()) && (!onProject || Boolean(chosen)) && !sending;

  async function send() {
    if (!ready) return;
    setSending(true);
    setProblem(null);
    try {
      const toSend = files.filter((f) => !f.failed);
      const made = await code.start({ ...(chosen
        ? { owner: chosen.owner, name: chosen.name, base: base || chosen.defaultBranch, prompt, effort: effortNow() }
        : { prompt, effort: effortNow(), ...(folder ? { folder: folder.id } : {}) }), hold: toSend.length > 0 });
      if (toSend.length) {
        /* The chat exists now: its files go to it, then the message, as any turn would. */
        const uploads = await Promise.all(toSend.filter((f) => f.file).map((f) => code.attach(made.id, f.file!).catch(() => null)));
        const nodes = toSend.filter((f) => f.node).map((f) => f.node!);
        const copied = nodes.length ? await code.fromDrive(made.id, nodes).catch(() => [] as Attachment[]) : [];
        await code.ask(made.id, prompt, [...uploads.filter((a): a is Attachment => a !== null), ...copied], effortNow());
      }
      /* Sent: the next new chat starts empty. */
      forget(files.map((f) => f.preview));
      setFiles([]);
      setPrompt("");
      await onStarted(made);
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
        <Seal type="button" onClick={() => void makeProject()} busy={making} disabled={!naming?.trim()}>Make project</Seal>
        {repos?.length ? <Seal type="button" tone="quiet" onClick={() => setNaming(null)}>Cancel</Seal> : null}
      </div> : <div className="cd-new-pickers">
        <Picker label="Project" placeholder={repos ? "None yet" : "Loading…"} value={repo} onChange={setRepo} disabled={!repos}
          action={{ label: "New project", onAction: () => setNaming("") }}
          options={(repos ?? []).map((r) => ({ value: `${r.owner}/${r.name}`, label: r.name, detail: r.description || r.owner, note: r.owner }))} />
        <Picker label="Starting from" value={base} onChange={setBase} disabled={!chosen} mono
          options={branches.map((b) => ({ value: b, label: b, detail: b === chosen?.defaultBranch ? "The main version" : undefined }))} />
      </div> : null}
      <div className="cd-hello-box">
        {files.length ? <div className="cd-pending">{files.map((f) => f.preview
          ? <PendingMedia key={f.id} name={f.name} url={f.preview} video={f.video} failed={f.failed} onRemove={() => { forget([f.preview]); setFiles((list) => list.filter((x) => x.id !== f.id)); }} />
          : <span key={f.id} className={cx("cd-filechip", f.failed && "is-failed")}>
          <FileThumb name={f.name} size={30} />
          <span>{f.name}</span>
          <small>{f.failed ?? readableSize(f.size)}</small>
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => { forget([f.preview]); setFiles((list) => list.filter((x) => x.id !== f.id)); }}><Icon name="close" /></button>
        </span>)}</div> : null}
        <div className="cd-entry">
          <input ref={picker} type="file" multiple hidden onChange={(event) => { hold([...(event.target.files ?? [])]); event.target.value = ""; }} />
          <AttachMenu disabled={Boolean(blocked)} onDevice={() => picker.current?.click()} onDrive={drivePresent ? () => setChoosing(true) : undefined} />
          {slash.menu}
          {slash.wrap(<textarea ref={field} value={prompt} rows={1} aria-label="Message" maxLength={maxMessage} disabled={Boolean(blocked)} placeholder={onProject ? "Describe what you want, in your own words." : "Ask anything, or tell it what to do with your files."}
            onChange={(event) => setPrompt(event.target.value)} onScroll={slash.follow}
            onPaste={(event) => { const pasted = [...event.clipboardData.files]; if (pasted.length) { event.preventDefault(); hold(pasted); } }}
            onKeyDown={(event) => { if (slash.onKeyDown(event)) return; if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />)}
          <div className="cd-entry-end">
            <MessageCount length={prompt.length} />
            <Dictation disabled={Boolean(blocked) || sending} onProblem={setProblem} onText={(said) => { setPrompt(joinSaid(promptNow.current, said)); requestAnimationFrame(() => field.current?.focus()); }} />
            <SendStop mode="send" busy={sending} disabled={!ready || Boolean(blocked)} onSend={() => void send()} />
          </div>
        </div>
      </div>
      <div className="cd-hello-tools">
        {admin && !blocked ? <button type="button" className={cx("cd-chip", onProject && "is-on")} aria-pressed={onProject} onClick={() => project(!onProject)}><Icon name="code" />Build a website</button> : null}
        {folder && !onProject ? <span className="cd-chip is-on cd-in-chip"><Icon name="folder" />{folder.name}<button type="button" aria-label={`Not in ${folder.name}`} title="Not in a project" onClick={() => goTo({ new: "1" })}><Icon name="close" /></button></span> : null}
        <span className="cd-grow" />
        <span className="cd-tuning">{hasDrive ? <AccessPicker /> : null}<ModelPicker /><EffortPicker /></span>
      </div>
      {choosing ? <DrivePicker onClose={() => setChoosing(false)} onPick={(items) => { setChoosing(false); setFiles((list) => [...list, ...items.map((item): Held => ({ id: crypto.randomUUID(), name: item.name, size: item.size, node: item.id, preview: null }))].slice(0, 10)); }} /> : null}
      {blocked ? <p className="cd-hello-note">{blocked}</p> : null}
    </>
    {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
    {blocked ? null : <HomeUsage />}
    {blocked || onProject ? null : <SuggestedApps />}
  </section>;
}

/** The person's own use, under the new-chat box: the 5-hour window and the week, as Meters shows them. */
function HomeUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => { let live = true; code.usage().then((u) => { if (live) setUsage(u); }, () => {}); return () => { live = false; }; }, []);
  if (!usage?.reported) return null;
  const share = (w: Usage["week"]) => w.used / w.share;
  const whose = usage.unlimited ? "of the plan" : "of your share";
  const rows: { label: string; value: number; resets: number | null }[] = [
    ...(usage.fiveHourLimited === false ? [] : [{ label: "5-hour window", value: share(usage.fiveHour), resets: usage.fiveHour.resetsAt }]),
    { label: "This week", value: share(usage.week), resets: usage.week.resetsAt },
  ];
  return <div className="cd-home-usage" aria-label="Your usage">
    {rows.map((r) => <div key={r.label} className="cd-meter">
      <Ring value={r.value} label={`${pct(r.value)} ${whose}`} />
      <span><b>{r.label}</b><small>{pct(r.value)} {whose}{r.resets ? ` · resets ${resetWords(r.resets)}` : ""}</small></span>
    </div>)}
  </div>;
}

/** A few apps the person hasn't connected yet, each opening its page in Connections. */
function SuggestedApps() {
  const [apps, setApps] = useState<ConnectableApp[] | null>(null);
  useEffect(() => { let live = true; code.findApps("").then(({ apps: list }) => { if (live) setApps(list.filter((a) => !a.connected && realApp(a)).slice(0, 6)); }, () => { if (live) setApps([]); }); return () => { live = false; }; }, []);
  if (!apps?.length) return null;
  return <div className="cd-home-apps">
    <div className="cd-home-apps-head"><h3>Connect your apps</h3><button type="button" className="cd-textbutton" onClick={() => goTo({ connections: "1" })}>All apps</button></div>
    <ul>{apps.map((a) => <li key={a.app}><button type="button" onClick={() => openApp(a.app)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the app's own logo, as Composio serves it */}
      <InkBlot className="cd-conn-logo" tint={inkTint.quiet} seed={a.app}><img src={a.logo} alt="" /></InkBlot>
      <span className="cd-conn-id"><b>{a.name}</b>{a.description ? <small>{a.description}</small> : null}</span>
    </button></li>)}</ul>
  </div>;
}

/* ── a workspace ── */

/** A thumbed or reported chat, as it was kept: the same conversation and its artifacts, nothing after. */
export function KeptChat({ title, at, chat }: { title: string; at: number; chat: KeptAnswer[] }) {
  const events = useMemo(() => keptEvents(chat, at), [chat, at]);
  const workspace = useMemo(() => ({ id: "kept", title, kind: "chat", owner: "" }) as unknown as Workspace, [title]);
  const viewer = useMemo<Viewer>(() => ({ me: null, guest: false, peek: true, people: new Map() }), []);
  const marks = useMemo<Marks>(() => ({ drive: null, spaces: new Map() }), []);
  const access = useMemo(() => ({ access: "read" as Access, owner: "" }), []);
  const [beside, setBeside] = useState<string | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const pages = useMemo(() => Object.fromEntries(chat.flatMap((a) => a.steps.flatMap((step) => step.artifact && step.page ? [[step.artifact, step.page] as const] : []))), [chat]);
  const artifacts = useMemo<ArtifactsShared>(() => ({ workspaceId: "kept", drafts: {}, versions: {}, beside, setBeside, setFull, kept: pages }), [beside, pages]);
  return <ViewerContext.Provider value={viewer}><MarksContext.Provider value={marks}><ChatAccess.Provider value={access}><ArtifactsContext.Provider value={artifacts}><div className="cd-page">
    <div className="cd cd-guest cd-peek has-workspace">
      <main className="cd-main"><div className={cx("cd-ws-grid", "is-chat", beside && "has-beside")}><div className="cd-sheet cd-ws">
        <header className="cd-ws-head"><div className="cd-ws-id"><h1 title={title}>{title}</h1></div></header>
        <Chat workspace={workspace} events={events} drafts={noDrafts} running={false} blocked={null} />
      </div>
      {beside ? <aside className="cd-beside" aria-label="Artifact"><ArtifactCard name={beside} mode="beside" /></aside> : null}
      {full ? <div className="cd-artifact-full" role="dialog" aria-modal="true" aria-label="Artifact"><ArtifactCard name={full} mode="full" /></div> : null}
      </div></main>
    </div>
  </div></ArtifactsContext.Provider></ChatAccess.Provider></MarksContext.Provider></ViewerContext.Provider>;
}

/** A kept turn (lib/code/feedback.ts) back as the events it came from, near enough for the chat to draw. */
function keptEvents(chat: KeptAnswer[], at: number): StoredEvent[] {
  const out: StoredEvent[] = [];
  const push = (event: CodeEvent) => out.push({ seq: out.length + 1, turn: null, at, event });
  const file = (name: string): Attachment => ({ name, path: "", size: 0, type: "" });
  chat.forEach((answer, n) => {
    /* the files themselves where the bank kept them, else their names alone */
    push({ kind: "ask", by: "", text: answer.asked, attachments: answer.attached ?? answer.attachments.map(file) });
    answer.steps.forEach((step, i) => {
      if (step.said !== undefined) push({ kind: "text", text: step.said });
      else if (step.tool) {
        const id = `kept-${n}-${i}`;
        push({ kind: "tool", id, name: step.tool, label: step.tool, detail: step.detail });
        if (step.ok !== undefined || step.output) push({ kind: "tool-result", id, ok: step.ok !== false, output: step.output ?? "" });
      } else if (step.artifact) push({ kind: "artifact", id: `kept-${n}-${i}`, name: step.artifact, action: "wrote" });
      else if (step.sent) push({ kind: "sent", files: step.files ?? step.sent.map(file) });
    });
    push({ kind: "done", ok: answer.ok, ...(answer.error ? { error: answer.error } : {}), ...(answer.durationMs ? { durationMs: answer.durationMs } : {}), ...(answer.model ? { model: answer.model as "opus" } : {}) });
  });
  return out;
}

function WorkspaceView({ projects, workspace, others, tab: asked, path, blocked, onChange, now }: { projects: Project[]; workspace: Workspace; others: Workspace[]; tab: Tab; path: string; blocked: string | null; onChange: () => void; now: number }) {
  const { events, connected, drafts, typing } = useTimeline(workspace.id, onChange);
  const { me } = useContext(ViewerContext);
  const othersTyping = useMemo(() => typing.filter((who) => who !== me?.toLowerCase()), [typing, me]);
  /* Artifacts: the latest saved version of each, and where a big one is open (beside the chat, or full screen). */
  const versions = useMemo(() => {
    const found: Record<string, { version: number; title: string }> = {};
    for (const { event } of events) if (event.kind === "artifact-saved") found[event.name] = { version: event.version, title: event.title };
    return found;
  }, [events]);
  const [beside, setBeside] = useState<string | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const artifacts = useMemo<ArtifactsShared>(() => ({ workspaceId: workspace.id, drafts: drafts.artifacts, versions, beside, setBeside, setFull }), [workspace.id, drafts.artifacts, versions, beside]);
  /* A chat is a conversation and nothing else. Files, changes and the app (and repositories,
     branches, pull requests) belong to a chat that is building something: a project, or one with an app. */
  const project = workspace.kind === "project";
  const access: Access = workspace.access ?? "owner";
  const owns = access === "owner";
  const { guest, peek } = useContext(ViewerContext);
  const chatAccess = useMemo(() => ({ access, owner: workspace.owner ?? "" }), [access, workspace.owner]);
  const [sharing, setSharing] = useState(false);
  /* A guest has the conversation only: files, changes and the app's controls are for people signed in. */
  const isApp = !guest && (project || Boolean(workspace.preview));
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


  const crossTo = useCrossTo();
  /* As on the phone: the title and repo, the few things you reach for (the running app, the
     pull request, Drive, delete) as quiet links and icons, one strong seal to publish, then the tabs. */
  return <ChatAccess.Provider value={chatAccess}><ArtifactsContext.Provider value={artifacts}><div className={cx("cd-ws-grid", !isApp && "is-chat", tab === "chat" && beside && "has-beside")}>
    <div className="cd-sheet cd-ws">
      <header className="cd-ws-head">
        {guest || peek ? null : <>
          <button type="button" className="cd-roundbutton cd-back" onClick={() => goTo({})} aria-label="All chats" title="All chats"><Icon name="back" /></button>
          <button type="button" className="cd-roundbutton cd-unfold" onClick={() => setFolded(false)} aria-label="Show chats" title="Show chats"><Icon name="panel" /></button>
        </>}
        <div className="cd-ws-id">
          <ChatTitle workspace={workspace} onRenamed={onChange} />
          {!owns && !peek && workspace.owner ? <p className="cd-ws-shared"><SharedBy username={workspace.owner} words="Shared by " /></p> : null}
          {project && owns ? <p className="cd-mono">{repoName(workspace)} · {workspace.branch}</p> : null}
          {/* Working shows once, at the end of the conversation; here only a lost connection. */}
          {!isApp && !connected ? <span className="cd-status" role="status">Reconnecting…</span> : null}
        </div>
        {!owns
          ? workspace.preview && !workspace.preview.stopped ? <div className="cd-ws-acts"><button type="button" className="cd-linkbutton" onClick={() => openOutside(workspace.preview!.url)}><Icon name="open" />Open app</button></div> : null
          : !project ? <div className="cd-ws-acts">
              <ShareButton onClick={() => setSharing(true)} />
              <FolderChip workspace={workspace} projects={projects} />
              {workspace.preview && !workspace.preview.stopped ? <button type="button" className="cd-linkbutton" onClick={() => openOutside(workspace.preview!.url)}><Icon name="open" />Open app</button> : null}
              {workspace.drive ? <button type="button" className="cd-roundbutton" aria-label="Open in Drive" title="Open in Drive" onClick={() => crossTo("kakejiku", `/drive?space=${workspace.drive!.spaceId}&folder=${workspace.drive!.folderId}`)}><Icon name="folder" /></button> : null}
            </div>
          : <div className="cd-ws-acts">
              <ShareButton onClick={() => setSharing(true)} />
              {workspace.preview && !workspace.preview.stopped ? <button type="button" className="cd-linkbutton" onClick={() => openOutside(workspace.preview!.url)}><Icon name="open" />Open app</button> : null}
              {workspace.pullRequest ? <button type="button" className="cd-linkbutton" onClick={() => openOutside(workspace.pullRequest!.url)}><Icon name="pr" />Pull request #{workspace.pullRequest.number}</button> : null}
              <button type="button" className="cd-roundbutton" aria-label="Open in Kimono Git" title="Open in Kimono Git" onClick={() => openOutside(`/api/v1/code/workspaces/${workspace.id}/git`)}><Icon name="branch" /></button>
              {workspace.drive ? <button type="button" className="cd-roundbutton" aria-label="Open in Drive" title="Open in Drive" onClick={() => crossTo("kakejiku", `/drive?space=${workspace.drive!.spaceId}&folder=${workspace.drive!.folderId}`)}><Icon name="folder" /></button> : null}
              <Seal type="button" compact tone={workspace.pullRequest ? "quiet" : "primary"} busy={publishing} disabled={running || Boolean(blocked)} onClick={() => void publish()}>
                {workspace.pullRequest ? "Push changes" : "Open pull request"}
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
      {tab === "chat" ? <Chat workspace={workspace} events={events} drafts={drafts} running={running} blocked={blocked} typing={othersTyping} />
        : tab === "files" ? <Files workspace={workspace} path={path} onOpen={(path) => go({ tab: "files", path })} />
          : tab === "app" ? <AppView workspace={workspace} running={running} blocked={blocked} onChange={onChange} />
            : <ChangesView workspace={workspace} running={running} lastSeq={events.at(-1)?.seq ?? 0} />}
    </div>
    {tab === "chat" && beside ? <aside className="cd-beside" aria-label="Artifact"><ArtifactCard name={beside} mode="beside" /></aside>
      : isApp ? <Scroller fit as="aside" className="cd-deploy" viewClassName="cd-deploy-view" aria-label="This chat's work"><SidePanel workspace={workspace} others={others} tab={tab} running={running} lastSeq={events.at(-1)?.seq ?? 0} /></Scroller> : null}
    {full ? <div className="cd-artifact-full" role="dialog" aria-modal="true" aria-label="Artifact"><ArtifactCard name={full} mode="full" /></div> : null}
    {sharing ? <ShareChat workspace={workspace} onClose={() => setSharing(false)} /> : null}
  </div></ArtifactsContext.Provider></ChatAccess.Provider>;
}

/**
 * On a wide window, beside the conversation: what the chat is making. Its app, live and
 * usable (unless the App tab already shows it), a project's pull request and changes as
 * they happen, and the other chats' running apps.
 */
function SidePanel({ workspace, others, tab, running, lastSeq }: { workspace: Workspace; others: Workspace[]; tab: Tab; running: boolean; lastSeq: number }) {
  const project = workspace.kind === "project";
  const preview = workspace.preview;
  return <div className="cd-deployments cd-side-panel">
    {preview && !preview.stopped && tab !== "app" ? <SideApp workspace={workspace} url={preview.url} /> : null}
    {preview?.stopped ? <button type="button" className="cd-dep-row is-link" onClick={() => goTo({ w: workspace.id, tab: "app" })}><InkBlot className="cd-dep-icon" tint={inkTint.quiet} seed="app"><Icon name="rocket" /></InkBlot><span><b>The app is stopped</b><small>Start it again from the App tab.</small></span></button> : null}
    {project ? <SideWork workspace={workspace} running={running} lastSeq={lastSeq} /> : null}
    {!preview && !project ? <div className="cd-dep-row"><InkBlot className="cd-dep-icon" tint={inkTint.quiet} seed="app"><Icon name="rocket" /></InkBlot><span><b>No app running</b><small>Ask it to run one and it appears here.</small></span></div> : null}
    {others.length ? <section className="cd-side-sec">
      <h2>Other running apps</h2>
      <div className="cd-dep-list">{others.map((w) => <button type="button" key={w.id} className="cd-dep-row is-link" onClick={() => goTo({ w: w.id })}>
        <InkBlot className="cd-dep-icon is-live" tint={inkTint.live} seed="app"><Icon name="rocket" /></InkBlot>
        <span><b>{w.title}</b><small className="cd-mono">{w.preview!.url.replace(/^https?:\/\//, "")}</small></span>
      </button>)}</div>
    </section> : null}
  </div>;
}

/** The chat's app, at phone width, to use right there; its link and what you do to it underneath. */
function SideApp({ workspace, url }: { workspace: Workspace; url: string }) {
  const owns = useOwns();
  const [copied, setCopied] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  return <section className="cd-side-sec">
    <h2><i className="cd-live-dot" aria-hidden="true" />Your app</h2>
    <div className="cd-side-app">
      <div className="cd-app-bar"><i /><i /><i /><span className="cd-mono">{url.replace(/^https?:\/\//, "")}</span>
        <button type="button" className="cd-roundbutton" aria-label="Reload" title="Reload" onClick={() => setRound((n) => n + 1)}><Icon name="restart" /></button>
      </div>
      <iframe key={round} src={url} title="The running app" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
    </div>
    <div className="cd-side-acts">
      <Seal type="button" compact onClick={() => openOutside(url)}><Icon name="open" />Open</Seal>
      <button type="button" className="cd-quietbutton" onClick={() => { void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Copied" : "Copy link"}</button>
      {owns ? <button type="button" className="cd-quietbutton" disabled={stopping} aria-busy={stopping || undefined} onClick={() => { setStopping(true); code.stopPreview(workspace.id).catch((error) => { setProblem(problemText(error)); setStopping(false); }); }}><BusyFace busy={stopping}>Take down</BusyFace></button> : null}
    </div>
    {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
  </section>;
}

/** A project's pull request and its changes so far, kept up as it works. */
function SideWork({ workspace, running, lastSeq }: { workspace: Workspace; running: boolean; lastSeq: number }) {
  const [changes, setChanges] = useState<Changes | null>(null);
  const [failed, setFailed] = useState(false);
  /* Looked at when the chat opens and as each step lands, not more often than every few seconds. */
  useEffect(() => {
    const timer = setTimeout(() => { code.changes(workspace.id).then((c) => { setChanges(c); setFailed(false); }, () => setFailed(true)); }, changes ? 3000 : 0);
    return () => clearTimeout(timer);
  }, [workspace.id, lastSeq, running]); // eslint-disable-line react-hooks/exhaustive-deps
  const added = changes?.files.reduce((n, f) => n + f.additions, 0) ?? 0;
  const removed = changes?.files.reduce((n, f) => n + f.deletions, 0) ?? 0;
  const letter = { added: "A", modified: "M", deleted: "D", renamed: "R" } as const;
  const pr = workspace.pullRequest;
  return <>
    <section className="cd-side-sec">
      <h2>Pull request</h2>
      {pr
        ? <button type="button" className="cd-dep-row is-link" onClick={() => openOutside(pr.url)}><InkBlot className="cd-dep-icon is-live" tint={inkTint.live} seed="pr"><Icon name="pr" /></InkBlot><span><b>#{pr.number} is open</b><small className="cd-mono">{workspace.branch} → {workspace.base}</small></span><Icon name="open" /></button>
        : <div className="cd-dep-row"><InkBlot className="cd-dep-icon" tint={inkTint.quiet} seed="pr"><Icon name="pr" /></InkBlot><span><b>Not opened yet</b><small className="cd-mono">{workspace.branch} → {workspace.base}</small></span></div>}
    </section>
    <section className="cd-side-sec">
      <h2>Changes{changes?.files.length ? <span className="cd-side-count cd-mono"><b className="is-add">+{added}</b> <b className="is-del">−{removed}</b></span> : null}</h2>
      {changes === null ? failed ? <p className="cd-quiet cd-side-none">Couldn&rsquo;t look at the changes right now.</p> : <SkeletonRows rows={3} mark={false} />
        : !changes.files.length ? <p className="cd-quiet cd-side-none">Nothing changed yet.</p>
        : <div className="cd-side-files">
            {changes.files.slice(0, 12).map((file) => <button key={file.path} type="button" className="cd-side-file" title={file.path} onClick={() => goTo({ w: workspace.id, tab: "changes" })}>
              <span className="cd-status-letter" title={file.status}>{letter[file.status]}</span>
              <span className="cd-mono cd-side-path"><span>{file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : ""}</span><b>{file.path.split("/").pop()}</b></span>
              <span className="cd-mono cd-counts"><i className="is-add">+{file.additions}</i> <i className="is-del">−{file.deletions}</i></span>
            </button>)}
            {changes.files.length > 12 ? <button type="button" className="cd-textbutton cd-side-more" onClick={() => goTo({ w: workspace.id, tab: "changes" })}>{changes.files.length - 12} more</button> : null}
          </div>}
    </section>
  </>;
}

/** The App tab: the running app, big, with everything you do to it, and the app itself below. */
function AppView({ workspace, running, blocked, onChange }: { workspace: Workspace; running: boolean; blocked: string | null; onChange: () => void }) {
  const owns = useOwns();
  const writes = useContext(ChatAccess).access !== "read";
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!workspace.preview) return <Scroller className="cd-scroll" viewClassName="cd-appview">
    <div className="cd-app-empty">
      <InkBlot className="cd-dep-icon" tint={inkTint.quiet} seed="app"><Icon name="rocket" /></InkBlot>
      <b>Nothing is running</b>
      <p className="cd-faint">It runs the app when it changes something you can see. You can ask it to now.</p>
      {writes ? <Seal type="button" busy={asking} disabled={Boolean(blocked)} onClick={() => { setAsking(true); setProblem(null); code.ask(workspace.id, "Run the app and show it to me.", [], effortNow()).then(() => goTo({ w: workspace.id }), (error) => { setProblem(problemText(error)); setAsking(false); }); }}>{running ? "Run it after this step" : "Run the app"}</Seal> : null}
      {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
    </div>
    <SandboxLimits workspace={workspace} />
  </Scroller>;
  return <Scroller className="cd-scroll" viewClassName="cd-appview">
    {workspace.preview.stopped ? null : <AppReady workspace={workspace} url={workspace.preview.url} />}
    <AppRunning key={workspace.id} workspace={workspace} onChange={onChange} />
    <SandboxLimits workspace={workspace} />
    {owns ? <LinkName key={workspace.preview.url} workspace={workspace} url={workspace.preview.url} onRenamed={onChange} /> : null}
    {workspace.preview.stopped ? null : <div className="cd-app-frame">
      <div className="cd-app-bar"><i /><i /><i /><span className="cd-mono">{workspace.preview.url.replace(/^https?:\/\//, "")}</span></div>
      <iframe src={workspace.preview.url} title="The running app" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
    </div>}
  </Scroller>;
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
    {full ? <em>Full. Ask it to free some space; a little past this, work stops.</em> : null}
  </p>;
}

const healthWords: Record<AppHealth["state"], string> = {
  running: "Running", starting: "Starting", crashed: "Crashing", stopped: "Stopped", asleep: "Asleep", down: "Not answering",
};

/** How the app is doing, what it printed last, and starting or stopping it. Looked at every few seconds while the tab is open. */
function AppRunning({ workspace, onChange }: { workspace: Workspace; onChange: () => void }) {
  const owns = useOwns();
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
      {owns ? <div className="cd-run-acts">
        {stopped
          ? <Seal type="button" compact disabled={Boolean(acting)} onClick={() => void act("restart")}><Icon name="play" />Start</Seal>
          : <>
              <button type="button" className="cd-quietbutton" disabled={Boolean(acting)} onClick={() => void act("restart")}><Icon name="restart" />Restart</button>
              <button type="button" className="cd-quietbutton" disabled={Boolean(acting)} onClick={() => void act("stop")}><Icon name="stop" />Stop</button>
            </>}
      </div> : null}
    </div>
    {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
    <Scroller fit as="pre" tone="lift" viewRef={log} viewClassName="cd-run-log" aria-label="What the app printed" tabIndex={0}>{status ? status.log.trimEnd() || "Nothing printed yet." : " "}</Scroller>
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
    <Seal type="submit" compact busy={saving} disabled={!clean || clean === label}>Rename</Seal>
    {problem ? <p className="cd-problem" role="alert">{problem}</p>
      : <p className="cd-faint">The old link stops working. A name of your own is easier to share, and easier to guess: anyone with the link can open the app.</p>}
  </form>;
}

/** The app, ready: one big card to open it, copy its link or take it down. */
function AppReady({ workspace, url }: { workspace: Workspace; url: string }) {
  const owns = useOwns();
  const [copied, setCopied] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return <InkCard colour="#5c7150" seed={`ready-${workspace.id}`} className="cd-ready-ink"><div className="cd-ready">
    <span className="cd-ready-mark" aria-hidden="true"><Icon name="open" /></span>
    <span className="cd-ready-text"><b>Your app is ready</b>{workspace.preview?.kind ? <small>{workspace.preview.kind}</small> : null}<span className="cd-mono">{url.replace(/^https?:\/\//, "")}</span></span>
    <div className="cd-ready-acts">
      <Seal type="button" className="cd-ready-open" onClick={() => openOutside(url)}><Icon name="open" />Open app</Seal>
      <button type="button" className="cd-quietbutton" onClick={() => { void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => setProblem("Couldn't copy. Select the address above.")); }}>{copied ? "Copied" : "Copy link"}</button>
      {owns ? <button type="button" className="cd-quietbutton" disabled={stopping} aria-busy={stopping || undefined} onClick={() => { setStopping(true); code.stopPreview(workspace.id).catch((error) => { setProblem(problemText(error)); setStopping(false); }); }}><BusyFace busy={stopping}>Take down</BusyFace></button> : null}
    </div>
    {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
  </div></InkCard>;
}

/* ── chat ── */

type Tool = Extract<CodeEvent, { kind: "tool" }> & { result?: Extract<CodeEvent, { kind: "tool-result" }>; /** A Pro Tool's price, once Composio said. */ cost?: number; /** For a card's start: how its job stands, as Kimono last read it from the sandbox. */ probe?: Extract<CodeEvent, { kind: "progress" }> };
type Item =
  | { type: "ask"; seq: number; at: number; event: Extract<CodeEvent, { kind: "ask" }>; /** sent while it worked and never read: it was stopped first */ dropped?: boolean }
  | { type: "text"; seq: number; text: string }
  | { type: "tools"; seq: number; tools: Tool[]; open: boolean }
  | { type: "done"; seq: number; at: number; event: Extract<CodeEvent, { kind: "done" }>; /** what it said this turn, to copy */ answer: string }
  | { type: "published"; seq: number; event: Extract<CodeEvent, { kind: "published" }> }
  | { type: "shots"; seq: number; shots: { name: string; caption?: string }[] }
  | { type: "preview"; seq: number; event: Extract<CodeEvent, { kind: "preview" }> }
  | { type: "preview-stopped"; seq: number }
  | { type: "slept"; seq: number; for: string }
  | { type: "disk"; seq: number; event: Extract<CodeEvent, { kind: "disk" }> }
  | { type: "compacted"; seq: number; before?: number }
  | { type: "remembered"; seq: number; text: string; how?: "changed" | "forgot" }
  | { type: "artifact"; seq: number; id: string; name: string; action: "wrote" | "edited" | "shown" }
  | { type: "connect"; seq: number; app: string; url: string }
  | { type: "sent"; seq: number; files: Attachment[] }
  | { type: "access"; seq: number; event: Extract<CodeEvent, { kind: "access" }>; answer?: Extract<CodeEvent, { kind: "access-answer" }> };

/** Events as the reader sees them: consecutive tool calls fold into one group, each call paired with its result. */
function itemsOf(events: StoredEvent[]): Item[] {
  const items: Item[] = [];
  const tools = new Map<string, Tool>();
  const answers = new Map<string, Extract<CodeEvent, { kind: "access-answer" }>>();
  let said: string[] = [];
  for (const { event } of events) if (event.kind === "access-answer") answers.set(event.id, event);
  for (const { seq, at, event } of events) {
    const last = items.at(-1);
    switch (event.kind) {
      case "ask": items.push({ type: "ask", seq, at, event }); said = []; break;
      /* sent while it worked: read now, so no longer waiting; or never read, because it was stopped */
      case "steered": case "dropped": for (const item of items) if (item.type === "ask" && event.seqs.includes(item.seq)) {
        if (event.kind === "steered") item.event = { ...item.event, queued: false };
        else item.dropped = true;
      } break;
      case "text": items.push({ type: "text", seq, text: event.text }); said.push(event.text); break;
      case "tool": {
        const tool: Tool = { ...event };
        tools.set(event.id, tool);
        if (last?.type === "tools") last.tools.push(tool); else items.push({ type: "tools", seq, tools: [tool], open: false });
        break;
      }
      case "tool-result": { const tool = tools.get(event.id); if (tool) tool.result = event; break; }
      case "tool-cost": { const tool = tools.get(event.id); if (tool) tool.cost = (tool.cost ?? 0) + event.usd; break; }
      case "progress": { const tool = tools.get(event.id); if (tool) tool.probe = event; break; }
      case "done": items.push({ type: "done", seq, at, event, answer: said.join("\n\n") }); said = []; break;
      case "published": items.push({ type: "published", seq, event }); break;
      case "image": if (last?.type === "shots") last.shots.push(event); else items.push({ type: "shots", seq, shots: [event] }); break;
      case "preview": items.push({ type: "preview", seq, event }); break;
      case "preview-stopped": items.push({ type: "preview-stopped", seq }); break;
      case "slept": items.push({ type: "slept", seq, for: event.for }); break;
      case "disk": items.push({ type: "disk", seq, event }); break;
      case "compacted": items.push({ type: "compacted", seq, before: event.before }); break;
      case "access": items.push({ type: "access", seq, event, answer: answers.get(event.id) }); break;
      case "remembered": items.push({ type: "remembered", seq, text: event.text, how: event.how }); break;
      case "artifact": items.push({ type: "artifact", seq, id: event.id, name: event.name, action: event.action }); break;
      case "connect": items.push({ type: "connect", seq, app: event.app, url: event.url }); break;
      case "sent": items.push({ type: "sent", seq, files: event.files }); break;
    }
  }
  return items;
}

/* Memoised: the page around it ticks every second while a turn runs, and the chat needn't. */
const Chat = memo(function Chat({ workspace, events, drafts, running, blocked, typing = [] }: { workspace: Workspace; events: StoredEvent[]; drafts: Drafts; running: boolean; blocked: string | null; typing?: string[] }) {
  const { access } = useContext(ChatAccess);
  const { me } = useContext(ViewerContext);
  const owns = access === "owner";
  const keptPages = useContext(ArtifactsContext)?.kept;
  const items = useMemo(() => itemsOf(events), [events]);
  /* Your thumbs, kept with the chat they belong to so another chat's never show. */
  const [rated, setRated] = useState<{ chat: string; ratings: Record<number, 1 | -1> }>({ chat: "", ratings: {} });
  const ratings = rated.chat === workspace.id ? rated.ratings : {};
  useEffect(() => {
    let current = true;
    const chat = workspace.id;
    code.ratings(chat).then((next) => { if (current) setRated({ chat, ratings: next }); }, () => { /* read by its link, or not reachable: no thumbs shown as given */ });
    code.replies(chat).then((next) => { if (current) setThanked({ chat, replies: next }); }, () => {});
    return () => { current = false; };
  }, [workspace.id]);
  /* An administrator's thank-you for a thumb, shown under its answer. */
  const [thanked, setThanked] = useState<{ chat: string; replies: Record<number, { note: string; at: number }> }>({ chat: "", replies: {} });
  const replies = thanked.chat === workspace.id ? thanked.replies : {};
  const rateAnswer = (seq: number, rating: 1 | -1 | null, note?: string) => {
    const chat = workspace.id;
    setRated((now) => {
      const next = { ...(now.chat === chat ? now.ratings : {}) };
      if (rating === null) delete next[seq]; else next[seq] = rating;
      return { chat, ratings: next };
    });
    return code.rate(chat, seq, rating, note).then((next) => setRated({ chat, ratings: next }), (error) => {
      /* Not saved: show what the server has, not what was hoped. */
      code.ratings(chat).then((next) => setRated((now) => now.chat === chat ? { chat, ratings: next } : now), () => {});
      throw error;
    });
  };
  const asking = me ? askingFor(items, ratings) : null;
  /* An artifact still being written has no place in the timeline yet: it is drawn at the end until its call lands. */
  const placed = new Set(items.flatMap((i) => i.type === "artifact" ? [i.id] : []));
  const writing = Object.entries(drafts.artifacts).filter(([, d]) => !placed.has(d.id));
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  /* What was there when the chat opened just shows; from a moment later, whatever arrives rises into place. */
  const [live, setLive] = useState(false);
  const any = items.length > 0;
  /* Replies that land after this point are let out word by word; ones already there just show. */
  const lastSeq = items.at(-1)?.seq ?? 0;
  const [liveFrom, setLiveFrom] = useState(Number.MAX_SAFE_INTEGER);
  useEffect(() => { if (!any || live) return; const timer = setTimeout(() => { setLive(true); setLiveFrom(lastSeq); }, 500); return () => clearTimeout(timer); }, [any, live, lastSeq]);
  const [away, setAway] = useState(false);

  /* Follows the agent while you're at the bottom; leaves you alone once you scroll up. */
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items, drafts]);
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
    <Scroller className="cd-scroll" viewClassName="cd-scroll-view" viewRef={scroller} onScroll={onScroll}>
      <ReplyToSelection within={timeline} />
      <div className={cx("cd-timeline", live && "is-live")} ref={timeline} aria-live="polite">
        {items.length === 0 ? <SkeletonChat /> : null}
        {items.map((item) => {
          switch (item.type) {
            case "ask": return <Ask key={item.seq} workspace={workspace} item={item} running={running} />;
            /* Let out once: shown again (another tab, scrolled back, opened again), it just shows. */
            case "text": return item.seq > liveFrom && (lettedOut.get(`${workspace.id}:${item.seq}`) ?? -1) < item.text.length
              ? <RevealWords key={item.seq} id={`${workspace.id}:${item.seq}`} text={item.text} className="cd-say" />
              : <div key={item.seq} className="cd-say"><Markdown text={item.text} /></div>;
            case "tools": return <ToolGroup key={item.seq} tools={item.tools} live={running && item === lastTools} />;
            case "done": return <Done key={item.seq} at={item.at} answer={item.answer} event={item.event} rating={ratings[item.seq] ?? null} reply={ratings[item.seq] ? replies[item.seq] : undefined} asking={asking === item.seq} onRate={rateAnswer.bind(null, item.seq)} />;
            case "shots": return <Shots key={item.seq} workspace={workspace} shots={item.shots} />;
            case "sent": return <div key={item.seq} className="cd-sent">
              {item.files.some(isMedia) ? <MediaGrid workspace={workspace} files={item.files.filter(isMedia)} /> : null}
              {item.files.filter((f) => !isMedia(f)).map((f) => <SentFile key={f.path} workspace={workspace} file={f} />)}
            </div>;
            case "preview": return <PreviewCard key={item.seq} workspace={workspace} url={item.event.url} live={running && workspace.preview?.url === item.event.url && item.seq === lastPreview} />;
            case "preview-stopped": return <p key={item.seq} className="cd-note">The app&rsquo;s link was taken down.</p>;
            /* Only a project says it was put to sleep; a plain chat just wakes when opened. */
            case "slept": return workspace.kind !== "project" ? null : <p key={item.seq} className="cd-note">Put to sleep to make room for &ldquo;{item.for}&rdquo;. It wakes when you open it.</p>;
            case "disk": return <p key={item.seq} className="cd-note is-failed">{item.event.full
              ? `Stopped: this chat's files took ${gigabytes(item.event.used)}, past its ${gigabytes(item.event.quota)}. Its app was stopped too. Ask it to free some space.`
              : `This chat's files take ${gigabytes(item.event.used)} of its ${gigabytes(item.event.quota)}. It was asked to free some space first.`}</p>;
            case "remembered": return <p key={item.seq} className="cd-note cd-remembered"><Icon name="chat" /><span>{item.how === "forgot" ? "Forgot" : item.how === "changed" ? "Now remembers" : "Remembered"}: {item.text} {owns ? <button type="button" className="cd-textbutton" onClick={() => goTo({ memory: "1" })}>For you</button> : null}</span></p>;
            case "access": return <AccessCard key={item.seq} workspace={workspace} event={item.event} answer={item.answer} />;
            case "compacted": return <p key={item.seq} className="cd-note cd-compacted"><Icon name="diff" />Compacted the conversation{item.before ? <span className="cd-mono"> · it held {kTokens(item.before)} tokens</span> : null}</p>;
            case "published": return <p key={item.seq} className="cd-note"><Icon name="pr" />Opened <button type="button" className="cd-textbutton" onClick={() => openOutside(item.event.url)}>pull request #{item.event.number}</button></p>;
            case "connect": return <ConnectCard key={item.seq} app={item.app} url={item.url} />;
            case "artifact": return keptPages && !keptPages[item.name]
              ? <p key={`art-${item.id}`} className="cd-note"><Icon name="spark" /><span>{item.action === "edited" ? "Changed" : "Made"} <b>{item.name}</b></span></p>
              : item.action === "edited"
              ? <ArtifactChanged key={`art-${item.id}`} name={item.name} />
              : <ArtifactCard key={`art-${item.id}`} name={item.name} />;
          }
        }).concat(writing.map(([name, d]) => <ArtifactCard key={`art-${d.id}`} name={name} />))}
        {drafts.text ? <DraftWords text={drafts.text} /> : null}
        {/* Not while the reply's own words are coming in: those show it's working. */}
        {running && !drafts.text?.trim() && drafts.now?.phase !== "writing" ? <Working since={workspace.turn?.startedAt ?? null} now={drafts.now} artifact={Object.keys(drafts.artifacts).length > 0} /> : null}
        {!running && workspace.preview && !workspace.preview.stopped && items.at(-1)?.type !== "ask" ? <AppReady workspace={workspace} url={workspace.preview.url} /> : null}
        {typing.length ? <p className="cd-note cd-typing-note" role="status"><TypingWords names={typing} /></p> : null}
      </div>
      {away ? <div className="cd-latest-wrap"><button type="button" className="cd-latest" onClick={() => { const el = scroller.current; if (el) { el.scrollTop = el.scrollHeight; pinned.current = true; setAway(false); } }}>Latest ↓</button></div> : null}
    </Scroller>
    {access === "read" ? <p className="cd-viewonly">You can view this chat</p> : <Composer workspace={workspace} running={running} blocked={blocked} context={lastContext} />}
  </div>;
});


/* ── sharing a chat, or one artifact (lib/code/sharing.ts) ──
   As in Docs: people in the household, each to read or to write; and a link,
   off, for anyone to read, or for anyone to read and people signed in to write. */

function ShareButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="cd-linkbutton cd-share-open" onClick={onClick}><Icon name="people" />Share</button>;
}

/** Copies [url], saying so on the button for a moment. */
function useCopy() {
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /* Where the clipboard is refused, the link is shown instead, to copy by hand. */
  const copy = (url: string) => navigator.clipboard.writeText(url).then(() => { setProblem(null); setCopied(true); setTimeout(() => setCopied(false), 1600); }, () => setProblem(url));
  return { copied, problem, copy };
}

/** Finding someone in the household to share with, by name or username: everyone but the owner and who's in already. */
function PeopleFinder({ owner, taken, onPick }: { owner: string; taken: Set<string>; onPick: (person: Person) => void }) {
  const { people } = useContext(ViewerContext);
  const [find, setFind] = useState("");
  const words = find.trim().toLowerCase().replace(/^@/, "");
  const found = words ? [...people.values()].filter((p) => p.username.toLowerCase() !== owner.toLowerCase() && !taken.has(p.username.toLowerCase())
    && (p.name.toLowerCase().includes(words) || p.username.toLowerCase().includes(words))).slice(0, 6) : [];
  const pick = (p: Person) => { setFind(""); onPick(p); };
  return <div className="cd-share-find">
    <label className="cd-conn-search"><Icon name="search" /><input value={find} onChange={(event) => setFind(event.target.value)} placeholder="Add people" aria-label="Add people"
      onKeyDown={(event) => { if (event.key === "Enter" && found[0]) { event.preventDefault(); pick(found[0]); } }} /></label>
    {words ? <div className="cd-share-found" role="listbox" aria-label="People">
      {found.map((p) => <button key={p.username} type="button" role="option" aria-selected={false} onClick={() => pick(p)}>
        <Face username={p.username} size={32} /><span><b>{p.name}</b><small>@{p.username}</small></span>
      </button>)}
      {!found.length ? <p className="cd-quiet">No one by that name.</p> : null}
    </div> : null}
  </div>;
}

/** One person it's shared with: who, and (when given) what they may do. */
function SharePerson({ username, note, children }: { username: string; note?: string; children?: React.ReactNode }) {
  const person = usePerson(username);
  return <li className="cd-share-person">
    <Face username={username} size={36} />
    <span className="cd-share-who"><b>{person.name}</b><small>{note ?? `@${username}`}</small></span>
    {children}
  </li>;
}

/** A dialog of the share kind: the page's own, in the top layer, closing on its backdrop. */
function ShareDialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  const box = useRef<HTMLDialogElement>(null);
  useEffect(() => { box.current?.showModal(); }, []);
  return <dialog ref={box} className="cd-share" aria-labelledby="cd-share-title" onClose={onClose} onClick={(event) => { if (event.target === box.current) box.current?.close(); }}>
    <header><h2 id="cd-share-title">Share &ldquo;{title}&rdquo;</h2></header>
    <div className="cd-share-body">{children}</div>
    <footer>{footer}<span className="cd-grow" /><Seal type="button" compact onClick={() => box.current?.close()}>Done</Seal></footer>
  </dialog>;
}

const generalWords = { off: "Only people invited", read: "Anyone with the link can view", edit: "Anyone with the link can view, people signed in can write" } as const;
/* With public links switched off, a link opens only for people signed in to this Kimono. */
const signedInWords = { off: "Only people invited", read: "People in this Kimono with the link can view", edit: "People in this Kimono with the link can write" } as const;

function ShareChat({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const { me } = useContext(ViewerContext);
  const owner = workspace.owner ?? me ?? "";
  const [sharing, setSharing] = useState<ChatSharing | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { copied, problem: copyProblem, copy } = useCopy();
  /* Each change shows at once; only the newest answer is kept, so a slow earlier one can't put the old choice back. */
  const asked = useRef(0);
  useEffect(() => { const n = ++asked.current; code.sharing(workspace.id).then((next) => { if (n === asked.current) setSharing(next); }, (error) => setProblem(problemText(error))); }, [workspace.id]);
  const change = (work: Promise<ChatSharing>, guess?: (now: ChatSharing) => ChatSharing) => {
    const n = ++asked.current;
    const before = sharing;
    setProblem(null);
    if (guess) setSharing((now) => now && guess(now));
    work.then((next) => { if (n === asked.current) setSharing(next); }, (error) => { if (n === asked.current) { setSharing(before); setProblem(problemText(error)); } });
  };
  const taken = new Set(sharing?.people.map((p) => p.username.toLowerCase()) ?? []);
  const writers = Boolean(sharing && (sharing.people.some((p) => p.access === "edit") || sharing.link?.access === "edit"));
  const general = sharing?.link?.access ?? "off";
  /* With the link off, the address still opens it for the people invited. */
  const url = sharing?.link ? chatLinkUrl(sharing.link.token) : `${window.location.origin}/code#w=${workspace.id}`;
  return <ShareDialog title={workspace.title} onClose={onClose}
    footer={<>
      {problem ? <span className="cd-problem" role="alert">{problem}</span> : copyProblem ? <input className="cd-share-url" readOnly value={copyProblem} aria-label="Link" onFocus={(event) => event.target.select()} /> : null}
      <Seal type="button" compact tone="quiet" disabled={!sharing} onClick={() => void copy(url)}><Icon name={copied ? "check" : "link"} />{copied ? "Copied" : "Copy link"}</Seal>
    </>}>
    {sharing === null && !problem ? <SkeletonRows rows={2} mark={false} /> : sharing ? <>
      <PeopleFinder owner={owner} taken={taken} onPick={(p) => change(code.shareWith(workspace.id, p.username, "read"))} />
      <ul className="cd-share-people">
        <SharePerson username={owner} note="Owner" />
        {sharing.people.map((p) => <SharePerson key={p.username} username={p.username}>
          <Choice compact aria-label={`What ${p.username} can do`} className="cd-share-can" value={p.access}
            options={[{ value: "read", label: "Can view" }, { value: "edit", label: "Can write" }]}
            onChange={(next) => change(code.shareWith(workspace.id, p.username, next as "read" | "edit"),
              (now) => ({ ...now, people: now.people.map((q) => q.username === p.username ? { ...q, access: next as "read" | "edit" } : q) }))} />
          <button type="button" className="cd-roundbutton" aria-label={`Remove ${p.username}`} title="Remove" onClick={() => change(code.shareWith(workspace.id, p.username, null))}><Icon name="close" /></button>
        </SharePerson>)}
      </ul>
      <h3 className="cd-share-sub">General access</h3>
      <div className="cd-share-general">
        <InkBlot className={cx("cd-share-mark", general !== "off" && "is-open")} tint={general === "off" ? inkTint.quiet : inkTint.suo} seed="share"><Icon name={general === "off" ? "lock" : "link"} /></InkBlot>
        <Choice aria-label="General access" className="cd-share-link" value={general}
          options={(["off", "read", "edit"] as const).map((v) => ({ value: v, label: (sharing.publicLinks === false ? signedInWords : generalWords)[v] }))}
          onChange={(next) => change(code.setLink(workspace.id, next === "off" ? null : next as "read" | "edit"),
            (now) => ({ ...now, link: next === "off" ? null : { token: now.link?.token ?? "", access: next as "read" | "edit" } }))} />
      </div>
      {writers ? <p className="cd-share-note">People who can write send messages as themselves, but it works with your files and apps.</p> : null}
    </> : null}
  </ShareDialog>;
}

function ShareArtifact({ workspaceId, name, title, onClose }: { workspaceId: string; name: string; title: string; onClose: () => void }) {
  const { me } = useContext(ViewerContext);
  const owner = me ?? "";
  const [sharing, setSharing] = useState<ArtifactSharing | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { copied, problem: copyProblem, copy } = useCopy();
  const asked = useRef(0);
  useEffect(() => { const n = ++asked.current; code.artifactSharing(workspaceId, name).then((next) => { if (n === asked.current) setSharing(next); }, (error) => setProblem(problemText(error))); }, [workspaceId, name]);
  const change = (work: Promise<ArtifactSharing>, guess?: (now: ArtifactSharing) => ArtifactSharing) => {
    const n = ++asked.current;
    const before = sharing;
    setProblem(null);
    if (guess) setSharing((now) => now && guess(now));
    return work.then((next) => { if (n === asked.current) setSharing(next); return next; }, (error) => { if (n === asked.current) { setSharing(before); setProblem(problemText(error)); } return null; });
  };
  const on = new Set(sharing?.people.map((u) => u.toLowerCase()) ?? []);
  /* The link exists once it's first shared; copying before that makes it, for the people it's shared with. */
  const copyLink = async () => {
    const token = sharing?.token ?? (await change(code.setArtifactPublic(workspaceId, name, sharing?.public ?? false)))?.token;
    if (token) await copy(artifactLinkUrl(token));
  };
  return <ShareDialog title={title} onClose={onClose}
    footer={<>
      {problem ? <span className="cd-problem" role="alert">{problem}</span> : copyProblem ? <input className="cd-share-url" readOnly value={copyProblem} aria-label="Link" onFocus={(event) => event.target.select()} /> : null}
      <Seal type="button" compact tone="quiet" disabled={!sharing} onClick={() => void copyLink()}><Icon name={copied ? "check" : "link"} />{copied ? "Copied" : "Copy link"}</Seal>
    </>}>
    {sharing === null && !problem ? <SkeletonRows rows={2} mark={false} /> : sharing ? <>
      <PeopleFinder owner={owner} taken={on} onPick={(p) => void change(code.shareArtifact(workspaceId, name, p.username, true))} />
      <ul className="cd-share-people">
        <SharePerson username={owner} note="Owner" />
        {sharing.people.map((username) => <SharePerson key={username} username={username} note="Can view">
          <button type="button" className="cd-roundbutton" aria-label={`Remove ${username}`} title="Remove" onClick={() => void change(code.shareArtifact(workspaceId, name, username, false))}><Icon name="close" /></button>
        </SharePerson>)}
      </ul>
      {/* Public links switched off: no making it public (one made public before can still be closed). */}
      {sharing.publicLinks === false && !sharing.public ? null : <><h3 className="cd-share-sub">General access</h3>
      <div className="cd-share-general">
        <InkBlot className={cx("cd-share-mark", sharing.public && "is-open")} tint={sharing.public ? inkTint.suo : inkTint.quiet} seed="share"><Icon name={sharing.public ? "link" : "lock"} /></InkBlot>
        <Choice aria-label="General access" className="cd-share-link" value={sharing.public ? "public" : "people"}
          options={[{ value: "people", label: "Only people it\u2019s shared with" }, { value: "public", label: "Anyone with the link can view" }]}
          onChange={(next) => void change(code.setArtifactPublic(workspaceId, name, next === "public"), (now) => ({ ...now, public: next === "public" }))} />
      </div></>}
    </> : null}
  </ShareDialog>;
}

/* ── artifacts (docs/kimono-ai.md, "Artifacts") ──
   A page it made, drawn in a sandboxed frame with no origin and no internet
   (app/ai/frame). It renders while it is being written, every card shows the
   latest version, and a big one opens beside the chat or full screen. */

type ArtifactsShared = {
  workspaceId: string;
  drafts: Drafts["artifacts"];
  versions: Record<string, { version: number; title: string }>;
  beside: string | null;
  setBeside: (name: string | null) => void;
  setFull: (name: string | null) => void;
  /** A chat kept as it was: each artifact's page as it was kept, where it was (older ones have the name alone). */
  kept?: Record<string, { title: string; content: string }>;
};
const ArtifactsContext = createContext<ArtifactsShared | null>(null);

/** The latest saved version of an artifact, fetched again whenever a new one is kept. */
function useArtifact(name: string) {
  const shared = useContext(ArtifactsContext)!;
  const version = shared.versions[name]?.version ?? 0;
  const [saved, setSaved] = useState<{ version: number; content: string; title: string; media?: string } | null>(null);
  useEffect(() => {
    if (!version) return;
    let live = true;
    code.artifact(shared.workspaceId, name).then((found) => { if (live) setSaved({ version: found.version, content: found.content, title: found.title, media: found.media }); }, () => {});
    return () => { live = false; };
  }, [shared.workspaceId, name, version]);
  const draft = shared.drafts[name];
  const page = shared.kept?.[name];
  const content = draft?.content ?? saved?.content ?? page?.content ?? "";
  const title = shared.versions[name]?.title ?? page?.title ?? /<title>([^<]{1,120})<\/title>/i.exec(content)?.[1]?.trim() ?? name.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
  return { shared, content, title, media: saved?.media, writing: Boolean(draft), ready: Boolean(draft || saved || page) };
}

/** An artifact in the chat (and, bigger, beside it or full screen). */
function ArtifactCard({ name, mode = "inline" }: { name: string; mode?: "inline" | "beside" | "full" }) {
  const { shared, content, title, media, writing, ready } = useArtifact(name);
  const owns = useOwns();
  const { guest } = useContext(ViewerContext);
  const [sharing, setSharing] = useState(false);
  /* Only a kept version can be shared: one still being written has nothing to open yet. */
  const canShare = owns && !guest && !writing && Boolean(shared.versions[name]);
  const [height, setHeight] = useState(0);
  const [scene, setScene] = useState<SceneState | null>(null);
  const [control, setControl] = useState<SceneControl | null>(null);
  const send = (action: SceneControl["action"], t?: number, name?: string, value?: number) => setControl((c) => ({ n: (c?.n ?? 0) + 1, action, t, name, value }));
  const animated = /<k-scene\b/i.test(content);
  const inline = mode === "inline";
  const open = shared.beside === name;
  /* Folded in the chat to just its title bar; remembered per artifact on this device. */
  const foldKey = `kimono-ai:folded:${shared.workspaceId}:${name}`;
  const [folded, setFolded] = useState(() => { try { return inline && localStorage.getItem(foldKey) === "1"; } catch { return false; } });
  const fold = (next: boolean) => { setFolded(next); try { if (next) localStorage.setItem(foldKey, "1"); else localStorage.removeItem(foldKey); } catch { /* not kept */ } };
  /* A big one goes beside the chat by itself the first time it grows past the card, on a wide window. */
  const moved = useRef(false);
  const onHeight = useCallback((h: number) => {
    setHeight(h);
    if (inline && writing && !moved.current && h > 760 && window.innerWidth >= 1180) { moved.current = true; shared.setBeside(name); }
  }, [inline, writing, shared, name]);
  /* Inline, it's as tall as its page up to most of the window; a drag on its bottom edge sets the height instead. */
  const [chosen, setChosen] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [cap, setCap] = useState(900);
  useEffect(() => {
    const fit = () => setCap(Math.max(320, Math.round(window.innerHeight * 0.8)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const shown = inline ? chosen ?? Math.min(Math.max(height, 120), cap) : undefined;
  const resizeBy = (h: number) => setChosen(Math.min(Math.max(Math.round(h), 120), 2400));
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !shown) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const from = event.clientY, start = shown;
    setDragging(true);
    const move = (e: PointerEvent) => resizeBy(start + e.clientY - from);
    const end = () => { setDragging(false); handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("pointercancel", end); };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const shut = inline && folded && !open;
  return <figure className={cx("cd-artifact", `is-${mode}`, writing && "is-writing", inline && open && "is-elsewhere", shut && "is-folded")}>
    <figcaption className="cd-artifact-head">
      <InkBlot className="cd-artifact-mark" tint={inkTint.suo} seed={name}><Icon name="spark" /></InkBlot>
      <span className="cd-artifact-name"><b title={title}>{title}</b>{writing ? <small className="cd-artifact-writing"><InkLoader tone="plain" label="Writing" className="cd-morph" />Writing</small> : <small>{animated ? "Animation" : "Artifact"}</small>}</span>
      <span className="cd-artifact-acts">
        {inline && !open ? <button type="button" className="cd-roundbutton cd-artifact-fold" aria-expanded={!folded} aria-label={folded ? "Show" : "Collapse"} title={folded ? "Show" : "Collapse"} onClick={() => fold(!folded)}><Icon name="chevron" /></button> : null}
        {canShare ? <button type="button" className="cd-roundbutton" aria-label="Share" title="Share" onClick={() => setSharing(true)}><Icon name="people" /></button> : null}
        {mode !== "full" ? <button type="button" className="cd-roundbutton" aria-label={open ? "Close the side panel" : "Open beside the chat"} title={open ? "Close the side panel" : "Open beside the chat"} onClick={() => shared.setBeside(open ? null : name)}><Icon name={open ? "close" : "beside"} /></button> : null}
        <button type="button" className="cd-roundbutton" aria-label={mode === "full" ? "Leave full screen" : "Full screen"} title={mode === "full" ? "Leave full screen" : "Full screen"} onClick={() => shared.setFull(mode === "full" ? null : name)}><Icon name={mode === "full" ? "shrink" : "expand"} /></button>
      </span>
    </figcaption>
    {inline && open
      ? <button type="button" className="cd-artifact-away" onClick={() => shared.setBeside(null)}>Open beside the chat · bring it back here</button>
      : ready
        ? <>
            <div className={cx("cd-artifact-body", dragging && "is-dragging")} style={shown ? { height: shown } : undefined} hidden={shut}><ArtifactFrame content={content} final={!writing} title={title} media={media} control={control} onHeight={onHeight} onScene={setScene} /></div>
            {inline && !shut ? <div className="cd-artifact-grip" role="separator" aria-orientation="horizontal" aria-label="Resize" title="Drag to resize · double-click to fit" tabIndex={0}
              aria-valuemin={120} aria-valuemax={2400} aria-valuenow={shown}
              onPointerDown={startDrag} onDoubleClick={() => setChosen(null)}
              onKeyDown={(event) => { if (!shown) return; if (event.key === "ArrowDown") { event.preventDefault(); resizeBy(shown + 40); } else if (event.key === "ArrowUp") { event.preventDefault(); resizeBy(shown - 40); } else if (event.key === "Enter" || event.key === "Escape") setChosen(null); }} /> : null}
            {scene && scene.end > 0 && !shut ? <SceneBar scene={scene} send={send} /> : null}
          </>
        : <InkLoader label="Opening" className="cd-artifact-loading" />}
    {sharing ? <ShareArtifact workspaceId={shared.workspaceId} name={name} title={title} onClose={() => setSharing(false)} /> : null}
  </figure>;
}

/** Kimono's own controls for an artifact's animation: the scenes inside only report their time. */
/* How loud narrated animations play, kept for the next one (this browser only). */
/** An edit to an artifact shown earlier: the card above already shows it; this says so, and shows it again here. */
function ArtifactChanged({ name }: { name: string }) {
  const { shared, title } = useArtifact(name);
  return <p className="cd-note cd-artifact-changed"><Icon name="spark" /><span>Changed <b>{title}</b> <button type="button" className="cd-textbutton" onClick={() => shared.setBeside(name)}>Open</button></span></p>;
}

/** Working, at the end of the conversation: what it's doing, in its own words and ink, and how long. The one place it shows in a chat. */
function Working({ since, now: doing, artifact }: { since: number | null; now: Now | null; artifact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const phase = artifact || doing?.phase === "artifact" ? "artifact" : doing?.phase ?? "working";
  const time = since ? elapsed(Math.max(0, now - since)) : "";
  return <div className={`cd-thinking is-${phase}`} role="status">
    <WorkingMark phase={phase} doing={doing} />
    <span className="cd-now" key={`${phase}:${doing?.app ?? doing?.space ?? doing?.tool ?? ""}`}><WorkingWords phase={phase} doing={doing} /></span>
    {time ? <span className="cd-now-time">{time}</span> : null}
  </div>;
}

function WorkingMark({ phase, doing }: { phase: Phase; doing: Now | null }) {
  if (phase === "tools" && (doing?.app || doing?.space)) {
    return <span className="cd-now-seal" key={doing.app ?? doing.space} aria-hidden="true">{doing.app ? <AppLogo slug={doing.app} /> : <DriveMark />}</span>;
  }
  return <span className="cd-now-ink" aria-hidden="true">
    <InkLoader ink={phase === "artifact" ? undefined : phase === "thinking" ? thinkingInk : workingInk} label="" className="cd-morph" />
    {phase === "artifact" ? <><i /><i /><i /></> : null}
  </span>;
}

/** Its words for what it's doing; thinking and the magic come in letter by letter, like ink taking. */
function WorkingWords({ phase, doing }: { phase: Phase; doing: Now | null }) {
  const app = useAppLook(doing?.app ?? "");
  const words = phase === "artifact" ? "Working my magic"
    : phase === "thinking" ? "Thinking"
    : phase === "writing" ? "Writing"
    : phase === "tools" ? doing?.app ? `Using ${app.name}`
      : doing?.space ? `Looking in ${doing.space}`
      : doing?.tool === "web" ? "Searching the web"
      : doing?.tool === "command" ? "Running a command"
      : doing?.tool === "files" ? "Going through files"
      : doing?.tool === "helper" ? "Asking a helper"
      : "Using tools"
    : "Working";
  if (phase !== "thinking" && phase !== "artifact") return <>{words}</>;
  return <span aria-label={words}>{[...words].map((c, i) => <span key={i} aria-hidden="true" className="cd-now-letter" style={{ "--i": i } as React.CSSProperties}>{c === " " ? "\u00a0" : c}</span>)}</span>;
}

/* ── replying to part of an answer ── */

/** A reply's words as sent: the part it answers, each line as "> ", then a blank line and what they wrote. Kimono reads it as a quote. */
const withQuote = (quote: string, words: string) => `${quote.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n${words}`;

/** A sent message: the part of an answer it replies to (its "> " lines at the start), then the words. */
function QuotedText({ text }: { text: string }) {
  const quoted = /^((?:> ?.*(?:\n|$))+)\n?/.exec(text);
  if (!quoted) return <p>{text}</p>;
  const rest = text.slice(quoted[0].length);
  return <>
    <blockquote className="cd-ask-quote">{quoted[1].trimEnd().split("\n").map((line) => line.replace(/^> ?/, "")).join("\n")}</blockquote>
    {rest ? <p>{rest}</p> : null}
  </>;
}

const quoteEvent = "kimono:reply-to";

/**
 * Selecting words in one of its answers offers Reply beside them; choosing it
 * puts them above the message box as what the next message answers.
 */
function ReplyToSelection({ within }: { within: React.RefObject<HTMLElement | null> }) {
  const [at, setAt] = useState<{ x: number; y: number; text: string } | null>(null);
  useEffect(() => {
    const look = () => {
      const chosen = document.getSelection();
      const words = chosen?.toString().trim() ?? "";
      const range = chosen && chosen.rangeCount ? chosen.getRangeAt(0) : null;
      const answer = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest(".cd-say");
      if (!words || !range || !within.current) return setAt(null);
      const from = answer(range.startContainer), to = answer(range.endContainer);
      if (!from || !to || !within.current.contains(from)) return setAt(null);
      const box = range.getBoundingClientRect();
      setAt({ x: box.left + box.width / 2, y: box.top, text: words.slice(0, 2000) });
    };
    document.addEventListener("selectionchange", look);
    window.addEventListener("scroll", look, true);
    return () => { document.removeEventListener("selectionchange", look); window.removeEventListener("scroll", look, true); };
  }, [within]);
  if (!at) return null;
  /* On the page itself, so the chat's own layers (its sticky rows, its scroller) never sit over it. */
  return createPortal(<button type="button" className="cd-reply-to" style={{ left: at.x, top: at.y }}
    /* Pressing it would clear the selection (and so the button) before a click lands: it acts on the press, and keeps the words selected until then. */
    onMouseDown={(event) => event.preventDefault()}
    onPointerDown={(event) => { event.preventDefault(); if (event.button !== 0) return; window.dispatchEvent(new CustomEvent(quoteEvent, { detail: at.text })); document.getSelection()?.removeAllRanges(); setAt(null); }}
    onKeyDown={(event) => { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); window.dispatchEvent(new CustomEvent(quoteEvent, { detail: at.text })); setAt(null); }}>
    <Icon name="reply" />Reply
  </button>, document.querySelector(".cd-page") ?? document.body);
}

function Ask({ workspace, item, running }: { workspace: Workspace; item: Extract<Item, { type: "ask" }>; running: boolean }) {
  const { text, attachments, queued, by } = item.event;
  const { me, guest } = useContext(ViewerContext);
  const { owner, access } = useContext(ChatAccess);
  /* In a shared chat, a message someone else wrote says whose it is. A guest knows the owner from the header, so only the others are named. */
  const someoneElse = Boolean(by) && by.toLowerCase() !== (me ?? owner).toLowerCase();
  const author = usePerson(by || "");
  /* Your own message, while it isn't working: change it, and it runs again from there. */
  const editable = !guest && !someoneElse && !queued && !running && access !== "read" && Boolean(me);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { const f = field.current; if (f) { f.style.height = "auto"; f.style.height = `${f.scrollHeight}px`; } }, [editing]);
  const send = () => {
    const next = editing?.trim();
    if (!next || saving) return;
    if (next === text.trim()) { setEditing(null); return; }
    setSaving(true); setProblem(null);
    code.editAsk(workspace.id, item.seq, next, effortNow()).then(() => { setEditing(null); setSaving(false); }, (error) => { setProblem(problemText(error)); setSaving(false); });
  };
  if (text.trim() === "/compact" && !attachments.length) return <p className="cd-note"><Icon name="diff" />{someoneElse ? author.name : "You"} asked it to compact the conversation{queued ? " after this step" : ""}</p>;
  if (editing !== null) return <form className="cd-ask cd-ask-edit" onSubmit={(event) => { event.preventDefault(); send(); }}>
    <textarea ref={field} autoFocus value={editing} aria-label="Your message" rows={1} maxLength={32_000}
      onChange={(event) => setEditing(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Escape") setEditing(null); if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
    {attachments.length ? <FileChips workspace={workspace} files={attachments} /> : null}
    <div className="cd-ask-edit-foot">
      <small>{problem ?? "It answers again from here; what came after goes."}</small>
      <button type="button" className="cd-quietbutton" onClick={() => setEditing(null)}>Cancel</button>
      <Seal type="submit" compact busy={saving} disabled={!editing.trim()}>Send</Seal>
    </div>
  </form>;
  return <>
    {someoneElse ? <p className="cd-ask-by"><Face username={by} size={20} /><span>{author.name}</span></p> : null}
    <div className={cx("cd-ask", queued && !item.dropped && "is-queued", item.dropped && "is-dropped", someoneElse && "is-theirs")} title={queued && !item.dropped ? "Sent while it was working: read as soon as the current step ends" : undefined}>
      {text ? <QuotedText text={text} /> : null}
      {attachments.length ? <FileChips workspace={workspace} files={attachments} /> : null}
    </div>
    {item.dropped ? <p className="cd-ask-note">Not sent: it was stopped first</p> : null}
    <div className="cd-ask-acts">
      <span className="cd-ask-time">{saidAt(item.at)}</span>
      {text ? <CopyButton text={text} label="Copy message" /> : null}
      {editable ? <button type="button" className="cd-iconbutton" aria-label="Edit" title="Edit" onClick={() => { setEditing(text); setProblem(null); }}><Icon name="rename" /></button> : null}
    </div>
  </>;
}

/** What a file is, in a word: "PDF document", "PNG picture". */
function fileKind(name: string, type: string) {
  const label = extensionLabel(name);
  const kind = previewKind(name, type);
  return kind === "image" ? `${label} picture` : kind === "video" ? `${label} video` : kind === "audio" ? `${label} sound`
    : kind === "pdf" ? "PDF document" : kind === "text" ? `${label} text` : label === "FILE" ? "File" : `${label} file`;
}

/**
 * A file Kimono AI sent: a card with its picture or mark, what it is and a
 * Download button. One the preview can show opens over the window when clicked;
 * anything else is the card alone.
 */
function SentFile({ workspace, file }: { workspace: Workspace; file: Attachment }) {
  const [open, setOpen] = useState(false);
  const url = code.attachmentUrl(workspace.id, file);
  const shows = Boolean(file.path) && (previewable(file.name, file.type) || previewKind(file.name, file.type) === "audio");
  /* A PDF opens in the browser's own viewer, which reads it better than any preview here. */
  const pdf = Boolean(file.path) && isPdf(file);
  const download = () => saveAs(url, file.name);
  const face = <>
    <FileThumb name={file.name} picture={isPicture(file.type) ? url : null} video={previewKind(file.name, file.type) === "video" ? url : null} size={48} className="cd-sentfile-thumb" />
    <span className="cd-sentfile-name"><b title={file.name}>{file.name}</b><small>{file.path ? `${fileKind(file.name, file.type)} · ${readableSize(file.size)}` : fileKind(file.name, file.type)}</small></span>
  </>;
  return <figure className={cx("cd-sentfile", (shows || pdf) && "is-open-able")}>
    {shows || pdf ? <button type="button" className="cd-sentfile-face" aria-label={`Open ${file.name}`} title="Open" onClick={() => pdf ? openOutside(url) : setOpen(true)}>{face}</button>
      : <div className="cd-sentfile-face">{face}</div>}
    {file.path ? <Seal type="button" tone="quiet" compact onClick={download}><Icon name="download" />Download</Seal> : null}
    {open ? <FileOverlay name={file.name} mime={file.type} url={url} onClose={() => setOpen(false)}
      actions={<Seal type="button" tone="quiet" compact onClick={download}><Icon name="download" />Download</Seal>} /> : null}
  </figure>;
}

/** Files someone attached: photos and videos as squares, anything else as a chip. Each opens in place, to download. */
function FileChips({ workspace, files }: { workspace: Workspace; files: Attachment[] }) {
  const [opened, setOpened] = useState<Attachment | null>(null);
  const others = files.filter((a) => !isMedia(a));
  return <>
    {files.some(isMedia) ? <MediaGrid workspace={workspace} files={files.filter(isMedia)} /> : null}
    {others.length ? <div className="cd-attached">{others.map((a) => <button type="button" key={a.path || a.name} className="cd-filechip" disabled={!a.path} onClick={() => isPdf(a) ? openOutside(code.attachmentUrl(workspace.id, a)) : setOpened(a)}><FileThumb name={a.name} size={30} /><span>{a.name}</span>{a.path ? <small>{readableSize(a.size)}</small> : null}</button>)}</div> : null}
    {opened ? <FileOverlay name={opened.name} mime={opened.type} url={code.attachmentUrl(workspace.id, opened)} onClose={() => setOpened(null)}
      actions={<Seal type="button" tone="quiet" compact onClick={() => saveAs(code.attachmentUrl(workspace.id, opened), opened.name)}><Icon name="download" />Download</Seal>} /> : null}
  </>;
}

const isVideo = (a: { name: string; type: string }) => previewKind(a.name, a.type) === "video";
const isPdf = (a: { name: string; type: string }) => previewKind(a.name, a.type) === "pdf";
/** A photo or a video: what shows as a square in the chat. */
const isMedia = (a: { name: string; type: string }) => isPicture(a.type) || isVideo(a);

/** How long a video runs: "0:07", "12:40", "1:02:09". */
function runningTime(seconds: number) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** A photo cropped to fill a square, or a video's frame with a play mark and how long it runs. */
function MediaFace({ name, url, video }: { name: string; url: string; video?: boolean }) {
  const [length, setLength] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  if (failed) return <FileThumb name={name} className="cd-media-broken" />;
  return <>
    {video
      ? <video src={`${url}#t=0.5`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true"
        onLoadedMetadata={(event) => { const d = event.currentTarget.duration; if (Number.isFinite(d) && d > 0) setLength(d); }} onError={() => setFailed(true)} />
      // eslint-disable-next-line @next/next/no-img-element -- the photo itself, cropped by CSS
      : <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />}
    {video ? <span className="cd-media-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></svg></span> : null}
    {video && length ? <span className="cd-media-length">{runningTime(length)}</span> : null}
  </>;
}

/** Photos and videos in a message, as a grid of squares; each opens over the window. */
function MediaGrid({ workspace, files }: { workspace: Workspace; files: Attachment[] }) {
  const [opened, setOpened] = useState<Attachment | null>(null);
  const url = (a: Attachment) => code.attachmentUrl(workspace.id, a);
  return <>
    <div className={cx("cd-media", files.length === 1 && "is-one")} style={{ "--cd-media-cols": Math.min(files.length, 3) } as React.CSSProperties}>
      {files.map((a) => <button type="button" key={a.path} className="cd-media-tile" aria-label={`Open ${a.name}`} title={a.name} onClick={() => setOpened(a)}>
        <MediaFace name={a.name} url={url(a)} video={isVideo(a)} />
      </button>)}
    </div>
    {opened ? <FileOverlay name={opened.name} mime={opened.type} url={url(opened)} onClose={() => setOpened(null)}
      actions={<Seal type="button" tone="quiet" compact onClick={() => saveAs(url(opened), opened.name)}><Icon name="download" />Download</Seal>} /> : null}
  </>;
}

/** A photo or video waiting in the message box: its square, a mark while it uploads, and a way to take it out. */
function PendingMedia({ name, url, video, sending, failed, onRemove }: { name: string; url: string; video?: boolean; sending?: boolean; failed?: string; onRemove: () => void }) {
  return <span className={cx("cd-media-tile", "is-pending", sending && "is-sending", failed && "is-failed")} title={failed ? `${name}: ${failed}` : name}>
    <MediaFace name={name} url={url} video={video} />
    {sending ? <span className="cd-media-state"><InkLoader tone="plain" label="Attaching" className="cd-morph" /></span> : null}
    {failed ? <span className="cd-media-state is-failed">{failed}</span> : null}
    <button type="button" className="cd-media-remove" aria-label={`Remove ${name}`} onClick={onRemove}><Icon name="close" /></button>
  </span>;
}

/** Tool calls as one pill — "Used 5 tools" — open while the agent is still in them, unless you closed it. Each call opens to show what it did. */
function ToolGroup({ tools, live }: { tools: Tool[]; live: boolean }) {
  /* Long work the agent said it's doing (kimono-progress): one card with a bar, the steps folded under it. */
  if (tools.some((t) => t.progress?.label)) return <ProgressGroup tools={tools} live={live} />;
  return <PlainToolGroup tools={tools} live={live} />;
}

/**
 * A long piece of work as one card: what it's doing and how far it really is. The bar fills only with a
 * percent the job itself gave (its output, a probe, or the tool's status); until then it's the open wave.
 * Kimono reads the job's state from the sandbox while it runs, so the card moves by itself. The
 * kimono-progress bookkeeping isn't shown; any other steps fold under it.
 */
function ProgressGroup({ tools, live }: { tools: Tool[]; live: boolean }) {
  const card = cardOf(tools, live);
  const steps = tools.filter((t) => !t.progress?.only);
  const failed = steps.filter((t) => t.result && !t.result.ok && t.label !== "Ran").length;
  const done = card.state === "done", broke = card.state === "failed";
  const head = <>
    <InkBlot className="cd-progress-mark" tint={done ? inkTint.live : inkTint.suo} seed={tools[0]?.id ?? card.label}>{done ? <Icon name="check" /> : broke || card.stopped ? <GroupMarks tools={tools} /> : <InkLoader tone="plain" label={card.label} className="cd-morph" />}</InkBlot>
    <span className="cd-progress-text">
      <span className="cd-progress-label"><b>{card.label}</b>{tools.some((t) => t.app) ? <GroupMarks tools={tools} /> : null}<ProPrice usd={priceOf(tools)} /></span>
      {done || broke || card.stopped || card.percent == null ? null : <InkWave className="cd-progress-wave" label={card.label} value={card.percent / 100} />}
      <small>{cardWords(card, failed)}</small>
    </span>
  </>;
  const state = done ? "done" : broke ? "failed" : card.stopped ? "stopped" : "running";
  if (!steps.length) return <div className="calls cd-progress" data-state={state}><div className="cd-progress-head">{head}</div></div>;
  return <details className="calls cd-progress" data-state={state}>
    <summary className="cd-progress-head">{head}<span className="chev" aria-hidden="true" /></summary>
    <div className="call-list">{steps.map((tool) => <ToolRow key={tool.id} tool={tool} />)}</div>
  </details>;
}

function PlainToolGroup({ tools, live }: { tools: Tool[]; live: boolean }) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? live;
  const failed = tools.filter((t) => t.result && !t.result.ok).length;
  const pending = tools.some((t) => !t.result);
  const touched = [...new Set(tools.filter((t) => t.label === "Edited" || t.label === "Wrote").map((t) => t.detail).filter(Boolean))];
  return <details className="calls" open={open} onToggle={(event) => { const next = (event.currentTarget as HTMLDetailsElement).open; if (next !== open) setChosen(next); }}>
    <summary className="tools-used">
      {live && pending ? <InkLoader tone="plain" label="Using tools" className="cd-morph" /> : <GroupMarks tools={tools} />}
      <span>{live && pending ? "Using tools" : `Used ${tools.length} ${tools.length === 1 ? "tool" : "tools"}`}</span>
      <ProPrice usd={priceOf(tools)} />
      {touched.length ? <span className="cd-faint">· edited {touched.length === 1 ? touched[0] : `${touched.length} files`}</span> : null}
      {failed ? <span className="cd-word">{failed} failed</span> : null}
      <span className="chev" aria-hidden="true" />
    </summary>
    <div className="call-list">{tools.map((tool) => <ToolRow key={tool.id} tool={tool} />)}</div>
  </details>;
}

/** What Pro Tools cost, beside their bolt, in credits ("231 credits", "0.7 credits"). Nothing when free. */
const priceOf = (tools: Tool[]) => tools.reduce((sum, t) => sum + (t.cost ?? 0), 0);
function ProPrice({ usd }: { usd: number }) {
  if (!(usd > 0)) return null;
  const shown = credits(usd);
  return <span className="cd-pro-price" title={`This used ${shown} of this month's Pro Tools`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 3 5.5 13.5h6L10.5 21l8-10.5h-6z" /></svg>{shown}</span>;
}

/** The apps and spaces a group of calls touched, side by side; a gear when it was only the sandbox. */
function GroupMarks({ tools }: { tools: Tool[] }) {
  const apps = [...new Set(tools.map((t) => t.app).filter((a): a is string => Boolean(a)))].slice(0, 3);
  const drive = tools.some((t) => t.space && !t.app);
  if (!apps.length && !drive) return <Icon name="gear" />;
  return <span className="cd-groupmarks">{drive ? <DriveMark /> : null}{apps.map((slug) => <AppLogo key={slug} slug={slug} pro={tools.some((t) => t.app === slug && t.pro)} />)}</span>;
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
      <InkBlot className={cx("ci", (tool.app || tool.space) && "is-mark")} tint={state === "failed" ? inkTint.suo : inkTint.quiet} seed={tool.id}>{state === "running" ? <InkLoader tone="plain" label="Running" className="cd-morph" /> : <ToolMark tool={tool} />}</InkBlot>
      <span className="cv">{tool.label}{tool.app && /^(Used|Connecting|Read how to use)$/.test(tool.label) ? <> <AppName slug={tool.app} /></> : null}</span>
      {tool.cost ? <ProPrice usd={tool.cost} /> : null}
      {tool.space ? <SpaceChip name={tool.space} /> : null}
      {tool.detail ? <code>{(tool.space ? tool.detail.split(`/workspace/.kimono/files/${tool.space}/`).join("").split(`/files/${tool.space}/`).join("") : tool.detail).split("\n")[0] || "\u00a0"}</code> : null}
      <span className={state === "failed" ? "cm is-failed" : "cm"}>{toolMeta(tool)}</span>
      <span className="chev" aria-hidden="true" />
    </summary>
    <div className="cbody">
      {tool.change && state !== "failed"
        ? <Scroller fit viewClassName="diff">{tool.change.split("\n").map((line, index) => <div key={index} className={line.startsWith("+ ") ? "add" : line.startsWith("- ") ? "del" : "gap"}>{line}</div>)}</Scroller>
        : command || output
          ? <Scroller fit as="pre" tone="lift" viewClassName="urushi">{command ? <span className="c">$ {command}{output ? "\n" : ""}</span> : null}{output}</Scroller>
          : <p className="cd-faint">{state === "running" ? "Still running." : "Nothing came back."}</p>}
    </div>
  </details>;
}

/* What someone says next that shows how an answer landed: put out, or pleased. */
const putOut = /\b(wtf|useless|stupid|terrible|awful|garbage|annoying|frustrat\w*|ridiculous|(that'?s|it'?s|still|all) wrong|still (broken|not|doesn'?t|isn'?t)|not what i (asked|wanted|meant|said)|why (did|would|do) you|you (didn'?t|keep|never|ignored))\b|\u{1F621}|\u{1F92C}|\u{1F624}|\u{1F644}|!{3,}/iu;
const pleased = /\b(thanks?|thank you|thx|ty|perfect|great|awesome|amazing|excellent|brilliant|love (it|this|that)|nice|exactly|well done|good job|works now|that works|you'?re the best)\b|\u{1F64F}|\u2764|\u{1F389}|\u{1F44D}|\u{1F60D}|\u{1F970}/iu;
const shouting = (text: string) => { const letters = text.replace(/[^A-Za-z]/g, ""); return letters.length >= 8 && letters === letters.toUpperCase(); };
const feeling = (text: string) => putOut.test(text) || pleased.test(text) || shouting(text);
/* A reply this slow is worth a word on. */
const slowReply = 2 * 60_000;

/**
 * The answer worth a thumb, when one isn't given yet: the last one or the one before,
 * if what came after it sounds put out or pleased, or the last one if it took long.
 */
function askingFor(items: Item[], ratings: Record<number, 1 | -1>): number | null {
  const dones = items.flatMap((item, at) => item.type === "done" && !item.event.cancelled ? [at] : []);
  for (const [i, at] of dones.slice(-2).reverse().entries()) {
    const done = items[at] as Extract<Item, { type: "done" }>;
    if (ratings[done.seq]) continue;
    const next = items.findIndex((item, j) => j > at && item.type === "done");
    const after = items.slice(at + 1, next < 0 ? undefined : next);
    if (after.some((item) => item.type === "ask" && feeling(item.event.text))) return done.seq;
    if (i === 0 && (done.event.durationMs ?? 0) >= slowReply) return done.seq;
  }
  return null;
}

/** When something was said: the time today, the day and time this week, the date before that. */
function saidAt(at: number) {
  const when = new Date(at), now = new Date();
  const time = when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (when.toDateString() === now.toDateString()) return time;
  if (now.getTime() - at < 6 * 86_400_000) return `${when.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return `${when.toLocaleDateString(undefined, { day: "numeric", month: "short", year: when.getFullYear() === now.getFullYear() ? undefined : "numeric" })}, ${time}`;
}

/** Copies words, and says so for a moment in place of its icon. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="cd-iconbutton" aria-label={copied ? "Copied" : label} title={copied ? "Copied" : label}
    onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
    <Icon name={copied ? "check" : "copy"} />
  </button>;
}

function Done({ event, at, answer, rating, reply, asking, onRate }: { event: Extract<CodeEvent, { kind: "done" }>; at: number; answer: string; rating: 1 | -1 | null; reply?: { note: string; at: number }; asking: boolean; onRate: (rating: 1 | -1 | null, note?: string) => Promise<unknown> }) {
  const { me } = useContext(ViewerContext);
  /* A thumb holds as soon as it's given; then there's room to say why, and who sees it. */
  const [confirming, setConfirming] = useState<1 | -1 | null>(null);
  if (event.cancelled) return <p className="cd-note">Stopped.</p>;
  /* Which Claude answered, and how long it took. Never what it cost. */
  const facts = [event.model ? { fable: "Fable", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" }[event.model] : null, event.durationMs ? elapsed(event.durationMs) : null, saidAt(at)].filter(Boolean);
  const give = (next: 1 | -1) => {
    if (rating === next) void onRate(null).catch(() => { /* the thumb comes back as the server has it */ });
    else { void onRate(next).catch(() => { /* Send in the dialog tries again */ }); setConfirming(next); }
  };
  /* Shown on hover, with the facts; a thumb asked for or given stays. */
  const thumbs = me ? <span className={cx("cd-thumbs", asking && "is-asking", rating !== null && "is-given")}>
    {asking ? <span className="cd-thumbs-ask">How was this?</span> : null}
    <button type="button" className="cd-iconbutton" aria-label="Good answer" aria-pressed={rating === 1} title="Good answer" onClick={() => give(1)}><Icon name="thumb-up" /></button>
    <button type="button" className="cd-iconbutton" aria-label="Bad answer" aria-pressed={rating === -1} title="Bad answer" onClick={() => give(-1)}><Icon name="thumb-down" /></button>
  </span> : null;
  return <>
    {event.ok
      ? <div className="cd-note cd-done"><span className="cd-done-facts">{facts.join(" · ")}</span><span className="cd-done-acts">{answer.trim() ? <CopyButton text={answer.trim()} label="Copy answer" /> : null}{thumbs}</span></div>
      : <div className="cd-note cd-done is-failed" role="alert"><Icon name="close" /><span>{event.error || "It stopped with an error."}</span><span className="cd-done-facts">{saidAt(at)}</span><span className="cd-done-acts">{thumbs}</span></div>}
    {reply ? <div className="cd-thanks" role="note"><Icon name={rating === 1 ? "thumb-up" : "thumb-down"} /><span><b>Thank you for your feedback!</b>{reply.note ? <span className="cd-thanks-note">{reply.note}</span> : null}</span></div> : null}
    {confirming ? <RateDialog rating={confirming} onRate={onRate} onClose={() => setConfirming(null)} /> : null}
  </>;
}

/** Once a thumb is given: who sees it, and room to say why. */
function RateDialog({ rating, onRate, onClose }: { rating: 1 | -1; onRate: (rating: 1 | -1, note?: string) => Promise<unknown>; onClose: () => void }) {
  const box = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { box.current?.showModal(); }, []);
  const send = () => {
    setSending(true); setProblem(null);
    onRate(rating, note.trim() || undefined).then(() => box.current?.close(), (error) => { setSending(false); setProblem(problemText(error)); });
  };
  return <dialog ref={box} className="cd-share cd-report" aria-labelledby="cd-rate-title" onClose={onClose} onClick={(event) => { if (event.target === box.current) box.current?.close(); }}>
    <header><h2 id="cd-rate-title">{rating === 1 ? "Good answer" : "Bad answer"}</h2></header>
    <div className="cd-share-body">
      <p className="cd-rate-warn" role="note"><Icon name="people" /><span>Admins can see this answer and your feedback. Your name isn&rsquo;t attached.</span></p>
      <textarea autoFocus value={note} maxLength={2000} rows={3} placeholder={rating === 1 ? "What was good? (optional)" : "What went wrong? (optional)"} aria-label={rating === 1 ? "What was good?" : "What went wrong?"} onChange={(e) => setNote(e.target.value)} />
    </div>
    <footer>
      {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
      <span className="cd-grow" />
      <Seal type="button" compact tone="quiet" onClick={() => box.current?.close()}>Skip</Seal>
      <Seal type="button" compact disabled={sending} onClick={send}>{sending ? "Sending" : "Send"}</Seal>
    </footer>
  </dialog>;
}

/** Reports a whole chat: it goes with no name on it. */
function ReportChat({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const box = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"writing" | "sending" | "sent">("writing");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { box.current?.showModal(); }, []);
  const send = () => {
    setState("sending"); setProblem(null);
    code.report(workspace.id, reason).then(() => setState("sent"), (error) => { setState("writing"); setProblem(problemText(error)); });
  };
  return <dialog ref={box} className="cd-share cd-report" aria-labelledby="cd-report-title" onClose={onClose} onClick={(event) => { if (event.target === box.current) box.current?.close(); }}>
    <header><h2 id="cd-report-title">{state === "sent" ? "Reported" : `Report \u201c${workspace.title}\u201d`}</h2></header>
    <div className="cd-share-body">
      {state === "sent" ? <p className="cd-faint">Thanks. It was sent without your name.</p> : <>
        <p className="cd-rate-warn" role="note"><Icon name="people" /><span>Admins can see the whole chat. Your name isn&rsquo;t attached.</span></p>
        <textarea value={reason} maxLength={4000} rows={4} placeholder="What went wrong? (optional)" aria-label="What went wrong?" onChange={(e) => setReason(e.target.value)} />
      </>}
    </div>
    <footer>
      {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
      <span className="cd-grow" />
      {state === "sent"
        ? <Seal type="button" compact onClick={() => box.current?.close()}>Done</Seal>
        : <><Seal type="button" compact tone="quiet" onClick={() => box.current?.close()}>Cancel</Seal><Seal type="button" compact disabled={state === "sending"} onClick={send}>{state === "sending" ? "Sending" : "Send report"}</Seal></>}
    </footer>
  </dialog>;
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
  const owns = useOwns();
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
      {owns ? <button type="button" className="cd-quietbutton" disabled={stopping} aria-busy={stopping || undefined} onClick={() => { setStopping(true); code.stopPreview(workspace.id).catch((error) => { setProblem(problemText(error)); setStopping(false); }); }}><BusyFace busy={stopping}>Take down</BusyFace></button> : null}
    </div>
    {problem ? <p className="cd-problem" role="alert">{problem}</p> : null}
  </div></InkCard>;
}

/* ── asking for the person's Drive ── */

const whatOf = (e: { space: string; path: string; node?: string; file?: boolean }) => e.path
  ? <><DriveName space={e.space} node={e.file ? e.node : undefined}>{e.path.split("/").pop()}</DriveName> in <SpaceChip name={e.space} /></>
  : <SpaceChip name={e.space} />;

/** Kimono AI asking for some of the person's Drive, and how they answered. */
function AccessCard({ workspace, event, answer }: { workspace: Workspace; event: Extract<CodeEvent, { kind: "access" }>; answer?: Extract<CodeEvent, { kind: "access-answer" }> }) {
  const owns = useOwns();
  const ownerName = usePerson(useContext(ChatAccess).owner).name;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const verb = event.need === "change" ? "change" : "read";
  const who = owns ? "You" : ownerName;
  if (event.state === "missing") return <p className="cd-note cd-access-note"><DriveMark /><span>It asked for {whatOf(event)}, which isn&rsquo;t in {owns ? "your" : `${ownerName}\u2019s`} Drive.</span></p>;
  if (event.state === "auto") return <p className="cd-note cd-access-note"><DriveMark /><span>Opened {whatOf(event)} to {verb}, as {owns ? "you" : ownerName} allowed before.</span></p>;
  if (answer) {
    if (answer.state === "denied") return <p className="cd-note cd-access-note"><DriveMark /><span>{who} didn&rsquo;t let it {verb} {whatOf(event)}.</span></p>;
    const scope = answer.scope === "always" ? "from now on" : "in this chat";
    return <p className="cd-note cd-access-note"><DriveMark /><span>{who} let it {answer.need === "change" ? "read and change" : "read"} {answer.scope === "file" ? "one file from " : ""}{whatOf(event)} {scope}.</span></p>;
  }
  if (!owns) return <div className="cd-access" role="group" aria-label={`Kimono AI wants to ${verb} ${event.path || event.space}`}>
    <InkBlot className="cd-access-mark" tint={inkTint.quiet} seed={event.id}><DriveMark /></InkBlot>
    <div className="cd-access-id">
      <b>Kimono AI wants to {verb} {event.path ? <>{event.path.split("/").pop()} in </> : <>files in </>}{event.space}</b>
      <span>{event.why}</span>
    </div>
    <span className="cd-access-wait">Waiting for {ownerName}</span>
  </div>;
  const say = (choice: "file" | "chat" | "always" | "deny", file?: string) => {
    setBusy(choice); setProblem(null);
    code.answerAccess(workspace.id, event.id, choice, file).catch((error) => { setProblem(problemText(error)); setBusy(null); });
  };
  return <div className="cd-access" role="group" aria-label={`Kimono AI wants to ${verb} ${event.path || event.space}`}>
    <InkBlot className="cd-access-mark" tint={inkTint.quiet} seed={event.id}><DriveMark /></InkBlot>
    <div className="cd-access-id">
      <b>Kimono AI wants to {verb} {event.path ? <><DriveName space={event.space} node={event.file ? event.node : undefined}>{event.path.split("/").pop()}</DriveName> in </> : <>files in </>}<SpaceChip name={event.space} /></b>
      <span>{event.why}</span>
    </div>
    <div className="cd-access-acts">
      <Seal type="button" compact busy={busy === "chat"} disabled={busy !== null} onClick={() => say("chat")}>{event.file ? "Allow" : "Allow for this chat"}</Seal>
      {!event.file && event.node ? <button type="button" className="cd-quietbutton" disabled={busy !== null} onClick={() => setPicking((p) => !p)}>Only one file…</button> : null}
      <button type="button" className="cd-quietbutton" disabled={busy !== null} aria-busy={busy === "always" || undefined} onClick={() => say("always")}><BusyFace busy={busy === "always"}>Always allow</BusyFace></button>
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
    {items === null ? <InkLoader tone="plain" label="Looking" className="cd-morph cd-note-shape" /> : !items.length ? <p className="cd-note">Nothing here.</p> : items.map((item) =>
      <button key={item.id} type="button" className="cd-access-row" onClick={() => { if (item.kind === "folder") { setStack((s) => [...s, at]); setAt(item.id); } else onPick(item.id); }}>
        <Icon name={item.kind === "folder" ? "folder" : "file"} /><span>{item.name}</span>
      </button>)}
  </div>;
}

/* ── the composer: what to say next, and what to show it ── */

type Pending = { id: string; name: string; size: number; preview: string | null; video?: boolean; attachment?: Attachment; failed?: string };

function Composer({ workspace, running, blocked, context }: { workspace: Workspace; running: boolean; blocked: string | null; context: { used: number; window?: number } | null }) {
  const owns = useOwns();
  const [text, setText] = useUnsentText(workspace.id);
  const typed = useRef(text);
  useEffect(() => { typed.current = text; }, [text]);
  /* In a chat others are in, typing says so to them: once every few seconds while the words change. */
  const shared = (workspace.people?.length ?? 0) > 0 || (workspace.access !== undefined && workspace.access !== "owner");
  const lastSaid = useRef(0);
  const sayTyping = (value: string) => {
    if (!shared || !value.trim() || Date.now() - lastSaid.current < 2500) return;
    lastSaid.current = Date.now();
    void code.typing(workspace.id).catch(() => {});
  };
  const [pending, setPending] = useUnsent<Pending[]>(`${workspace.id}:files`, noPending);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const slash = useSlashMenu(text, setText, field);
  const picker = useRef<HTMLInputElement>(null);
  const [choosing, setChoosing] = useState(false);
  /* What the next message answers: words chosen in one of its answers. */
  const [quote, setQuote] = useState<string | null>(null);
  useEffect(() => {
    const take = (event: Event) => { setQuote((event as CustomEvent<string>).detail); requestAnimationFrame(() => field.current?.focus()); };
    window.addEventListener(quoteEvent, take);
    return () => window.removeEventListener(quoteEvent, take);
  }, []);
  /* A different model than the one this chat has been on has to take in the whole chat again. */
  const model = useModel();
  const switching = model !== "auto" && workspace.lastModel && model !== workspace.lastModel ? model : null;

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
    const fresh = files.slice(0, 10).map((file) => ({ file, item: { id: crypto.randomUUID(), name: file.name, size: file.size, ...localPreview(file) } as Pending }));
    setPending((list) => [...list, ...fresh.map((f) => f.item)].slice(0, 10));
    for (const { file, item } of fresh) {
      if (file.size > 20 * 1024 * 1024) { setPending((list) => list.map((p) => p.id === item.id ? { ...p, failed: "Over 20 MB" } : p)); continue; }
      code.attach(workspace.id, file).then(
        (attachment) => setPending((list) => list.map((p) => p.id === item.id ? { ...p, attachment } : p)),
        (error) => setPending((list) => list.map((p) => p.id === item.id ? { ...p, failed: problemText(error, "Didn't attach") } : p)),
      );
    }
  }, [workspace.id, setPending]);

  const usage = useUsage(workspace.id, running);
  const uploading = pending.some((p) => !p.attachment && !p.failed);
  const ready = pending.filter((p) => p.attachment).map((p) => p.attachment!);
  const canSend = !sending && !uploading && !blocked && (text.trim().length > 0 || ready.length > 0);

  async function send() {
    if (!canSend) return;
    setSending(true);
    setProblem(null);
    try {
      const said = text;
      await code.ask(workspace.id, quote && said.trim() ? withQuote(quote, said) : said, ready, effortNow());
      /* Words typed while it was sending stay. */
      if (typed.current === said) { setText(""); setQuote(null); }
      forget(pending.map((p) => p.preview));
      setPending([]);
    } catch (error) { setProblem(problemText(error)); } finally {
      setSending(false);
      /* On a computer the cursor stays for the next line; on a phone sending puts the keyboard away so the answer can be read. */
      if (onTouch()) field.current?.blur(); else field.current?.focus();
    }
  }

  /* Files let go of anywhere on the chat are attached to the next message. */
  useFileDrop(blocked ? null : { label: "Drop to attach", onDrop: (data) => add(filesIn(data)) });

  return <div className="cd-composer">
    {pending.length ? <div className="cd-pending">{pending.map((p) => p.preview
      ? <PendingMedia key={p.id} name={p.name} url={p.preview} video={p.video} sending={!p.attachment && !p.failed} failed={p.failed} onRemove={() => { forget([p.preview]); setPending((list) => list.filter((x) => x.id !== p.id)); }} />
      : <span key={p.id} className={cx("cd-filechip", !p.attachment && !p.failed && "is-sending", p.failed && "is-failed")}>
      <FileThumb name={p.name} size={30} />
      <span>{p.name}</span>
      <small>{p.failed ?? (p.attachment ? readableSize(p.size) : <InkLoader tone="plain" label="Attaching" className="cd-morph" />)}</small>
      <button type="button" aria-label={`Remove ${p.name}`} onClick={() => { forget([p.preview]); setPending((list) => list.filter((x) => x.id !== p.id)); }}><Icon name="close" /></button>
    </span>)}</div> : null}
    {switching && workspace.lastModel ? <p className="cd-switching" role="status">This chat has been on {modelWords[workspace.lastModel].label}. Switching to {modelWords[switching].label} uses more of your plan.</p> : null}
    {problem ? <p className="cd-problem cd-entry-problem" role="alert">{problem}</p> : null}
    {quote ? <div className="cd-quote"><Icon name="reply" /><span>{quote}</span><button type="button" aria-label="Don't reply to this" onClick={() => setQuote(null)}><Icon name="close" /></button></div> : null}
    {/* As in any chat app: attach beside the words, Send at their end, on one line; as the words grow, both stay on their last line. */}
    <div className="cd-entry">
      <input ref={picker} type="file" multiple hidden onChange={(event) => { add([...(event.target.files ?? [])]); event.target.value = ""; }} />
      <AttachMenu disabled={Boolean(blocked)} onDevice={() => picker.current?.click()} onDrive={workspace.drive ? () => setChoosing(true) : undefined} />
      {slash.menu}
      {slash.wrap(<textarea ref={field} value={text} rows={1} aria-label="Message" maxLength={maxMessage} onScroll={slash.follow}
        placeholder={blocked ? blocked : "Ask for a change, or reply"}
        disabled={Boolean(blocked)}
        onChange={(event) => { setText(event.target.value); sayTyping(event.target.value); }}
        onPaste={(event) => { const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); add(files); } }}
        onKeyDown={(event) => { if (slash.onKeyDown(event)) return; if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />)}
      <div className="cd-entry-end">
        <MessageCount length={text.length} />
        {/* files, model and thinking, and all usage, in the … menu; the rings only past half */}
        <Meters workspace={workspace} usage={usage} context={context} running={running} blocked={blocked} />
        <ComposerMore workspace={workspace} usage={usage} context={context} running={running} blocked={blocked} files={Boolean(workspace.drive && owns)} />
        <Dictation disabled={Boolean(blocked) || sending} onProblem={setProblem} onText={(said) => { setText(joinSaid(typed.current, said)); requestAnimationFrame(() => field.current?.focus()); }} />
        <SendStop mode={running && !canSend && !text.trim() && !pending.length ? "stop" : "send"} disabled={running && !text.trim() && !pending.length ? false : !canSend}
          onSend={() => void send()} onStop={() => void code.stop(workspace.id).catch((error) => setProblem(problemText(error)))} />
      </div>
    </div>
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
          return { ...p, attachment, preview: attachment && isMedia(attachment) ? code.attachmentUrl(workspace.id, attachment) : null, video: Boolean(attachment && isVideo(attachment)) };
        }));
      } catch (error) {
        setPending((list) => list.map((p) => shown.some((s) => s.id === p.id) ? { ...p, failed: problemText(error, "Didn't attach") } : p));
      }
    }} /> : null}
  </div>;
}

type AccessMode = "ask" | "read" | "change";
const accessWords: Record<AccessMode, { label: string; detail: string }> = {
  ask: { label: "Asks first", detail: "Asks before opening your files" },
  read: { label: "Reads", detail: "Reads your files without asking" },
  change: { label: "Reads and edits", detail: "Reads and edits your files without asking" },
};
/** The one mode a set of spaces adds up to: the least any of them allows. */
function accessMode(settings: AccessSettings): AccessMode {
  const spaces = settings.spaces;
  if (!spaces.length || spaces.some((s) => !s.auto)) return "ask";
  return spaces.every((s) => s.auto === "change" || !s.canChange) && spaces.some((s) => s.auto === "change") ? "change" : "read";
}

/** What Kimono AI may do with Drive without asking, as a compact chip in the message box. */
function AccessPicker() {
  const [settings, setSettings] = useState<AccessSettings | null>(null);
  const load = useCallback(() => code.access().then(setSettings, () => {}), []);
  useEffect(() => { void load(); }, [load]);
  if (!settings?.spaces.length) return null;
  const set = (mode: AccessMode) => {
    const next = settings.spaces.map((s) => ({ ...s, auto: mode === "ask" ? null : mode === "change" && s.canChange ? "change" as const : "read" as const }));
    setSettings({ ...settings, spaces: next });
    Promise.all(next.map((s) => code.setSpaceAccess(s.id, s.auto))).catch(() => void load());
  };
  const offered: AccessMode[] = settings.spaces.some((s) => s.canChange) ? ["ask", "read", "change"] : ["ask", "read"];
  return <Choice compact aria-label="What it may do with your files" className="cd-accessmode" value={accessMode(settings)} onChange={(next) => set(next as AccessMode)}
    options={offered.map((m) => ({ value: m, label: accessWords[m].label, detail: accessWords[m].detail }))} />;
}

/** One attach button: a menu of where the files come from, or straight to the device when there's no Drive. */
/* ── the / menu: the commands of the skills a person turned on ── */

let commandsLoaded: Promise<SkillChoice[]> | null = null;

/**
 * Typing "/" at the start of a message lists the commands of the skills that
 * are on (For you), filtered as more is typed. Arrow keys move, Enter
 * or Tab picks one into the box, Escape closes it. A command at the start of
 * the box is marked: a layer under the (then see-through) words draws them
 * with the command picked out, bold by a shadow so no letter moves from
 * under the cursor.
 */
function useSlashMenu(text: string, setText: (text: string) => void, field: React.RefObject<HTMLTextAreaElement | null>) {
  const [commands, setCommands] = useState<NonNullable<SkillChoice["command"]>[]>([]);
  const [at, setAt] = useState(0);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const typed = /^\/([a-z-]*)$/.exec(text)?.[1];
  useEffect(() => {
    if (!text.startsWith("/") || commands.length) return;
    commandsLoaded ??= code.skills().catch(() => { commandsLoaded = null; return []; });
    void commandsLoaded.then((list) => setCommands(list.filter((s) => s.enabled && s.command).map((s) => s.command!)));
  }, [text.startsWith("/"), commands.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = typed === undefined || closedFor === text ? [] : commands.filter((c) => c.name.startsWith(typed));
  const pick = (name: string) => {
    setText(`/${name} `);
    setAt(0);
    /* After React has put the words in: the cursor goes to their end, ready for what follows. */
    requestAnimationFrame(() => { const box = field.current; if (!box) return; box.focus(); box.setSelectionRange(box.value.length, box.value.length); });
  };
  const under = useRef<HTMLDivElement>(null);
  const named = /^\/([a-z0-9-]+)(?=\s|$)/.exec(text)?.[1];
  const marked = named && commands.some((c) => c.name === named) ? `/${named}` : null;
  const follow = () => { if (under.current && field.current) under.current.scrollTop = field.current.scrollTop; };
  /* Words that grow taller than the box scroll it; the layer under them follows. */
  useEffect(follow, [text]);
  const wrap = (box: React.ReactNode) => <div className={cx("cd-typed", marked && "is-marked")}>
    {marked ? <div ref={under} className="cd-typed-under" aria-hidden="true"><mark>{marked}</mark>{text.slice(marked.length)}{"\u200b"}</div> : null}
    {box}
  </div>;
  const onKeyDown = (event: React.KeyboardEvent): boolean => {
    if (!shown.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setAt((i) => (i + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length); return true; }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") { event.preventDefault(); pick(shown[Math.min(at, shown.length - 1)].name); return true; }
    if (event.key === "Escape") { event.preventDefault(); setClosedFor(text); return true; }
    return false;
  };
  const menu = shown.length ? <div className="cd-attach-menu cd-slash-menu" role="listbox" aria-label="Commands">
    {shown.map((c, i) => <button key={c.name} type="button" role="option" aria-selected={i === Math.min(at, shown.length - 1)} className={cx(i === Math.min(at, shown.length - 1) && "is-on")}
      onPointerDown={(event) => event.preventDefault()} onClick={() => pick(c.name)}>
      <b>/{c.name}{c.hint ? <i> {c.hint}</i> : null}</b><small>{c.does}</small>
    </button>)}
  </div> : null;
  return { menu, onKeyDown, wrap, follow };
}

function AttachMenu({ disabled, onDevice, onDrive }: { disabled: boolean; onDevice: () => void; onDrive?: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    root.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const go = (then: () => void) => { setOpen(false); then(); };
  const step = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };
  return <div className="cd-attach" ref={root}>
    <button type="button" className={cx("cd-iconbutton", open && "is-on")} aria-label="Attach files" title="Attach files" disabled={disabled}
      aria-haspopup={onDrive ? "menu" : undefined} aria-expanded={onDrive ? open : undefined}
      onClick={() => (onDrive ? setOpen(!open) : onDevice())}><Icon name="clip" /></button>
    {open && onDrive ? <div className="cd-attach-menu" role="menu" aria-label="Attach files" onKeyDown={step}>
      <button type="button" role="menuitem" onClick={() => go(onDevice)}><Icon name="device" />From your device</button>
      <button type="button" role="menuitem" onClick={() => go(onDrive)}><Icon name="folder" />From Drive</button>
    </div> : null}
  </div>;
}

/** Files from Drive: spaces, then folders, then files to tick. */
function DrivePicker({ onClose, onPick }: { onClose: () => void; onPick: (items: DriveItem[]) => void }) {
  const box = useRef<HTMLDialogElement>(null);
  const [spaces, setSpaces] = useState<DriveSpace[] | null>(null);
  const [at, setAt] = useState<{ folder: DriveItem; path: DriveItem[]; children: DriveItem[] } | null>(null);
  const [chosen, setChosen] = useState<Map<string, DriveItem>>(new Map());
  const [problem, setProblem] = useState<string | null>(null);
  const [peek, setPeek] = useState<DriveItem | null>(null);
  const [inSpace, setInSpace] = useState<DriveSpace | null>(null);
  /* Escape closes the preview first; the dialog stays. */
  const peeking = useRef(false);
  const showPeek = (item: DriveItem | null) => { setPeek(item); if (item) peeking.current = true; else setTimeout(() => { peeking.current = false; }, 0); };
  useEffect(() => { box.current?.showModal(); }, []);
  useEffect(() => { drive.spaces().then(setSpaces, (error) => setProblem(problemText(error))); }, []);
  /* Only the folder asked for last is shown: a slow answer for an earlier one is dropped. */
  const wanted = useRef<string | null>(null);
  const open = (id: string) => { wanted.current = id; return drive.folder(id).then((f) => { if (wanted.current !== id) return; setAt(f); setProblem(null); }, (error) => { if (wanted.current === id) setProblem(problemText(error)); }); };
  const toggle = (item: DriveItem) => setChosen((m) => { const next = new Map(m); if (next.has(item.id)) next.delete(item.id); else if (next.size < 10) next.set(item.id, item); return next; });

  return <dialog ref={box} className="cd-drivepick" aria-labelledby="cd-drivepick-title" onClose={onClose} onCancel={(event) => { if (peeking.current) event.preventDefault(); }} onClick={(event) => { if (event.target === box.current) box.current?.close(); }}>
    <header>
      <h2 id="cd-drivepick-title">From Drive</h2>
      {at ? <nav className="cd-drivepick-path" aria-label="Folder">
        <button type="button" onClick={() => { wanted.current = null; setAt(null); setInSpace(null); }}>Spaces</button>
        {[...at.path, at.folder].map((step, n, all) => <span key={step.id}><Icon name="chevron" /><button type="button" aria-current={n === all.length - 1 ? "location" : undefined} onClick={() => void open(step.id)}>{n === 0 && inSpace?.mark ? <span className="cd-crest" aria-hidden="true" dangerouslySetInnerHTML={{ __html: inSpace.mark }} /> : null}{n === 0 && inSpace ? inSpace.name : step.name}</button></span>)}
      </nav> : null}
    </header>
    <Scroller fit className="cd-drivepick-scroll" viewClassName="cd-scroll-view"><ul>
      {!at ? (spaces ?? []).map((space) => <li key={space.id}><button type="button" onClick={() => { setInSpace(space); void open(space.rootId); }}>{space.mark ? <span className="cd-crest" aria-hidden="true" dangerouslySetInnerHTML={{ __html: space.mark }} /> : <Icon name="space" />}<span className="cd-drivepick-name">{space.name}</span><Icon name="chevron" /></button></li>)
        : at.children.map((item) => item.kind === "folder"
          ? <li key={item.id}><button type="button" onClick={() => void open(item.id)}><Icon name="folder" /><span className="cd-drivepick-name">{item.name}</span><Icon name="chevron" /></button></li>
          : <li key={item.id} className={cx("cd-drivepick-file", chosen.has(item.id) && "is-chosen")}>
            <label><FileThumb name={item.name} size={48} picture={pictureExtensions.has(lowerExtension(item.name)) ? `/api/v1/drive/nodes/${encodeURIComponent(item.id)}/thumb?w=256` : null} /><span className="cd-drivepick-name">{item.name}<small>{readableSize(item.size)}</small></span><input type="checkbox" checked={chosen.has(item.id)} onChange={() => toggle(item)} /></label>
            {previewable(item.name, item.mime) ? <button type="button" className="cd-drivepick-peek" aria-label={`Preview ${item.name}`} title="Preview" onClick={() => showPeek(item)}><Icon name="expand" /></button> : null}
          </li>)}
      {spaces === null && !problem ? <li className="cd-drivepick-note" aria-busy="true"><span className="cd-drivepick-wait" /></li> : null}
      {(at && !at.children.length) || (!at && spaces?.length === 0) ? <li className="cd-drivepick-note">Nothing here.</li> : null}
    </ul></Scroller>
    <footer>
      {problem ? <span className="cd-problem">{problem}</span> : chosen.size ? <span className="cd-drivepick-count">{chosen.size} chosen</span> : null}
      <span className="cd-grow" />
      <Seal type="button" compact tone="quiet" onClick={() => box.current?.close()}>Cancel</Seal>
      <Seal type="button" compact disabled={!chosen.size} onClick={() => onPick([...chosen.values()])}>Add</Seal>
    </footer>
    {peek ? <FileOverlay into={box.current} name={peek.name} mime={peek.mime} url={`/api/v1/drive/nodes/${encodeURIComponent(peek.id)}/content`} onClose={() => showPeek(null)}
      picture={pictureExtensions.has(lowerExtension(peek.name)) ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/v1/drive/nodes/${encodeURIComponent(peek.id)}/thumb?w=1280`} alt={peek.name} decoding="async" /> : undefined}
      actions={<Seal type="button" compact tone={chosen.has(peek.id) ? "quiet" : undefined} onClick={() => toggle(peek)}>{chosen.has(peek.id) ? "Chosen" : "Choose"}</Seal>} /> : null}
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
          <TypeMark name={entry.name} fallback={<Icon name="file" />} /><span>{entry.name}</span>
        </button>
      </li>;
    });
  };

  return <div className="cd-files">
    <Scroller as="nav" className="cd-tree" viewClassName="cd-tree-view" aria-label="Files"><ul>{render("", 0)}</ul></Scroller>
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
        : "picture" in state ? <FilePreview name={path} url={state.picture} mime="image/*" className="cd-file-preview" />
          : "binary" in state ? <p className="cd-quiet cd-pad">Not a text file · {readableSize(state.binary)}</p>
            : <FilePreview name={path} text={state.text} className="cd-file-preview" />}
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

  return <Scroller className="cd-changes-box" viewClassName="cd-changes">
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
          ? <Scroller fit as="pre" tone="lift" viewClassName="cd-lacquer cd-difflines">{diff.lines.map((line, n) => {
            const kind = line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
            return <span key={n} className="cd-line" data-kind={kind}><i aria-hidden="true">{kind === "add" ? "+" : kind === "del" ? "−" : ""}</i>{kind === "hunk" ? line : line.slice(1) || " "}</span>;
          })}</Scroller>
          : <p className="cd-quiet cd-pad">No text to show.</p> : null}
      </section>;
    })}
    {changes.truncated ? <p className="cd-quiet cd-pad">The rest is too long to show here.</p> : null}
  </Scroller>;
}

/* ── opened by a link: a chat without signing in, or one artifact on its own page ── */

/** A chat opened by its link by someone not signed in: the conversation alone, to read. */
export function GuestChat({ token, id, owner, ownerName }: { token: string; id: string; owner: string; ownerName: string }) {
  /* Before anything below asks for the chat, every call carries the link. */
  useState(() => { setShareLink(token); return token; });
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(() => code.workspace(id).then((w) => { setWorkspace(w); setProblem(null); }, (error) => setProblem(problemText(error))), [id]);
  useEffect(() => { void load(); }, [load]);
  const now = useNow(workspace?.turn?.state === "running");
  const viewer = useMemo<Viewer>(() => ({ me: null, guest: true, people: new Map([[owner.toLowerCase(), { username: owner, name: ownerName, picture: null }]]) }), [owner, ownerName]);
  const marks = useMemo<Marks>(() => ({ drive: null, spaces: new Map() }), []);
  return <ViewerContext.Provider value={viewer}><MarksContext.Provider value={marks}><div className="cd-page">
    <div className="cd cd-guest has-workspace">
      <main className="cd-main">
        {workspace ? <WorkspaceView workspace={workspace} projects={[]} others={[]} tab="chat" path="" blocked={null} onChange={() => void load()} now={now} />
          : problem ? <div className="cd-sheet cd-empty"><p>{problem}</p></div>
          : <div className="cd-sheet cd-loading"><div className="cd-timeline"><SkeletonChat /></div></div>}
      </main>
    </div>
  </div></MarksContext.Provider></ViewerContext.Provider>;
}

