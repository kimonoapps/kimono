import "server-only";

import { mkdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apiError, type ApiUser } from "../api-v1";
import { getPlatformSettings } from "../settings";
import { stateDir } from "../state";
import { codeConfig, missing, type CodeConfig } from "./config";
import { finish, translate, type Attachment, type CodeEvent, type TurnResult } from "./events";
import {
  abandonRunningTurns, appendEvent, CodeProblem, endTurn, migrate, newId, recordUsage, runningTurn, setPreviewName, usageOf, setPreview, setSession, startTurn, takeDriveNews, workspaceFor,
  type StoredEvent, type Workspace,
} from "./model";
import { sandbox, type Effort } from "./node";
export { efforts, type Effort } from "./node";
import { shotToDrive, syncDrive } from "./drive";

export * from "./model";
export type { CodeEvent, Attachment } from "./events";

const root = join(stateDir, "code");
/** The largest attachment: 20 MB, which is what the node takes. */
export const maxAttachmentBytes = 20 * 1024 * 1024;

type Live = {
  db?: DatabaseSync;
  listeners: Map<string, Set<(event: StoredEvent) => void>>;
  turns: Map<string, AbortController>;
  /** Messages sent while a turn was running, per workspace: the next turn reads them. */
  queued?: Map<string, { user: ApiUser; prompt: string; attachments: Attachment[]; effort?: Effort }[]>;
};
/* One connection and one set of listeners for the process, kept across hot reloads in development. */
const cache = globalThis as unknown as { kimonoCode?: Live };
const live: Live = cache.kimonoCode ??= { listeners: new Map(), turns: new Map() };

export function db(): DatabaseSync {
  if (!live.db) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const opened = new DatabaseSync(join(root, "code.db"));
    migrate(opened);
    /* Turns a previous process was driving have no one left to finish them. */
    for (const { workspace, turn } of abandonRunningTurns(opened)) {
      appendEvent(opened, workspace, turn, { kind: "done", ok: false, error: "Kimono restarted while the agent was working." });
    }
    live.db = opened;
  }
  return live.db;
}

/** Code is for administrators while it is new. */
export const allowed = (user: ApiUser) => user.role === "owner" || user.role === "admin";

/** Runs a Code action for a signed-in user, turning refusals into the JSON errors /api/v1 answers with. */
export async function code(user: ApiUser, work: (config: CodeConfig) => Promise<Response> | Response, needsSetup = true): Promise<Response> {
  try {
    const config = codeConfig(await getPlatformSettings());
    if (!config.enabled) return apiError(404, "Code isn't switched on.");
    if (!allowed(user)) return apiError(403, "Code is only for administrators for now.");
    const blocked = needsSetup ? missing(config) : null;
    if (blocked) return apiError(409, blocked);
    return await work(config);
  } catch (error) {
    if (error instanceof CodeProblem) return apiError(error.status, error.message);
    console.warn("Code request failed:", error instanceof Error ? error.message : error);
    return apiError(500, "Code couldn't do that. Try again in a moment.");
  }
}

/* ── the timeline, live ── */

function record(workspaceId: string, turnId: string | null, event: CodeEvent) {
  const stored = appendEvent(db(), workspaceId, turnId, event);
  for (const listener of live.listeners.get(workspaceId) ?? []) {
    try { listener(stored); } catch { /* a closed stream; it unsubscribes itself */ }
  }
  return stored;
}

/** Hears every event recorded in a workspace from now on. Returns the way to stop. */
export function listen(workspaceId: string, listener: (event: StoredEvent) => void) {
  const set = live.listeners.get(workspaceId) ?? new Set();
  set.add(listener);
  live.listeners.set(workspaceId, set);
  return () => { set.delete(listener); if (!set.size) live.listeners.delete(workspaceId); };
}

const who = (user: ApiUser) => ({ name: user.name || user.username, email: user.email || `${user.username}@users.kimono` });

const clock = (at: number) => new Date(at).toLocaleString("en", { weekday: "short", hour: "numeric", minute: "2-digit" });

/** Refuses a person who has used their share of the plan's 5-hour or weekly window. The owner has no share: it's their plan. */
export function checkShare(config: CodeConfig, user: ApiUser) {
  if (user.role === "owner") return;
  const used = usageOf(db(), user.username);
  if (used.fiveHour.used >= config.shares.fiveHour) throw new CodeProblem(`You've used your share of this 5-hour window. It opens again ${clock(used.fiveHour.resetsAt!)}.`, 429);
  if (used.week.used >= config.shares.week) throw new CodeProblem(`You've used your share for this week. It opens again ${clock(used.week.resetsAt!)}.`, 429);
}

