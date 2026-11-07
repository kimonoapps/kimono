import { artifactName, editsOf, shownName, type Edit } from "./artifacts";

/*
 * What a workspace's timeline is made of. The node streams Claude Code's own
 * stream-json lines; they are turned into these few kinds before they are
 * stored, so the web page and the phone app read one small vocabulary and
 * neither has to know Claude Code's format.
 */

export type Attachment = { name: string; path: string; size: number; type: string };

export type CodeEvent =
  | { kind: "ask"; by: string; text: string; attachments: Attachment[]; /** Sent while the agent was working: it reads it as soon as the current step ends. */ queued?: boolean }
  | { kind: "started" }
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; label: string; detail?: string; change?: string; /** A person's own app it used through Composio, by toolkit slug ("gmail"). */ app?: string; /** The Drive space it worked in, when it touched /files/<space>. */ space?: string; /** It ran on one of Composio's own accounts: a Pro Tool, charged to the person's allowance. */ pro?: boolean; /** The Composio tools it ran ("HIGGSFIELD_GENERATE_VIDEO"), to find what each cost. */ tools?: string[]; /** A kimono-progress call: the steps of a long piece of work show as one card with a bar. */ progress?: ToolProgress }
  | { kind: "tool-result"; id: string; ok: boolean; output: string }
  /** What a Pro Tool call cost, in US dollars, as Composio charged it; read a moment after it answered. */
  | { kind: "tool-cost"; id: string; usd: number }
  | { kind: "done"; ok: boolean; cancelled?: boolean; error?: string; costUsd?: number; durationMs?: number; /** Which Claude answered. */ model?: "opus" | "sonnet" | "haiku"; /** How full the agent's context was at the end, in tokens, and of how many. */ context?: { used: number; window?: number } }
  | { kind: "compacted"; before?: number }
  | { kind: "published"; url: string; number: number }
  | { kind: "image"; name: string; caption?: string }
  | { kind: "preview"; url: string; port: number; /** What kind of app it is: "Node API with SQLite", "Static site". */ app?: string }
  | { kind: "preview-stopped" }
  /** Put to sleep to make room for another task; its files and link stay. */
  | { kind: "slept"; for: string }
  /** The sandbox's files reached its disk quota; full is a turn stopped for going past it. */
  | { kind: "disk"; used: number; quota: number; full?: boolean }
  /**
   * The agent asked for some of the person's Drive. "pending" waits for them; "auto" was already
   * allowed (always, or earlier in this chat); "missing" names something that isn't there.
   */
  | { kind: "access"; id: string; space: string; path: string; need: "read" | "change"; why: string; file: boolean; state: "pending" | "auto" | "missing"; /** The Drive folder or file asked for, so the person can pick one file in it. */ node?: string }
  /** Something it kept about the person for future chats (kimono-remember). */
  | { kind: "remembered"; text: string; /** It changed a memory, or forgot one. */ how?: "changed" | "forgot" }
  /** An artifact it wrote or changed (/workspace/artifacts/<name>.html), or showed again with kimono-show. */
  | { kind: "artifact"; id: string; name: string; action: "wrote" | "edited" | "shown" }
  /** Kimono kept a new version of an artifact: pages showing it load it again. */
  | { kind: "artifact-saved"; name: string; version: number; title: string }
  /** Never stored: what it is writing right now, sent to whoever is watching. */
  | { kind: "draft"; text: string }
  /** Never stored: the chat got its name, so lists showing it load again. */
  | { kind: "renamed"; title: string }
  /** Never stored: a message was changed, so the chat from it on went; whoever is watching loads it again. */
  | { kind: "rewound"; seq: number }
  | { kind: "artifact-draft"; id: string; name: string; content: string }
  /** Never stored: what it is doing right now, so the status at the end of the chat can say so. */
  | { kind: "phase"; phase: "working" | "thinking" | "writing" | "tools" | "artifact"; /** What sort of tool, when it's one of these. */ tool?: "web" | "command" | "files" | "helper"; app?: string; space?: string }
  /** Files it gave the person with kimono-send, kept by Kimono to open and download. */
  | { kind: "sent"; files: Attachment[] }
  /** An app of theirs needs connecting: Kimono shows a Connect button for this Composio link. */
  | { kind: "connect"; app: string; url: string }
  /** How the person answered an access request. */
  | { kind: "access-answer"; id: string; state: "allowed" | "denied"; scope?: "file" | "chat" | "always"; need?: "read" | "change" };

