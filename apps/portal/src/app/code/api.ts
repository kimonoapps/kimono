/*
 * Code's API as the web page uses it: the same /api/v1/code endpoints the
 * phone app calls, signed in by the browser's own session.
 */

export type TurnState = "running" | "done" | "failed" | "cancelled";
export type Workspace = {
  id: string; title: string; repo: { owner: string; name: string }; base: string; branch: string;
  pullRequest: { url: string; number: number } | null;
  preview: { url: string; port: number } | null;
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
  | { kind: "tool"; id: string; name: string; label: string; detail?: string; change?: string }
  | { kind: "tool-result"; id: string; ok: boolean; output: string }
  | { kind: "done"; ok: boolean; cancelled?: boolean; error?: string; costUsd?: number; durationMs?: number }
  | { kind: "published"; url: string; number: number }
  | { kind: "image"; name: string; caption?: string }
  | { kind: "preview"; url: string; port: number }
  | { kind: "preview-stopped" };
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
  model: string; unlimited: boolean; reported: boolean;
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
  start: (input: { owner: string; name: string; base: string; prompt: string; effort?: Effort }) => call<Workspace>("/workspaces", json("POST", input)),
  rename: (id: string, title: string) => call<Workspace>(ws(id), json("PATCH", { title })),
  remove: (id: string) => call<void>(ws(id), { method: "DELETE" }),
  ask: (id: string, text: string, attachments: Attachment[], effort?: Effort) => call<StoredEvent>(`${ws(id)}/turns`, json("POST", { text, attachments, effort })),
  usage: () => call<Usage>("/usage"),
  stop: (id: string) => call<void>(`${ws(id)}/stop`, { method: "POST" }),
  fromDrive: (id: string, nodes: string[]) => call<{ attachments: Attachment[] }>(`${ws(id)}/from-drive`, json("POST", { nodes })).then((r) => r.attachments),
  stopPreview: (id: string) => call<void>(`${ws(id)}/preview`, { method: "DELETE" }),
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
export type DriveSpace = { id: string; name: string; rootId: string; role: string };
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
