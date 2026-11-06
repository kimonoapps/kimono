/*
 * Code's API as the web page uses it: the same /api/v1/code endpoints the
 * phone app calls, signed in by the browser's own session.
 */

export type TurnState = "running" | "done" | "failed" | "cancelled";
export type Workspace = {
  /** A chat has no project; a project works on a Kimono Git repository. */
  kind: "chat" | "project";
  /** The project (a folder of chats) it's in, if any. */
  folder: { id: string; name: string } | null;
  id: string; title: string; repo: { owner: string; name: string }; base: string; branch: string;
  pullRequest: { url: string; number: number } | null;
  preview: { url: string; port: number; kind: string | null; stopped: boolean } | null;
  previewName?: string | null;
  drive: { spaceId: string; folderId: string } | null;
  createdAt: number; updatedAt: number; lastSeq: number;
  turn: { id: string; state: TurnState; startedAt: number; endedAt: number | null } | null;
};
export type Repository = { owner: string; name: string; description: string; defaultBranch: string; updatedAt: number; private: boolean };
export type Attachment = { name: string; path: string; size: number; type: string };
export type CodeEvent =
  | { kind: "ask"; by: string; text: string; attachments: Attachment[]; queued?: boolean }
  | { kind: "started" }
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; label: string; detail?: string; change?: string; app?: string; space?: string }
  | { kind: "tool-result"; id: string; ok: boolean; output: string }
  | { kind: "done"; ok: boolean; cancelled?: boolean; error?: string; costUsd?: number; durationMs?: number; model?: "opus" | "sonnet" | "haiku"; context?: { used: number; window?: number } }
  | { kind: "compacted"; before?: number }
  | { kind: "published"; url: string; number: number }
  | { kind: "image"; name: string; caption?: string }
  | { kind: "preview"; url: string; port: number; app?: string }
  | { kind: "preview-stopped" }
  | { kind: "slept"; for: string }
  | { kind: "disk"; used: number; quota: number; full?: boolean }
  | { kind: "access"; id: string; space: string; path: string; need: "read" | "change"; why: string; file: boolean; state: "pending" | "auto" | "missing"; node?: string }
  | { kind: "remembered"; text: string; how?: "changed" | "forgot" }
  | { kind: "access-answer"; id: string; state: "allowed" | "denied"; scope?: "file" | "chat" | "always"; need?: "read" | "change" };
export type Project = { id: string; name: string; createdAt: number };
export type Profile = { instructions: string; memories: { id: string; text: string; source: "person" | "ai"; createdAt: number }[] };
/** An app the person connected through Composio. */
export type Connection = { app: string; name: string; logo: string; account: string; status: string; since: string | null };
export type ConnectableApp = { app: string; name: string; logo: string; description: string; connected: boolean };
/** What Kimono AI may use without asking. */
export type AccessSettings = {
  spaces: { id: string; name: string; crest: string; color: string; canChange: boolean; auto: "read" | "change" | null }[];
  grants: { id: string; spaceId: string; spaceName: string; path: string; need: "read" | "change" }[];
};
/** What a task's sandbox may use, and its disk as last measured (bytes). */
export type SandboxStatus = {
  limits: { cpus: number; memoryMb: number; awakePerPerson: number; awakePerNode: number; diskGb: number };
  disk: { used?: number; quota: number; at?: number };
};
/** How a published app is doing, as the sandbox's supervisor reports it. */
export type AppHealth = { state: "running" | "starting" | "crashed" | "stopped" | "asleep" | "down"; restarts: number; exit?: number; since?: number };
export type StoredEvent = { seq: number; turn: string | null; at: number; event: CodeEvent };
export type Entry = { name: string; kind: "file" | "dir" | "link"; size: number };
export type Changes = {
  base: string; branch: string; truncated: boolean; diff: string;
  files: { path: string; status: "added" | "modified" | "deleted" | "renamed"; additions: number; deletions: number }[];
};

export class CodeProblem extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

const base = "/api/v1/code";

