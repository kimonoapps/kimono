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
import { sandbox, type Effort, type NodePreview } from "./node";
import { toolSession } from "./composio";
import { accessPrompt, answer as answerAccess_, onRequest, syncOpened } from "./access";
import { portalOrigin } from "../account";
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
  /** What to tell the agent when it should carry on by itself (an access answer), once the current turn ends. */
  carryOn?: Map<string, { user: ApiUser; notes: string[] }>;
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
      appendEvent(opened, workspace, turn, { kind: "done", ok: false, error: "Kimono restarted while it was working." });
    }
    live.db = opened;
  }
  return live.db;
}

/** Chats are for everyone; projects on Kimono Git, and publishing, are for administrators. */
export const allowed = (user: ApiUser) => Boolean(user.username);
export const isAdmin = (user: ApiUser) => user.role === "owner" || user.role === "admin";

/** Refuses project work (repositories, branches, pull requests) to anyone but an administrator, and to a chat. */
export function requireProject(user: ApiUser, workspace?: Workspace) {
  if (!isAdmin(user)) throw new CodeProblem("Projects are for administrators.", 403);
  if (workspace && workspace.kind !== "project") throw new CodeProblem("This chat isn't a project.", 400);
}

/** Runs a Code action for a signed-in user, turning refusals into the JSON errors /api/v1 answers with. */
export async function code(user: ApiUser, work: (config: CodeConfig) => Promise<Response> | Response, needsSetup = true): Promise<Response> {
  try {
    const config = codeConfig(await getPlatformSettings());
    if (!config.enabled) return apiError(404, "Code isn't switched on.");
    if (!allowed(user)) return apiError(403, "Kimono AI isn't for this account.");
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

/**
 * Makes sure a task's sandbox is awake. Waking one past the awake caps puts
 * another task to sleep; that task's timeline says so.
 */
export async function ensure(config: CodeConfig, workspace: Workspace, person: { name: string; email: string }) {
  const answer = await sandbox.ensure(config, workspace, person, await toolSession(db(), config.composioKey, workspace.owner, portalOrigin()));
  for (const id of answer.slept ?? []) {
    try { record(id, null, { kind: "slept", for: workspace.title }); } catch { /* not a task this Portal knows */ }
  }
  return answer;
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
    await ensure(config, workspace, who(user));
    const session = workspaceFor(db(), workspace.id, workspace.owner).session;
    /* Whatever a person changed in Drive since last time goes in first, and the agent is told. */
    await syncDrive(db(), config, workspace).catch((error) => console.warn("Code couldn't sync from Drive:", error instanceof Error ? error.message : error));
    /* Files the person let it use follow Drive, and what is no longer allowed goes. */
    const openedNews = await syncOpened(db(), config, workspace).catch((error) => { console.warn("Kimono AI couldn't sync opened files:", error instanceof Error ? error.message : error); return [] as string[]; });
    /* A command like /compact goes to the agent as it is; the Drive news waits for the next real message. */
    const changed = prompt.startsWith("/") ? [] : [...takeDriveNews(db(), workspace.id), ...openedNews];
    const access = prompt.startsWith("/") ? "" : accessPrompt(db(), workspace);
    const news = changed.length ? `Changed in Drive since last time: ${changed.slice(0, 30).join(", ")}${changed.length > 30 ? `, and ${changed.length - 30} more` : ""}.\n\n` : "";
    const told = `${access ? `${access}\n\n` : ""}${news}${prompt}`;
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
          const app = typeof line.kind === "string" && line.kind ? line.kind.slice(0, 60) : undefined;
          let preview: NodePreview = { url: line.url, port: line.port, kind: app };
          if (chosen && new URL(line.url).hostname.split(".")[0] !== chosen) {
            preview = await sandbox.renamePreview(config, workspace, chosen).catch(() => preview);
          }
          setPreview(db(), workspace.id, preview);
          record(workspace.id, turn, { kind: "preview", url: preview.url, port: preview.port, ...(app ? { app } : {}) });
          continue;
        }
        if (line.type === "kimono.access" && typeof line.id === "string" && typeof line.space === "string" && typeof line.why === "string" && (line.need === "read" || line.need === "change")) {
          try {
            const asked = await onRequest(db(), config, workspace, turn, { id: line.id, space: line.space, path: typeof line.path === "string" ? line.path : "", need: line.need, why: line.why });
            record(workspace.id, turn, asked.event);
            if (asked.carryOn) noteCarryOn(workspace.id, user, asked.carryOn);
          } catch (error) { console.warn("Kimono AI couldn't take an access request:", error instanceof Error ? error.message : error); }
          continue;
        }
        if ((line.type === "kimono.disk" || line.type === "kimono.disk.full") && typeof line.used === "number" && typeof line.quota === "number") {
          record(workspace.id, turn, { kind: "disk", used: line.used, quota: line.quota, ...(line.type === "kimono.disk.full" ? { full: true } : {}) });
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
    /* What the agent made goes to Drive, and what it changed in the person's own files goes back to them. */
    void syncDrive(db(), config, workspace).catch((error) => console.warn("Code couldn't sync to Drive:", error instanceof Error ? error.message : error));
    const wroteBack = syncOpened(db(), config, workspace).catch((error) => { console.warn("Kimono AI couldn't write back opened files:", error instanceof Error ? error.message : error); return []; });
    /* Anything sent while it worked starts the next turn straight away, after any note it should carry on with. */
    const waiting = live.queued?.get(workspace.id) ?? [];
    const carry = live.carryOn?.get(workspace.id);
    live.queued?.delete(workspace.id);
    live.carryOn?.delete(workspace.id);
    if (waiting.length || carry) {
      void wroteBack.then(() => {
        try {
          const by = waiting[0]?.user ?? carry!.user;
          checkShare(config, by);
          const next = startTurn(db(), workspace.id);
          const said = [...(carry?.notes ?? []), ...waiting.map((m) => m.prompt)].filter(Boolean).join("\n\n");
          void run(config, workspace, by, next, said || "Look at the attached files.", waiting.flatMap((m) => m.attachments), waiting.at(-1)?.effort);
        } catch (error) { console.warn("Code couldn't start the next turn:", error instanceof Error ? error.message : error); }
      });
    }
  }
}

/* ── access to the person's Drive ── */

function noteCarryOn(workspaceId: string, user: ApiUser, note: string) {
  const map = (live.carryOn ??= new Map());
  const now = map.get(workspaceId) ?? { user, notes: [] };
  now.notes.push(note);
  map.set(workspaceId, now);
}

/** The person answers a request for their files; the agent carries on with what they said. */
export async function answerAccess(config: CodeConfig, workspace: Workspace, user: ApiUser, requestId: string, choice: unknown, fileId: unknown) {
  if (choice !== "file" && choice !== "chat" && choice !== "always" && choice !== "deny") throw new CodeProblem("Answer with file, chat, always or deny.");
  await ensure(config, workspace, who(user));
  const answered = await answerAccess_(db(), config, workspace, user.username, requestId, choice, typeof fileId === "string" ? fileId : undefined);
  const busy = runningTurn(db(), workspace.id);
  const recorded = record(workspace.id, busy, answered.event);
  if (busy) {
    noteCarryOn(workspace.id, user, answered.carryOn);
  } else {
    checkShare(config, user);
    const next = startTurn(db(), workspace.id);
    void run(config, workspace, user, next, answered.carryOn, []);
  }
  return recorded;
}

/** Gives a task's app link a name its owner chose; the old link stops answering. */
export async function renamePreview(config: CodeConfig, workspace: Workspace, name: string) {
  const clean = name.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(clean) || clean.includes("--")) throw new CodeProblem("Use letters, numbers and single dashes, up to 50 characters.");
  const preview = await sandbox.renamePreview(config, workspace, clean);
  setPreview(db(), workspace.id, preview);
  setPreviewName(db(), workspace.id, clean);
  record(workspace.id, runningTurn(db(), workspace.id), { kind: "preview", url: preview.url, port: preview.port, ...(preview.kind ? { app: preview.kind } : {}) });
  return preview;
}