const clip = (value: string, max: number) => value.length > max ? `${value.slice(0, max)}\n…` : value;

/** What a write or an edit changed, as diff lines ("+ added", "- removed"), so a tool call can be opened to see it. */
function toolChange(name: string, input: Record<string, unknown>): string | undefined {
  const lines = (value: unknown, mark: string) => typeof value === "string" && value ? value.split("\n").map((line) => `${mark} ${line}`) : [];
  const pair = (edit: Record<string, unknown>) => [...lines(edit.old_string, "-"), ...lines(edit.new_string, "+")];
  const change = name === "Write" ? lines(input.content, "+")
    : name === "Edit" ? pair(input)
    : name === "MultiEdit" && Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]).flatMap((edit, index) => [...(index ? ["…"] : []), ...pair(edit)])
    : name === "NotebookEdit" ? lines(input.new_source, "+")
    : [];
  return change.length ? clip(change.join("\n"), 3000) : undefined;
}

/** The one argument worth showing beside a tool: the file it touched, the command it ran, what it searched for. */
/**
 * What a kimono-progress call says (infra/sandbox/bin/kimono-progress): it began something long (what, about how
 * many seconds), it's waiting, or it's done; with when Kimono heard it, so the bar keeps time across reloads.
 */
export type ToolProgress = { label?: string; about?: number; wait?: number; done?: boolean; /** What the tool last said ("In queue", "Rendering"), with its percent done or seconds left when it gave them. */ status?: string; percent?: number; left?: number; at: number };

