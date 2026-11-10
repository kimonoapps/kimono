import "server-only";

import { CodeProblem, type Workspace } from "./model";
import type { CodeConfig } from "./config";
import { gitToken } from "./git-token";
import type { ToolSession } from "./composio";
import type { Model } from "./models";

/*
 * The sandbox node, as Portal calls it (docs/kimono-code.md, "Node API").
 * Portal never runs a container itself; it asks the node, over the mesh.
 */

type Who = { name: string; email: string };

const unreachable = "Kimono AI isn't answering right now. Try again in a moment.";

/** A file that doesn't fit in the sandbox's disk: what it needs and what is free. */
export class NoRoom extends Error {
  constructor(readonly size: number, readonly room: number) { super("That file doesn't fit in the sandbox."); }
}

/* A big file takes as long as it takes: two minutes, and one more for every 120 MB (2 MB/s at worst). */
const transferTimeout = (size: number) => 2 * 60_000 + Math.ceil(size / (2 * 1024 * 1024)) * 1000;

async function call(config: CodeConfig, path: string, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = 60_000, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${config.nodeAddress}${path}`, {
      ...rest,
      headers: { Authorization: `Bearer ${config.nodeKey}`, ...rest.headers },
      signal: rest.signal ?? AbortSignal.timeout(timeout),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError" && rest.signal?.aborted) throw error;
    throw new CodeProblem(unreachable, 502);
  }
  if (response.ok) return response;
  let message = "That didn't work. Try again in a moment.";
  try { message = ((await response.json()) as { error?: string }).error || message; } catch { /* not JSON */ }
  if (response.status === 401 || response.status === 403) message = "Kimono AI isn't set up right. An administrator can check it in Applications.";
  throw new CodeProblem(message, response.status >= 500 ? 502 : response.status);
}

const json = async <T>(response: Response) => (await response.json()) as T;
const at = (workspace: Workspace) => `/v1/workspaces/${workspace.id}`;

/** How hard the agent thinks on a turn. The model is always Opus 5.5. */
export const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof efforts)[number];

export const sandbox = {
  health: (config: CodeConfig) => call(config, "/v1/health", { timeout: 5_000 }).then(json<{ ok: boolean; version: string; image?: string; runtime: string }>),

  /** Makes sure the sandbox exists, holds the repository and is awake. Safe to call before anything. */
  ensure: async (config: CodeConfig, workspace: Workspace, who: Who, tools: ToolSession | null = null, gitLogin: string | null = null) => call(config, at(workspace), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    timeout: 5 * 60_000,
    body: JSON.stringify({
      /* A chat has no repository, and its sandbox never gets a Kimono Git token. */
      repo: workspace.kind === "project" ? {
        url: `${config.gitAddress}/${workspace.repo.owner}/${workspace.repo.name}.git`,
        owner: workspace.repo.owner, name: workspace.repo.name, base: workspace.base, branch: workspace.branch,
      } : {},
      /* login: the owner's Kimono Git account, which pull requests are opened as. */
      git: { token: workspace.kind === "project" ? await gitToken(config) : "", name: who.name, email: who.email, ...(gitLogin ? { login: gitLogin } : {}) },
      model: { token: config.modelToken },
      ...(tools ? { tools } : {}),
      owner: workspace.owner, title: workspace.title, limits: config.limits,
    }),
  }).then(json<{ id: string; state: string; branch: string; runtime?: string; slept?: string[] | null; /** Made from nothing just now: it holds none of what was synced into it before. */ fresh?: boolean }>),

  state: (config: CodeConfig, workspace: Workspace) => call(config, at(workspace), { timeout: 10_000 }).then(json<{ state: string; branch: string; limits: SandboxLimits; disk: Disk }>),

  /** Starts a turn; the body is the node's NDJSON stream, read until it ends. */
  turn: (config: CodeConfig, workspace: Workspace, input: { prompt: string; session: string | null; attachments: string[]; effort?: Effort; model?: Model; context?: string; resumeAt?: string | null; links?: string; linkKey?: string; skills?: string[]; always?: string[] }, signal: AbortSignal) => call(config, `${at(workspace)}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    /* Haiku takes no thinking level. */
    body: JSON.stringify({ prompt: input.prompt, ...(input.session ? { session: input.session } : {}), attachments: input.attachments, ...(input.effort && input.model !== "haiku" ? { effort: input.effort } : {}), ...(input.model ? { model: input.model } : {}), ...(input.context ? { context: input.context } : {}), ...(input.session && input.resumeAt ? { resumeAt: input.resumeAt } : {}), ...(input.links ? { links: input.links } : {}), ...(input.linkKey ? { linkKey: input.linkKey } : {}), ...(input.skills?.length ? { skills: input.skills } : {}), ...(input.always?.length ? { always: input.always } : {}) }),
    signal,
  }),

  /** A name for the chat from its first exchange, from Haiku in its sandbox. */
  name: (config: CodeConfig, workspace: Workspace, conversation: string) => call(config, `${at(workspace)}/name`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversation }), timeout: 60_000,
  }).then(json<{ title: string }>),

  cancel: (config: CodeConfig, workspace: Workspace) => call(config, `${at(workspace)}/cancel`, { method: "POST", timeout: 10_000 }).then(() => undefined),

  files: (config: CodeConfig, workspace: Workspace, path: string) =>
    call(config, `${at(workspace)}/files?path=${encodeURIComponent(path)}`).then(json<{ path: string; entries: { name: string; kind: "file" | "dir" | "link"; size: number }[] }>),

  /** A file's bytes: up to 2 MB, or with `full` up to 50 MB. */
  file: (config: CodeConfig, workspace: Workspace, path: string, full = false) => call(config, `${at(workspace)}/file?path=${encodeURIComponent(path)}${full ? "&full=1" : ""}`),

  attach: (config: CodeConfig, workspace: Workspace, name: string, body: Uint8Array) => call(config, `${at(workspace)}/attachments?name=${encodeURIComponent(name)}`, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: body as BodyInit, timeout: 2 * 60_000,
  }).then(json<{ path: string }>),

  /** Every file git would keep, with its sha1: what the Drive mirror compares. */
  tree: (config: CodeConfig, workspace: Workspace) => call(config, `${at(workspace)}/tree`).then(json<{ files: { path: string; size: number; sha1: string }[]; truncated: boolean }>),
  /** The files a person let the agent use, under .kimono/files, by their path there. */
  granted: (config: CodeConfig, workspace: Workspace) => call(config, `${at(workspace)}/tree?dir=granted`).then(json<{ files: { path: string; size: number; sha1: string }[]; truncated: boolean }>),

  /** A file's bytes as they come, up to the sync limit (4 GB), to copy into Drive. `size` is what the node promised. */
  pull: async (config: CodeConfig, workspace: Workspace, path: string, sizeHint = 0) => {
    const response = await call(config, `${at(workspace)}/file?full=1&path=${encodeURIComponent(path)}`, { timeout: transferTimeout(sizeHint || 4 * 1024 ** 3) });
    const length = response.headers.get("content-length");
    return { body: response.body!, size: length === null ? Number.NaN : Number(length) };
  },

  /** Streams a file into the repository. Throws NoRoom when the sandbox hasn't the disk for it. */
  push: async (config: CodeConfig, workspace: Workspace, path: string, body: ReadableStream<Uint8Array>, size: number) => {
    let response: Response;
    try {
      response = await fetch(`${config.nodeAddress}${at(workspace)}/file?path=${encodeURIComponent(path)}`, {
        method: "PUT", body, duplex: "half", cache: "no-store", signal: AbortSignal.timeout(transferTimeout(size)),
        headers: { Authorization: `Bearer ${config.nodeKey}`, "Content-Type": "application/octet-stream", "Content-Length": String(size) },
      } as RequestInit);
    } catch { throw new CodeProblem(unreachable, 502); }
    if (response.status === 507) {
      const said = await response.json().catch(() => ({})) as { room?: number };
      throw new NoRoom(size, said.room ?? 0);
    }
    if (!response.ok) {
      const said = await response.json().catch(() => ({})) as { error?: string };
      throw new CodeProblem(said.error || "That didn't work. Try again in a moment.", response.status >= 500 ? 502 : response.status);
    }
  },

  /** Writes a file into the repository, as Drive hands it back. */
  write: (config: CodeConfig, workspace: Workspace, path: string, body: Uint8Array) => call(config, `${at(workspace)}/file?path=${encodeURIComponent(path)}`, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: body as BodyInit, timeout: 2 * 60_000,
  }).then(() => undefined),

  remove: (config: CodeConfig, workspace: Workspace) => call(config, at(workspace), { method: "DELETE" }).then(() => undefined),

  removeFile: (config: CodeConfig, workspace: Workspace, path: string) =>
    call(config, `${at(workspace)}/file?path=${encodeURIComponent(path)}`, { method: "DELETE" }).then(() => undefined),

  /** A screenshot the agent took, from the sandbox's outbox. */
  outbox: (config: CodeConfig, workspace: Workspace, name: string) =>
    call(config, `${at(workspace)}/outbox/${encodeURIComponent(name)}`).then(async (r) => new Uint8Array(await r.arrayBuffer())),

  renamePreview: (config: CodeConfig, workspace: Workspace, name: string) => call(config, `${at(workspace)}/preview`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }), timeout: 20_000,
  }).then(json<NodePreview>),
  stopPreview: (config: CodeConfig, workspace: Workspace) => call(config, `${at(workspace)}/preview`, { method: "DELETE", timeout: 20_000 }).then(() => undefined),

  /** How the published app is doing, without waking the sandbox. */
  preview: (config: CodeConfig, workspace: Workspace) => call(config, `${at(workspace)}/preview`, { timeout: 15_000 }).then(json<NodePreview & { health: AppHealth; disk?: Disk }>),
  /** The end of what the app printed, across its restarts. */
  previewLogs: (config: CodeConfig, workspace: Workspace) => call(config, `${at(workspace)}/preview/logs`, { timeout: 15_000 }).then((r) => r.text()),
  /** Starts the app again as the agent published it, keeping its link. */
  restartPreview: (config: CodeConfig, workspace: Workspace) => call(config, `${at(workspace)}/preview/restart`, { method: "POST", timeout: 3 * 60_000 }).then(json<NodePreview>),
  /** Stops the app but keeps its link, to start again later. */
  pausePreview: (config: CodeConfig, workspace: Workspace) => call(config, `${at(workspace)}/preview/stop`, { method: "POST", timeout: 30_000 }).then(json<NodePreview>),

  changes: (config: CodeConfig, workspace: Workspace) => call(config, `${at(workspace)}/changes`).then(json<Changes>),

  publish: (config: CodeConfig, workspace: Workspace, input: { title: string; body: string }) => call(config, `${at(workspace)}/publish`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), timeout: 2 * 60_000,
  }).then(json<{ url: string; number: number }>),
};

export type SandboxLimits = { cpus: number; memoryMb: number; awakePerPerson: number; awakePerNode: number; diskGb: number };
/** What a sandbox's files took when last measured, against its quota, in bytes. */
export type Disk = { used?: number; quota: number; at?: number };

export type NodePreview = { url: string; port: number; kind?: string; stopped?: boolean };
export type AppHealth = { state: "running" | "starting" | "crashed" | "stopped" | "asleep" | "down"; restarts: number; exit?: number; since?: number };

export type Changes = {
  base: string; branch: string; truncated: boolean; diff: string;
  files: { path: string; status: "added" | "modified" | "deleted" | "renamed"; additions: number; deletions: number }[];
};