/** How hard the agent thinks. The model is always Opus 5.5. */
export const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof efforts)[number];
export type Usage = {
  model: string; unlimited: boolean; reported: boolean; plan: { fiveHour: number | null; week: number | null }; fiveHourLimited?: boolean;
  fiveHour: { used: number; share: number; resetsAt: number | null };
  week: { used: number; share: number; resetsAt: number | null };
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...init.headers },
      credentials: "same-origin",
    });
  } catch {
    throw new CodeProblem("Kimono isn't answering. Check your connection and try again.");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return {}; } })() : {};
  if (!response.ok) throw new CodeProblem((body as { error?: string }).error || "That didn't work. Try again.", response.status);
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
const ws = (id: string) => `/workspaces/${encodeURIComponent(id)}`;

export const code = {
  workspaces: () => call<{ workspaces: Workspace[] }>("/workspaces").then((r) => r.workspaces),
  workspace: (id: string) => call<Workspace>(ws(id)),
  start: (input: { owner?: string; name?: string; base?: string; prompt: string; effort?: Effort; folder?: string }) => call<Workspace>("/workspaces", json("POST", { ...input, model: modelNow() })),
  rename: (id: string, title: string) => call<Workspace>(ws(id), json("PATCH", { title })),
  remove: (id: string) => call<void>(ws(id), { method: "DELETE" }),
  ask: (id: string, text: string, attachments: Attachment[], effort?: Effort) => call<StoredEvent>(`${ws(id)}/turns`, json("POST", { text, attachments, effort, model: modelNow() })),
  usage: () => call<Usage>("/usage"),
  stop: (id: string) => call<void>(`${ws(id)}/stop`, { method: "POST" }),
  answerAccess: (id: string, request: string, choice: "file" | "chat" | "always" | "deny", file?: string) => call<StoredEvent>(`${ws(id)}/access/${encodeURIComponent(request)}`, json("POST", { choice, ...(file ? { file } : {}) })),
  access: () => call<AccessSettings>("/access"),
  /** Projects: folders a person keeps chats in. */
  projects: () => call<{ projects: Project[] }>("/projects").then((r) => r.projects),
  createProject: (name: string) => call<Project>("/projects", json("POST", { name })),
  renameProject: (id: string, name: string) => call<Project>(`/projects/${encodeURIComponent(id)}`, json("PATCH", { name })),
  removeProject: (id: string) => call<void>(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
  moveChat: (id: string, folder: string | null) => call<Workspace>(ws(id), json("PATCH", { folder })),
  /** What Kimono AI keeps about this person: their instructions, and its memories. */
  memory: () => call<Profile>("/memory"),
  saveInstructions: (instructions: string) => call<Profile>("/memory", json("POST", { instructions })),
  remember: (text: string) => call<Profile>("/memory", json("POST", { remember: text })),
  forget: (id: string) => call<Profile>(`/memory/${encodeURIComponent(id)}`, { method: "DELETE" }),
  changeMemory: (id: string, text: string) => call<Profile>(`/memory/${encodeURIComponent(id)}`, json("PATCH", { text })),
  /** The apps this person has connected through Composio, and whether connections are set up at all. */
  connections: () => call<{ available: boolean; connections: Connection[] }>("/connections"),
  findApps: (q: string) => call<{ apps: ConnectableApp[] }>(`/connections/apps?q=${encodeURIComponent(q)}`).then((r) => r.apps),
  connect: (app: string) => call<{ url: string }>("/connections", json("POST", { app })).then((r) => r.url),
  disconnect: (account: string) => call<void>(`/connections/${encodeURIComponent(account)}`, { method: "DELETE" }),
  /** How a person's own app (a Composio toolkit) is named and drawn. */
  appLook: (slug: string) => call<{ name: string; logo: string }>(`/apps/${encodeURIComponent(slug)}`),
  setSpaceAccess: (spaceId: string, need: "read" | "change" | null) => call<void>(`/access/spaces/${encodeURIComponent(spaceId)}`, json("PUT", { need })),
  revokeAccess: (grantId: string) => call<void>(`/access/grants/${encodeURIComponent(grantId)}`, { method: "DELETE" }),
  fromDrive: (id: string, nodes: string[]) => call<{ attachments: Attachment[] }>(`${ws(id)}/from-drive`, json("POST", { nodes })).then((r) => r.attachments),
  stopPreview: (id: string) => call<void>(`${ws(id)}/preview`, { method: "DELETE" }),
  renamePreview: (id: string, name: string) => call<{ url: string; port: number }>(`${ws(id)}/preview`, json("PATCH", { name })),
  sandbox: (id: string) => call<SandboxStatus>(`${ws(id)}/sandbox`),
  previewStatus: (id: string) => call<{ health: AppHealth; log: string }>(`${ws(id)}/preview`),
  restartPreview: (id: string) => call<unknown>(`${ws(id)}/preview/restart`, { method: "POST" }),
  pausePreview: (id: string) => call<unknown>(`${ws(id)}/preview/stop`, { method: "POST" }),
  shotUrl: (id: string, name: string) => `${base}${ws(id)}/shots/${encodeURIComponent(name)}`,
  files: (id: string, path: string) => call<{ path: string; entries: Entry[] }>(`${ws(id)}/files?path=${encodeURIComponent(path)}`),
  changes: (id: string) => call<Changes>(`${ws(id)}/changes`),
  publish: (id: string, title: string) => call<Workspace>(`${ws(id)}/publish`, json("POST", { title })),
  createRepository: (name: string) => call<Repository>("/repos", json("POST", { name })),
  repositories: () => call<{ repositories: Repository[] }>("/repos").then((r) => r.repositories),
  branches: (owner: string, name: string) => call<{ branches: string[] }>(`/branches?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`).then((r) => r.branches),

  async file(id: string, path: string): Promise<ArrayBuffer> {
    const response = await fetch(`${base}${ws(id)}/file?path=${encodeURIComponent(path)}`, { credentials: "same-origin" }).catch(() => null);
    if (!response) throw new CodeProblem("Kimono isn't answering.");
    if (response.status === 413) throw new CodeProblem("That file is too large to show here.", 413);
    if (!response.ok) throw new CodeProblem(((await response.json().catch(() => ({}))) as { error?: string }).error || "That file couldn't be opened.", response.status);
    return response.arrayBuffer();
  },

  attach: (id: string, file: File) => call<Attachment>(`${ws(id)}/attachments?name=${encodeURIComponent(file.name)}`, {
    method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream" },
  }),

  /** Where an attachment can be seen again, from its path in the sandbox. */
  attachmentUrl: (id: string, a: Attachment) => `${base}${ws(id)}/attachments/${encodeURIComponent(a.path.replace(/^\/attachments\//, ""))}?type=${encodeURIComponent(a.type)}`,

  eventsUrl: (id: string, after: number) => `${base}${ws(id)}/events?after=${after}`,
};

export const isPicture = (type: string) => /^image\/(png|jpeg|gif|webp)$/.test(type);

export function readableSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/** Gigabytes, as limits are spoken of: "2 GB", "3.4 GB". */
export function gigabytes(bytes: number) {
  const value = bytes / 1024 ** 3;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} GB`;
}

export function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 3600 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`;
}