/** Sends a message to the agent and returns at once; the turn runs on, recording as it goes. */
export function ask(config: CodeConfig, workspace: Workspace, user: ApiUser, text: string, attachments: Attachment[], effort?: Effort) {
  const prompt = text.trim();
  if (!prompt && !attachments.length) throw new CodeProblem("Say what to do.");
  if (prompt.length > 32_000) throw new CodeProblem("That message is too long.");
  checkShare(config, user);
  /* Steering: while the agent works, a message waits in line and the next turn starts with it. */
  const busy = runningTurn(db(), workspace.id);
  if (busy) {
    const queue = (live.queued ??= new Map());
    queue.set(workspace.id, [...(queue.get(workspace.id) ?? []), { user, prompt, attachments, effort }]);
    return record(workspace.id, busy, { kind: "ask", by: user.username, text: prompt, attachments, queued: true });
  }
  const turn = startTurn(db(), workspace.id);
  const asked = record(workspace.id, turn, { kind: "ask", by: user.username, text: prompt, attachments });
  void run(config, workspace, user, turn, prompt || "Look at the attached files.", attachments, effort);
  return asked;
}

async function run(config: CodeConfig, workspace: Workspace, user: ApiUser, turn: string, prompt: string, attachments: Attachment[], effort?: Effort) {
  const controller = new AbortController();
  live.turns.set(turn, controller);
  record(workspace.id, turn, { kind: "started" });
  let result: TurnResult | null = null;
  let done: { exit?: number; cancelled?: boolean } | null = null;
  let failure: string | undefined;
  let context: number | undefined;
  try {
    await sandbox.ensure(config, workspace, who(user));
    const session = workspaceFor(db(), workspace.id, workspace.owner).session;
    /* Whatever a person changed in Drive since last time goes in first, and the agent is told. */
    await syncDrive(db(), config, workspace).catch((error) => console.warn("Code couldn't sync from Drive:", error instanceof Error ? error.message : error));
    /* A command like /compact goes to the agent as it is; the Drive news waits for the next real message. */
    const changed = prompt.startsWith("/") ? [] : takeDriveNews(db(), workspace.id);
    const told = changed.length ? `Changed in Drive since last time: ${changed.slice(0, 30).join(", ")}${changed.length > 30 ? `, and ${changed.length - 30} more` : ""}.\n\n${prompt}` : prompt;
    const response = await sandbox.turn(config, workspace, { prompt: told, session, attachments: attachments.map((a) => a.path), effort }, controller.signal);
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { done: ended, value } = await reader.read();
      if (value) buffer += value;
      const lines = buffer.split("\n");
      buffer = ended ? "" : lines.pop() ?? "";
      for (const raw of lines) {
        if (!raw.trim()) continue;
        let line: Record<string, unknown>;
        try { line = JSON.parse(raw); } catch { continue; }
        if (line.type === "kimono.image" && typeof line.name === "string") {
          await keepShot(config, workspace, turn, line.name, typeof line.caption === "string" ? line.caption : undefined);
          continue;
        }
        if (line.type === "kimono.preview" && typeof line.url === "string" && typeof line.port === "number") {
          /* The owner named this app before: give the new link that name again. */
          const chosen = workspaceFor(db(), workspace.id, workspace.owner).previewName;
          let preview = { url: line.url, port: line.port };
          if (chosen && new URL(line.url).hostname.split(".")[0] !== chosen) {
            preview = await sandbox.renamePreview(config, workspace, chosen).catch(() => preview);
          }
          setPreview(db(), workspace.id, preview);
          record(workspace.id, turn, { kind: "preview", url: preview.url, port: preview.port });
          continue;
        }
        if (line.type === "kimono.usage") {
          /* What this turn used of the Claude plan, credited to whoever asked. */
          try { recordUsage(db(), user.username, line); } catch (error) { console.warn("Code couldn't record usage:", error instanceof Error ? error.message : error); }
          continue;
        }
        if (line.type === "kimono.preview.stopped") {
          setPreview(db(), workspace.id, null);
          record(workspace.id, turn, { kind: "preview-stopped" });
          continue;
        }
        if (line.type === "kimono.done") {
          done = { exit: typeof line.exit === "number" ? line.exit : undefined, cancelled: line.cancelled === true };
          if (typeof line.session === "string" && line.session) setSession(db(), workspace.id, line.session);
          continue;
        }
        const translated = translate(line);
        if (translated.session) setSession(db(), workspace.id, translated.session);
        if (translated.result) result = translated.result;
        if (translated.context) context = translated.context;
        for (const event of translated.events) record(workspace.id, turn, event);
      }
      if (ended) break;
    }
  } catch (error) {
    if (controller.signal.aborted) done = { cancelled: true };
    else failure = error instanceof CodeProblem ? error.message : "The sandbox stopped answering.";
  } finally {
    live.turns.delete(turn);
    const outcome = finish(result, done, failure, context);
    record(workspace.id, turn, outcome);
    endTurn(db(), turn, outcome.cancelled ? "cancelled" : outcome.ok ? "done" : "failed");
    /* What the agent made goes to Drive. */
    void syncDrive(db(), config, workspace).catch((error) => console.warn("Code couldn't sync to Drive:", error instanceof Error ? error.message : error));
    /* Anything sent while it worked starts the next turn straight away. */
    const waiting = live.queued?.get(workspace.id);
    if (waiting?.length) {
      live.queued!.delete(workspace.id);
      try {
        checkShare(config, waiting[0].user);
        const next = startTurn(db(), workspace.id);
        void run(config, workspace, waiting[0].user, next, waiting.map((m) => m.prompt).filter(Boolean).join("\n\n") || "Look at the attached files.", waiting.flatMap((m) => m.attachments), waiting.at(-1)?.effort);
      } catch (error) { console.warn("Code couldn't start the queued message:", error instanceof Error ? error.message : error); }
    }
  }
}

