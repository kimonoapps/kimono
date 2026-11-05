import "server-only";

import { CodeProblem, type Workspace } from "./model";
import type { CodeConfig } from "./config";

/*
 * The sandbox node, as Portal calls it (docs/kimono-code.md, "Node API").
 * Portal never runs a container itself; it asks the node, over the mesh.
 */

type Who = { name: string; email: string };

const unreachable = "The sandbox node isn't answering. Check that it's on.";

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
  let message = "The sandbox couldn't do that.";
  try { message = ((await response.json()) as { error?: string }).error || message; } catch { /* not JSON */ }
  if (response.status === 401 || response.status === 403) message = "The sandbox node refused Portal's key.";
  throw new CodeProblem(message, response.status >= 500 ? 502 : response.status);
}

const json = async <T>(response: Response) => (await response.json()) as T;
const at = (workspace: Workspace) => `/v1/workspaces/${workspace.id}`;

/** How hard the agent thinks on a turn. The model is always Opus 5.5. */
export const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof efforts)[number];

export const sandbox = {
  health: (config: CodeConfig) => call(config, "/v1/health", { timeout: 5_000 }).then(json<{ ok: boolean; version: string; runtime: string }>),

  /** Makes sure the sandbox exists, holds the repository and is awake. Safe to call before anything. */
  ensure: (config: CodeConfig, workspace: Workspace, who: Who) => call(config, at(workspace), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    timeout: 5 * 60_000,
    body: JSON.stringify({
      repo: {
        url: `${config.gitAddress}/${workspace.repo.owner}/${workspace.repo.name}.git`,
        owner: workspace.repo.owner, name: workspace.repo.name, base: workspace.base, branch: workspace.branch,
      },
      git: { token: config.gitToken, name: who.name, email: who.email },
      model: { token: config.modelToken },
    }),
  }).then(json<{ id: string; state: string; branch: string; runtime?: string }>),

  state: (config: CodeConfig, workspace: Workspace) => call(config, at(workspace), { timeout: 10_000 }).then(json<{ state: string; branch: string }>),

  /** Starts a turn; the body is the node's NDJSON stream, read until it ends. */
  turn: (config: CodeConfig, workspace: Workspace, input: { prompt: string; session: string | null; attachments: string[]; effort?: Effort }, signal: AbortSignal) => call(config, `${at(workspace)}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: input.prompt, ...(input.session ? { session: input.session } : {}), attachments: input.attachments, ...(input.effort ? { effort: input.effort } : {}) }),
    signal,
  }),

  cancel: (config: CodeConfig, workspace: Workspace) => call(config, `${at(workspace)}/cancel`, { method: "POST", timeout: 10_000 }).then(() => undefined),

  files: (config: CodeConfig, workspace: Workspace, path: string) =>
    call(config, `${at(workspace)}/files?path=${encodeURIComponent(path)}`).then(json<{ path: string; entries: { name: string; kind: "file" | "dir" | "link"; size: number }[] }>),

  file: (config: CodeConfig, workspace: Workspace, path: string) => call(config, `${at(workspace)}/file?path=${encodeURIComponent(path)}`),

  attach: (config: CodeConfig, workspace: Workspace, name: string, body: Uint8Array) => call(config, `${at(workspace)}/attachments?name=${encodeURIComponent(name)}`, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: body as BodyInit, timeout: 2 * 60_000,
  }).then(json<{ path: string }>),

  /** Every file git would keep, with its sha1: what the Drive mirror compares. */
  tree: (config: CodeConfig, workspace: Workspace) => call(config, `${at(workspace)}/tree`).then(json<{ files: { path: string; size: number; sha1: string }[]; truncated: boolean }>),

  /** A file's bytes, up to 50 MB, to copy into Drive. */
  readFull: (config: CodeConfig, workspace: Workspace, path: string) =>
    call(config, `${at(workspace)}/file?full=1&path=${encodeURIComponent(path)}`, { timeout: 2 * 60_000 }).then(async (r) => new Uint8Array(await r.arrayBuffer())),

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
  preview: (config: CodeConfig, workspace: Workspace) => call(config, `${at(workspace)}/preview`, { timeout: 15_000 }).then(json<NodePreview & { health: AppHealth }>),
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

export type NodePreview = { url: string; port: number; kind?: string; stopped?: boolean };
export type AppHealth = { state: "running" | "starting" | "crashed" | "stopped" | "asleep" | "down"; restarts: number; exit?: number; since?: number };

export type Changes = {
  base: string; branch: string; truncated: boolean; diff: string;
  files: { path: string; status: "added" | "modified" | "deleted" | "renamed"; additions: number; deletions: number }[];
};