export function when(at: number, now = Date.now()) {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* Drive, as the "From Drive" picker reads it: the same /api/v1/drive the Drive page uses. */
export type DriveSpace = { id: string; name: string; rootId: string; role: string; /** The space's crest, as SVG Drive draws it. */ mark?: string };
export type DriveItem = { id: string; kind: "folder" | "file"; name: string; size: number; mime: string | null };

async function driveCall<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1/drive${path}`, { credentials: "same-origin" }).catch(() => null);
  if (!response) throw new CodeProblem("Kimono isn't answering.");
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new CodeProblem((body as { error?: string }).error || "Drive didn't answer.", response.status);
  return body as T;
}

export const drive = {
  spaces: () => driveCall<{ spaces: DriveSpace[] }>("/spaces").then((r) => r.spaces),
  folder: (id: string) => driveCall<{ folder: DriveItem; path: DriveItem[]; children: DriveItem[] }>(`/nodes/${encodeURIComponent(id)}`),
};

/* Which Claude answers: Auto (Kimono picks per message), or one the person chose. Remembered in this browser. */
export const modelChoices = ["auto", "opus", "sonnet", "haiku"] as const;
export type ModelChoice = (typeof modelChoices)[number];
export const modelKey = "kimono-ai-model";
export function modelNow(): ModelChoice {
  try { const v = window.localStorage.getItem(modelKey); return (modelChoices as readonly string[]).includes(v ?? "") ? v as ModelChoice : "auto"; } catch { return "auto"; }
}