export function progressOf(command: unknown, at = Date.now()): ToolProgress | undefined {
  if (typeof command !== "string") return undefined;
  const call = /^\s*kimono-progress\s+([\s\S]*)$/.exec(command.trim());
  if (!call) return undefined;
  const rest = call[1].trim();
  if (rest.startsWith("--done")) return { done: true, at };
  const status = /^--status\s+(["'])([\s\S]*?)\1((?:\s+--(?:percent|left)\s+\d+(?:\.\d+)?)*)\s*$/.exec(rest);
  if (status && status[2].trim()) {
    const percent = /--percent\s+(\d+(?:\.\d+)?)/.exec(status[3]), left = /--left\s+(\d+(?:\.\d+)?)/.exec(status[3]);
    return { status: status[2].trim().slice(0, 60), ...(percent ? { percent: Math.min(100, Number(percent[1])) } : {}), ...(left ? { left: Math.min(3600, Number(left[1])) } : {}), at };
  }
  const wait = /^--wait\s+(\d+(?:\.\d+)?)/.exec(rest);
  if (wait) return { wait: Math.min(100, Number(wait[1])), at };
  const start = /^(["'])([\s\S]*?)\1\s+--about\s+(\d+(?:\.\d+)?)/.exec(rest);
  if (start && start[2].trim()) return { label: start[2].trim().slice(0, 80), about: Math.min(3600, Math.max(5, Number(start[3]))), at };
  return undefined;
}

function toolLabel(name: string, input: Record<string, unknown>): { label: string; detail?: string; change?: string; app?: string; space?: string; tools?: string[] } {
  if (name.startsWith("mcp__composio__")) return composioLabel(name.slice("mcp__composio__".length), input);
  const change = toolChange(name, input);
  const named = toolName(name, input);
  const space = spaceOf(JSON.stringify(input));
  return { ...named, ...(change ? { change } : {}), ...(space ? { space } : {}) };
}

/** What a tool call is about, for the status while it runs: the app, the Drive space, or what sort of step. */
export function toolHint(name: string, input: Record<string, unknown>): { tool?: "web" | "command" | "files" | "helper"; app?: string; space?: string } {
  const { app, space } = toolLabel(name, input);
  if (app) return { app };
  /* Only a name that reads as a space's: a glob or a shell line after /files/ is not one. */
  if (space && /^[\p{L}\p{N} ._'()-]{1,60}$/u.test(space)) return { space };
  if (space) return { tool: "files" };
  const tool = name === "WebSearch" || name === "WebFetch" ? "web"
    : name === "Bash" ? "command"
    : ["Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Grep", "Glob"].includes(name) ? "files"
    : name === "Task" || name === "Agent" ? "helper" : undefined;
  return tool ? { tool } : {};
}

/** The Drive space a call worked in: the first /files/<space>/ it names (or /workspace/.kimono/files/<space>/). */
export function spaceOf(text: string): string | undefined {
  /* A space's name may have spaces in it: up to the next slash when there is one, else up to a quote or a space. */
  const found = /(?:^|[\s"'=(:])(?:\/workspace\/\.kimono)?\/files\/(?:([^/"'\n\\]+)\/|([^/"'\s\\]+))/.exec(text);
  const name = found?.[1] ?? found?.[2];
  return name ? name.trim().slice(0, 120) || undefined : undefined;
}

/*
 * Composio's own tools (docs/kimono-ai.md, "People's own apps"). Kimono knows
 * no toolkit: the app is whatever toolkit the call names, from a tool slug
 * such as GMAIL_SEND_EMAIL or a toolkit field, wherever it sits in the input.
 */
const toolSlug = /^([A-Z][A-Z0-9]*)_[A-Z0-9_]+$/;
function slugsIn(value: unknown, out: { tools: string[]; toolkits: string[]; text?: string }, depth = 0) {
  if (depth > 6 || value == null) return out;
  if (typeof value === "string") {
    if (toolSlug.test(value) && !value.startsWith("COMPOSIO_")) out.tools.push(value);
    return out;
  }
  if (Array.isArray(value)) { for (const item of value) slugsIn(item, out, depth + 1); return out; }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/^toolkits?(_slugs?)?$|^toolkit_slug$|^app(_name)?$/.test(key)) {
        for (const t of Array.isArray(item) ? item : [item]) if (typeof t === "string" && /^[a-z0-9_-]{2,60}$/i.test(t)) out.toolkits.push(t.toLowerCase());
      } else if (!out.text && /^(use_case|query|thought)$/.test(key) && typeof item === "string") {
        out.text = item;
      } else slugsIn(item, out, depth + 1);
    }
  }
  return out;
}
/** GMAIL_SEND_EMAIL → "send email". */
const action = (slug: string) => slug.slice(slug.indexOf("_") + 1).toLowerCase().replace(/_/g, " ");

function composioLabel(meta: string, input: Record<string, unknown>): { label: string; detail?: string; app?: string; tools?: string[] } {
  const found = slugsIn(input, { tools: [], toolkits: [] });
  const app = found.toolkits[0] ?? (found.tools[0] ? toolSlug.exec(found.tools[0])![1].toLowerCase() : undefined);
  const withApp = app ? { app } : {};
  const ran = found.tools.length ? { tools: [...new Set(found.tools.map((t) => t.toUpperCase()))].slice(0, 20) } : {};
  switch (meta) {
    case "COMPOSIO_MULTI_EXECUTE_TOOL": return { label: "Used", detail: [...new Set(found.tools.map(action))].join(", ") || undefined, ...withApp, ...ran };
    case "COMPOSIO_SEARCH_TOOLS": return { label: "Looked for a way to", detail: found.text ? clip(found.text, 200) : undefined, ...withApp };
    case "COMPOSIO_MANAGE_CONNECTIONS": case "COMPOSIO_WAIT_FOR_CONNECTIONS": return { label: "Connecting", ...withApp };
    case "COMPOSIO_GET_TOOL_SCHEMAS": return { label: "Read how to use", detail: [...new Set(found.tools.map(action))].join(", ") || undefined, ...withApp };
    default: {
      /* A toolkit's own tool, called directly: GMAIL_SEND_EMAIL. */
      const direct = toolSlug.exec(meta);
      if (direct && !meta.startsWith("COMPOSIO_")) return { label: "Used", detail: action(meta), app: direct[1].toLowerCase(), tools: [meta.toUpperCase()] };
      return { label: meta.replace(/^COMPOSIO_/, "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()), ...withApp };
    }
  }
}

function toolName(name: string, input: Record<string, unknown>): { label: string; detail?: string } {
  const text = (key: string) => typeof input[key] === "string" ? input[key] as string : undefined;
  const path = text("file_path") ?? text("path") ?? text("notebook_path");
  const short = (value: string) => value.replace(/^\/workspace\/?/, "") || ".";
  switch (name) {
    case "Bash": return { label: "Ran", detail: clip(text("command") ?? "", 400) };
    case "Read": return { label: "Read", detail: path && short(path) };
    case "Write": return { label: "Wrote", detail: path && short(path) };
    case "Edit": case "MultiEdit": case "NotebookEdit": return { label: "Edited", detail: path && short(path) };
    case "Grep": return { label: "Searched for", detail: text("pattern") };
    case "Glob": return { label: "Looked for", detail: text("pattern") };
    case "WebFetch": return { label: "Fetched", detail: text("url") };
    case "WebSearch": return { label: "Searched the web for", detail: text("query") };
    case "TodoWrite": return { label: "Updated its plan" };
    case "Task": case "Agent": return { label: "Asked a helper", detail: text("description") };
    default: return { label: name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " "), detail: path && short(path) };
  }
}

/** A call that writes, edits or shows an artifact: it becomes the artifact's card instead of a tool row. */
function artifactCall(id: string, name: string, input: Record<string, unknown>): ArtifactCall | null {
  if (name === "Write") { const found = artifactName(input.file_path); return found ? { id, name: found, action: "wrote", content: typeof input.content === "string" ? input.content : "" } : null; }
  if (name === "Edit" || name === "MultiEdit") { const found = artifactName(input.file_path); return found ? { id, name: found, action: "edited", edits: editsOf(name, input) } : null; }
  if (name === "Bash") { const found = shownName(input.command); return found ? { id, name: found, action: "shown" } : null; }
  return null;
}

/**
 * Tool calls the person never needs to see: Claude Code loading its own tools,
 * and Composio's finding, describing and connecting (a connection shows as its
 * own Connect card instead). What it then does with an app still shows.
 */
const hidden = new Set(["ToolSearch", "COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_WAIT_FOR_CONNECTIONS"]);
export function hiddenTool(name: string) { return hidden.has(name.replace(/^mcp__composio__/, "")); }

/** Composio's connect links in a tool's result: { app, url } for each app it started connecting. Only Composio's own https links. */
export function connectLinks(text: string): { app: string; url: string }[] {
  if (!text.includes("redirect_url")) return [];
  let data: unknown;
  try { data = JSON.parse(text); } catch { return []; }
  const found: { app: string; url: string }[] = [];
  const visit = (value: unknown, key: string, depth: number) => {
    if (depth > 6 || !value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (typeof item.redirect_url === "string") {
      try {
        const url = new URL(item.redirect_url);
        const app = typeof item.toolkit === "string" ? item.toolkit : key;
        if (url.protocol === "https:" && /(^|\.)composio\.dev$/.test(url.hostname) && /^[a-z0-9_-]{2,60}$/i.test(app) && !found.some((f) => f.url === url.href)) found.push({ app: app.toLowerCase(), url: url.href });
      } catch { /* not a link */ }
    }
    for (const [k, v] of Object.entries(item)) visit(v, k, depth + 1);
  };
  visit(data, "", 0);
  return found.slice(0, 5);
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text) : "").join("\n");
  return "";
}

export type TurnResult = { failure?: string; costUsd?: number; durationMs?: number; window?: number };
/** `context` is what the agent's latest message held: its input, plus what it read from and wrote to the cache. */
export type ArtifactCall = { id: string; name: string; action: "wrote" | "edited" | "shown"; content?: string; edits?: Edit[] };
/** A file kimono-send copied aside for the person: its name, and where it is under /workspace. */
export type SentFile = { name: string; path: string };

export type Translated = { events: CodeEvent[]; session?: string; result?: TurnResult; context?: number; artifacts?: ArtifactCall[]; sent?: SentFile[] };

/** The files a kimono-send in this output gave the person, and the output without the line that says so. */
export function sentFiles(text: string): { files: SentFile[]; shown: string } {
  const files: SentFile[] = [];
  const shown = text.split("\n").filter((line) => {
    const found = /^kimono-sent (\[.*\])\s*$/.exec(line);
    if (!found) return true;
    try {
      for (const f of JSON.parse(found[1]) as unknown[]) {
        const { name, path } = (f ?? {}) as { name?: unknown; path?: unknown };
        /* Only what the helper itself makes: a copy under .kimono/sent. */
        if (typeof name === "string" && typeof path === "string" && /^\.kimono\/sent\/[0-9a-f]{8}-[^/]+$/.test(path) && files.length < 10) files.push({ name: name.slice(0, 200), path });
      }
    } catch { /* not ours */ }
    return false;
  }).join("\n");
  return { files, shown };
}

const tokens = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
function contextOf(message: Record<string, unknown>): number | undefined {
  const usage = (message.message as { usage?: Record<string, unknown> } | undefined)?.usage;
  if (!usage) return undefined;
  const total = tokens(usage.input_tokens) + tokens(usage.cache_creation_input_tokens) + tokens(usage.cache_read_input_tokens);
  return total || undefined;
}
/** The model's context window, as Claude Code reports it per model at the end of a turn. */
function windowOf(message: Record<string, unknown>): number | undefined {
  const models = message.modelUsage;
  if (!models || typeof models !== "object") return undefined;
  const windows = Object.values(models as Record<string, { contextWindow?: unknown }>).map((m) => tokens(m?.contextWindow)).filter(Boolean);
  return windows.length ? Math.max(...windows) : undefined;
}

/**
 * One line from the node, as zero or more timeline events. Lines it doesn't
 * know (system notices, stderr, partial tokens) produce nothing; the session id
 * is picked out wherever it appears so the next turn can resume.
 */
export function translate(line: unknown): Translated {
  if (!line || typeof line !== "object") return { events: [] };
  const message = line as Record<string, unknown>;
  const session = typeof message.session_id === "string" ? message.session_id : typeof message.session === "string" && message.session ? message.session : undefined;
  const content = (message.message as { content?: unknown } | undefined)?.content;
  const parts = Array.isArray(content) ? content as Record<string, unknown>[] : [];
  switch (message.type) {
    case "assistant": {
      const events: CodeEvent[] = [];
      const artifacts: ArtifactCall[] = [];
      for (const part of parts) {
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) events.push({ kind: "text", text: part.text });
        if (part.type === "tool_use" && typeof part.id === "string" && typeof part.name === "string") {
          const input = (part.input as Record<string, unknown>) ?? {};
          /* Plumbing, not something done for the person: how the agent finds and loads tools. */
          if (hiddenTool(part.name)) continue;
          const call = artifactCall(part.id, part.name, input);
          if (call) { artifacts.push(call); events.push({ kind: "artifact", id: call.id, name: call.name, action: call.action }); continue; }
          const progress = part.name === "Bash" ? progressOf(input.command) : undefined;
          events.push({ kind: "tool", id: part.id, name: part.name, ...toolLabel(part.name, input), ...(progress ? { progress } : {}) });
        }
      }
      return { events, session, context: contextOf(message), ...(artifacts.length ? { artifacts } : {}) };
    }
    case "system": {
      /* Claude Code folded the conversation into a summary, by itself or because it was asked to. */
      if (message.subtype === "compact_boundary") {
        const before = tokens((message.compact_metadata as { pre_tokens?: unknown } | undefined)?.pre_tokens);
        return { events: [{ kind: "compacted", ...(before ? { before } : {}) }], session };
      }
      return { events: [], session };
    }
    case "user": {
      const events: CodeEvent[] = [];
      const sent: SentFile[] = [];
      for (const part of parts) {
        if (part.type === "tool_result" && typeof part.tool_use_id === "string") {
          const { files, shown } = sentFiles(resultText(part.content));
          const ok = part.is_error !== true;
          events.push({ kind: "tool-result", id: part.tool_use_id, ok, output: clip(shown, 4000) });
          for (const link of connectLinks(shown)) events.push({ kind: "connect", ...link });
          if (ok) sent.push(...files);
        }
      }
      return { events, session, ...(sent.length ? { sent } : {}) };
    }
    case "result": {
      const failed = message.is_error === true || (typeof message.subtype === "string" && message.subtype !== "success");
      return {
        events: [],
        session,
        result: {
          ...(failed ? { failure: typeof message.result === "string" && message.result ? message.result : "It stopped with an error." } : {}),
          ...(typeof message.total_cost_usd === "number" ? { costUsd: message.total_cost_usd } : {}),
          ...(typeof message.duration_ms === "number" ? { durationMs: message.duration_ms } : {}),
          ...(windowOf(message) ? { window: windowOf(message) } : {}),
        },
      };
    }
    default:
      return { events: [], session };
  }
}

/** What a finished turn says about itself, gathered from Claude's result line and the node's done line. */
export function finish(result: TurnResult | null, done: { exit?: number; cancelled?: boolean } | null, error?: string, context?: number): Extract<CodeEvent, { kind: "done" }> {
  if (done?.cancelled) return { kind: "done", ok: false, cancelled: true };
  const failure = error ?? result?.failure ?? (done && done.exit !== 0 ? "It stopped with an error." : undefined) ?? (!done ? "Kimono AI stopped answering." : undefined);
  return {
    kind: "done", ok: !failure, ...(failure ? { error: clip(failure, 600) } : {}),
    ...(result?.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
    ...(result?.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    ...(context ? { context: { used: context, ...(result?.window ? { window: result.window } : {}) } } : {}),
  };
}