/** What the task's sandbox may use, and its disk as last measured. Doesn't wake it. */
export async function sandboxStatus(config: CodeConfig, workspace: Workspace) {
  const state = await sandbox.state(config, workspace);
  return { limits: state.limits, disk: state.disk };
}

/** How the app is doing now, and the end of its log. What the node says is kept, so the list agrees. */
export async function previewStatus(config: CodeConfig, workspace: Workspace) {
  if (!workspace.preview) throw new CodeProblem("This chat isn't running an app.", 404);
  const [status, log] = await Promise.all([
    sandbox.preview(config, workspace),
    sandbox.previewLogs(config, workspace).catch(() => ""),
  ]);
  if (status.kind !== (workspace.preview.kind ?? undefined) || Boolean(status.stopped) !== workspace.preview.stopped) setPreview(db(), workspace.id, status);
  return { health: status.health, log };
}

/** Starts the app again (or for the first time since it was stopped), keeping its link. */
export async function restartPreview(config: CodeConfig, workspace: Workspace) {
  if (!workspace.preview) throw new CodeProblem("This chat isn't running an app.", 404);
  const preview = await sandbox.restartPreview(config, workspace);
  setPreview(db(), workspace.id, preview);
  return preview;
}

/** Stops the app but keeps its link and name; opening the link says it isn't running. */
export async function pausePreview(config: CodeConfig, workspace: Workspace) {
  if (!workspace.preview) throw new CodeProblem("This chat isn't running an app.", 404);
  const preview = await sandbox.pausePreview(config, workspace);
  setPreview(db(), workspace.id, preview);
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
  await ensure(config, workspace, who(user));
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