/** Gives a task's app link a name its owner chose; the old link stops answering. */
export async function renamePreview(config: CodeConfig, workspace: Workspace, name: string) {
  const clean = name.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(clean) || clean.includes("--")) throw new CodeProblem("Use letters, numbers and single dashes, up to 50 characters.");
  const preview = await sandbox.renamePreview(config, workspace, clean);
  setPreview(db(), workspace.id, preview);
  setPreviewName(db(), workspace.id, clean);
  record(workspace.id, runningTurn(db(), workspace.id), { kind: "preview", url: preview.url, port: preview.port });
  return preview;
}

/** Stops the turn that is running, if there is one. */
export async function stop(config: CodeConfig, workspace: Workspace) {
  if (workspace.turn?.state !== "running") return;
  await sandbox.cancel(config, workspace).catch(() => {});
  live.turns.get(workspace.turn.id)?.abort();
}

/** Records a published pull request on the timeline too, so it reads in order. */
export function published(workspace: Workspace, pr: { url: string; number: number }) {
  record(workspace.id, null, { kind: "published", ...pr });
}

/* ── screenshots: copied out of the sandbox as they're taken, so they outlive it ── */

const shotDir = (workspaceId: string) => join(root, "shots", workspaceId);
const shotName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|webp)$/;

async function keepShot(config: CodeConfig, workspace: Workspace, turn: string, name: string, caption?: string) {
  if (!shotName.test(name)) return;
  try {
    const bytes = await sandbox.outbox(config, workspace, name);
    if (bytes.byteLength > 10 * 1024 * 1024) return;
    await mkdir(shotDir(workspace.id), { recursive: true, mode: 0o700 });
    const stored = `${newId(3)}-${name}`;
    await writeFile(join(shotDir(workspace.id), stored), bytes, { mode: 0o600 });
    record(workspace.id, turn, { kind: "image", name: stored, ...(caption ? { caption: caption.slice(0, 200) } : {}) });
    await shotToDrive(db(), workspace, name, bytes).catch((error) => console.warn("Code couldn't put a screenshot in Drive:", error instanceof Error ? error.message : error));
  } catch (error) {
    console.warn("Code couldn't keep a screenshot:", error instanceof Error ? error.message : error);
  }
}

export async function shotBytes(workspace: Workspace, name: string) {
  if (!/^[0-9a-f]{6}-/.test(name) || !shotName.test(name.slice(7))) throw new CodeProblem("That picture isn't here.", 404);
  try { return await readFile(join(shotDir(workspace.id), name)); } catch { throw new CodeProblem("That picture isn't here.", 404); }
}

/** Takes the app's link down. */
export async function stopPreview(config: CodeConfig, workspace: Workspace) {
  if (!workspace.preview) return;
  await sandbox.stopPreview(config, workspace).catch((error) => { if (!(error instanceof CodeProblem && error.status === 404)) throw error; });
  setPreview(db(), workspace.id, null);
  record(workspace.id, null, { kind: "preview-stopped" });
}

/* ── attachments: sent to the sandbox, and a copy kept here so the timeline can show them ── */

const attachmentDir = (workspaceId: string) => join(root, "attachments", workspaceId);
const safeName = (name: string) => name.normalize("NFC").replace(/[\\/\0-\x1f]/g, "").replace(/^\.+/, "").slice(-120) || "file";

export async function attach(config: CodeConfig, workspace: Workspace, user: ApiUser, name: string, type: string, body: Uint8Array): Promise<Attachment> {
  const stored = `${newId(3)}-${safeName(name)}`;
  await sandbox.ensure(config, workspace, who(user));
  const { path } = await sandbox.attach(config, workspace, stored, body);
  await mkdir(attachmentDir(workspace.id), { recursive: true, mode: 0o700 });
  await writeFile(join(attachmentDir(workspace.id), stored), body, { mode: 0o600 });
  return { name: safeName(name), path, size: body.byteLength, type: type || "application/octet-stream" };
}

export async function attachmentBytes(workspace: Workspace, stored: string) {
  if (stored !== safeName(stored) || stored.includes("/")) throw new CodeProblem("That file isn't here.", 404);
  try { return await readFile(join(attachmentDir(workspace.id), stored)); } catch { throw new CodeProblem("That file isn't here.", 404); }
}

export async function forgetAttachments(workspaceId: string) {
  await rm(attachmentDir(workspaceId), { recursive: true, force: true });
  await rm(shotDir(workspaceId), { recursive: true, force: true });
}

export { who };
export { fromDrive, syncDrive, taskFolder } from "./drive";
