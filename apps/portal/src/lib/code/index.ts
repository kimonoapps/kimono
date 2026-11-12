import "server-only";

import { mkdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apiError, type ApiUser } from "../api-v1";
import { getPlatformSettings } from "../settings";
import { stateDir } from "../state";
import { codeConfig, missing, type CodeConfig } from "./config";
import { finish, toolHint, translate, type ArtifactCall, type Attachment, type CodeEvent, type SentFile, type TurnResult } from "./events";
import { typeOf } from "../drive/storage";
import { backfillRatingFiles, backfillRatings, keepPick, kimonoVersion, type Versions } from "./feedback";
import { islamNoticeNote, isSkillCommand, madeSkillId, madeSkillsDir, noticeSeen, saveMadeSkill, skillsForTurn } from "./skills";
import { bounded } from "./bounded";
import { applyEdits, artifactOf, Drafts, maxMediaBytes, mediaNames, saveArtifact } from "./artifacts";
import {
  abandonRunningTurns, appendEvent, keepThinking, keepToolCall, sandboxStartedOver, awaitsName, CodeProblem, endTurn, eventsAfter, migrate, nameWorkspace, noteTurnEnd, rewindTo, titleFrom, newId, recordUsage, extraOf, setLastModel, runningTurn, setPreviewName, setTurnByOwner, turnByOwner, turnsByOwner, usageOf, setPreview, setSession, startTurn, takeDriveNews, workspaceFor, workspacesOf,
  type StoredEvent, type Workspace,
} from "./model";
import { sandbox, type Effort, type NodePreview } from "./node";
import { ProgressProbe, progressFile } from "./progress-probe";
import { instantCostOf, toolSession } from "./composio";
import { guardMediaBudget, holdMediaBudget, lastAllowance, mediaNote, ranAsPro } from "./media";
import { changeMemory, contextFor, forget, profileOf, remember } from "./memory";
import { effortFor, modelFor, weigh, type ModelChoice } from "./models";
import { dropTakes, keepTake, lastTurnEnd, takeOf, leaningsOf, noteTake, startTakes, takeKindFor, takePlan, triedKinds, withNote, type TakeKind } from "./takes";
export { modelChoices, type ModelChoice } from "./models";
import { accessPrompt, answer as answerAccess_, grantedAhead, onRequest, syncOpened } from "./access";
import { portalOrigin } from "../account";
import { serveTempLink, tempLinkBase, tempLinkKey } from "./temp-links";
export { efforts, type Effort } from "./node";
import { markChat, retitle, shotToDrive, syncDrive, treeAhead } from "./drive";
import { hasHistory, historyNote, syncHistory } from "./history";
import { answersOf, answerText, askedId, askNote, isAskCommand, questionsDir, questionsOf } from "./questions";
import { gitAccountOf, ownProject } from "./forgejo";
import { suggestTitle } from "./title";
import { db as driveDb } from "../drive";
import { notesConfig } from "../notes/config";
import { ensureNotebook } from "../notes/model";
import { notesGuide } from "../notes/agent";

export * from "./model";
export * from "./sharing";
export type { CodeEvent, Attachment } from "./events";

const root = join(stateDir, "code");
/** The largest attachment: 20 MB, which is what the node takes. */
export const maxAttachmentBytes = 20 * 1024 * 1024;

type Live = {
  db?: DatabaseSync;
  listeners: Map<string, Set<(event: StoredEvent) => void>>;
  turns: Map<string, AbortController>;
  /** Messages sent while a turn was running, per workspace: the next turn reads them. */
  queued?: Map<string, { user: ApiUser; prompt: string; attachments: Attachment[]; effort?: Effort; model?: ModelChoice; seq?: number }[]>;
  /** Of those, the ones handed to the running agent (.kimono/steer/<seq>.txt), not yet read, per workspace. */
  steering?: Map<string, Set<number>>;
  /** What to tell the agent when it should carry on by itself (an access answer), once the current turn ends. */
  carryOn?: Map<string, { user: ApiUser; notes: string[] }>;
  /** The long job each workspace's card is following, read from its sandbox (ProgressProbe); one at a time. */
  probes?: Map<string, ProgressProbe>;
  /** The jobs each workspace's cards have followed, so an old card in the sandbox is never taken for a new one. */
  claimed?: Map<string, Set<string>>;
};
/* One connection and one set of listeners for the process, kept across hot reloads in development. */
const cache = globalThis as unknown as { kimonoCode?: Live; kimonoTyping?: Map<string, Map<string, number>> };
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
    migrated = true;
  }
  /* A hot reload keeps the connection but brings new code: bring the schema along. */
  if (!migrated) { migrate(live.db); migrated = true; }
  if (!chatsMarked) { chatsMarked = true; markOldChats(live.db); }
  if (!ratingsFilled) { ratingsFilled = true; backfillRatings(live.db); backfillRatingFiles(live.db); }
  return live.db;
}
let migrated = false;
let ratingsFilled = false;
let chatsMarked = false;

/* Chats made before Drive knew a chat's folder from any other get marked once, so Drive shows them as chats. */
function markOldChats(database: DatabaseSync) {
  try {
    const owners = (database.prepare("SELECT DISTINCT owner FROM workspaces WHERE drive_folder IS NOT NULL").all() as { owner: string }[]).map((r) => r.owner);
    for (const owner of owners) for (const workspace of workspacesOf(database, owner)) markChat(workspace);
  } catch (error) {
    console.warn("Kimono AI couldn't mark its chats in Drive:", error instanceof Error ? error.message : error);
  }
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

/**
 * Like [code], for what a chat's link may open without signing in: [user] may be null.
 * Whoever it is, the work decides what they may see (lib/code/sharing.ts).
 */
export async function codeOpen(user: ApiUser | null, work: (config: CodeConfig) => Promise<Response> | Response): Promise<Response> {
  if (user) return code(user, work, false);
  try {
    const config = codeConfig(await getPlatformSettings());
    if (!config.enabled) return apiError(404, "Code isn't switched on.");
    /* Public links switched off: a link still opens, but only for someone signed in. */
    if (!config.publicLinks) return apiError(401, "Sign in to open this.");
    return await work(config);
  } catch (error) {
    if (error instanceof CodeProblem) return apiError(error.status, error.message);
    console.warn("Code request failed:", error instanceof Error ? error.message : error);
    return apiError(500, "Code couldn't do that. Try again in a moment.");
  }
}

/** A chat link's token, when a request carries one (?share=). */
export const shareOf = (request: Request) => new URL(request.url).searchParams.get("share");

/* ── the timeline, live ── */

function record(workspaceId: string, turnId: string | null, event: CodeEvent) {
  const stored = appendEvent(db(), workspaceId, turnId, event);
  for (const listener of live.listeners.get(workspaceId) ?? []) {
    try { listener(stored); } catch { /* a closed stream; it unsubscribes itself */ }
  }
  return stored;
}

/** Sends something to whoever is watching without keeping it: what the agent is writing right now. */
function broadcast(workspaceId: string, turnId: string | null, event: CodeEvent) {
  const passing: StoredEvent = { seq: 0, turn: turnId, at: Date.now(), event };
  for (const listener of live.listeners.get(workspaceId) ?? []) {
    try { listener(passing); } catch { /* a closed stream */ }
  }
}

/**
 * Follows the card a kimono-progress start put up (tool call `id`): its state is read from the sandbox every
 * couple of seconds and recorded as it changes, so the card moves with the job, not the agent's checks.
 */
function followProgress(config: CodeConfig, workspace: Workspace, turn: string, id: string, label: string) {
  live.probes?.get(workspace.id)?.stop();
  const claimed = (live.claimed ??= new Map()).get(workspace.id) ?? new Set<string>();
  live.claimed.set(workspace.id, claimed);
  const read = async () => {
    const response = await sandbox.file(config, workspace, progressFile);
    return response.ok ? await response.text() : undefined;
  };
  const probe = new ProgressProbe(read, (event) => { try { record(workspace.id, turn, event); } catch { probe.stop(); } }, claimed);
  (live.probes ??= new Map()).set(workspace.id, probe);
  probe.start(id, label);
  return probe;
}

/** Keeps the artifact a finished Write, Edit or kimono-show left in the sandbox, and tells the page. */
async function keepArtifact(config: CodeConfig, workspace: Workspace, turn: string, call: ArtifactCall) {
  const kept = artifactOf(db(), workspace.id, call.name);
  let content: string | null = call.action === "wrote" ? call.content ?? "" : call.action === "edited" && kept ? applyEdits(kept.content, call.edits ?? []) : null;
  if (content === null) {
    /* Changed some other way, or shown before Kimono kept it: read it from the sandbox. */
    const response = await sandbox.file(config, workspace, `artifacts/${call.name}.html`).catch(() => null);
    if (!response?.ok) return;
    content = await response.text();
  }
  /* Its media first, so whoever shows the saved page finds the files it names (they may have changed under the same names). */
  await keepMedia(config, workspace, content);
  if (kept && kept.content === content) return;
  const saved = saveArtifact(db(), workspace.id, call.name, content);
  record(workspace.id, turn, { kind: "artifact-saved", name: saved.name, version: saved.version, title: saved.title });
}

/** Where a chat's artifact media is kept: media/<chat>/<file>, served at /ai/media/<key>/<file>. */
export const mediaDir = (workspaceId: string) => join(root, "media", workspaceId);

/** Copies the media an artifact's page names (media/<file>) out of the sandbox's /workspace/media/. */
async function keepMedia(config: CodeConfig, workspace: Workspace, content: string) {
  const names = mediaNames(content);
  if (!names.length) return;
  const dir = mediaDir(workspace.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await bounded(names, 4, async (name) => {
    const response = await sandbox.file(config, workspace, `media/${name}`, true).catch(() => null);
    if (!response?.ok || !response.body) return;
    const target = join(dir, name);
    /* Said too big: not read at all. */
    if (Number(response.headers.get("content-length")) > maxMediaBytes) { await response.body.cancel().catch(() => {}); return; }
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > maxMediaBytes) return;
    /* Beside it first, then into place: a page playing it never reads half a file. */
    const part = `${target}.${newId(3)}.part`;
    try {
      await writeFile(part, body, { mode: 0o600 });
      await rename(part, target);
    } catch (error) {
      await rm(part, { force: true });
      throw error;
    }
  });
}

/** Copies the files kimono-send gave the person out of the sandbox, beside their attachments, and puts them in the chat. */
async function keepSent(config: CodeConfig, workspace: Workspace, turn: string, sent: SentFile[]) {
  const files: Attachment[] = [];
  for (const file of sent) {
    const response = await sandbox.file(config, workspace, file.path, true).catch(() => null);
    if (!response?.ok) continue;
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > maxAttachmentBytes) continue;
    const name = safeName(file.name);
    const stored = `${newId(3)}-${name}`;
    await mkdir(attachmentDir(workspace.id), { recursive: true, mode: 0o700 });
    await writeFile(join(attachmentDir(workspace.id), stored), body, { mode: 0o600 });
    files.push({ name, path: `/attachments/${stored}`, size: body.byteLength, type: typeOf(name).split(";")[0] });
  }
  if (files.length) record(workspace.id, turn, { kind: "sent", files });
}

/* ── who's typing in a shared chat: held a few seconds in memory, never kept ── */

const typingFor = 6000;
const typing: Map<string, Map<string, number>> = (cache.kimonoTyping ??= new Map());

/** [username] is typing in chat [workspaceId]: whoever is watching it hears so, and the lists ask. */
export function typingIn(workspaceId: string, username: string, now = Date.now()) {
  const here = typing.get(workspaceId) ?? new Map<string, number>();
  here.set(username, now + typingFor);
  typing.set(workspaceId, here);
  /* The page says so every few seconds while it's typed in; each one keeps it showing a few seconds more. */
  broadcast(workspaceId, null, { kind: "typing", by: username });
}

/** Who is typing now in each of these chats, leaving out [me]. Only chats with someone typing are named. */
export function typersIn(ids: string[], me: string, now = Date.now()): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of ids) {
    const here = typing.get(id);
    if (!here) continue;
    for (const [who, until] of here) if (until <= now) here.delete(who);
    if (!here.size) { typing.delete(id); continue; }
    const others = [...here.keys()].filter((who) => who !== me.toLowerCase());
    if (others.length) out[id] = others;
  }
  return out;
}

/* ── steering: a message sent while the agent works is read at its next step ── */

async function steer(config: CodeConfig, workspace: Workspace, user: ApiUser, seq: number, prompt: string) {
  try {
    const from = workspace.owner === user.username.toLowerCase() ? "" : `From ${user.name || user.username}: `;
    await sandbox.write(config, workspace, `.kimono/steer/${seq}.txt`, new TextEncoder().encode(from + prompt));
    const pending = (live.steering ??= new Map()).get(workspace.id) ?? new Set<number>();
    pending.add(seq);
    live.steering.set(workspace.id, pending);
  } catch (error) { console.warn("Kimono AI couldn't hand a message to the running agent:", error instanceof Error ? error.message : error); }
}

/** Which handed-over messages the agent has read (their files gone): marked read on the timeline, and out of the queue for the next turn. */
async function checkSteered(config: CodeConfig, workspace: Workspace, turn: string) {
  const pending = live.steering?.get(workspace.id);
  if (!pending?.size) return;
  const listed = await sandbox.files(config, workspace, ".kimono/steer").catch((error) => error instanceof CodeProblem && error.status === 404 ? { entries: [] } : null);
  if (!listed) return;
  const left = new Set(listed.entries.map((e) => Number.parseInt(e.name, 10)));
  const read = [...pending].filter((seq) => !left.has(seq));
  if (!read.length) return;
  for (const seq of read) pending.delete(seq);
  const queue = live.queued?.get(workspace.id);
  if (queue) live.queued!.set(workspace.id, queue.filter((m) => m.seq === undefined || !read.includes(m.seq)));
  try { record(workspace.id, turn, { kind: "steered", seqs: read }); } catch { /* the chat was deleted */ }
}

/** Takes back what was handed over and not read, so a later turn doesn't find it again. */
async function unsteer(config: CodeConfig, workspace: Workspace) {
  const pending = live.steering?.get(workspace.id);
  live.steering?.delete(workspace.id);
  for (const seq of pending ?? []) await sandbox.removeFile(config, workspace, `.kimono/steer/${seq}.txt`).catch(() => {});
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
/**
 * Records what a Pro Tool call cost, once Composio's log has it: it lands a few
 * seconds after the call answers, so it's looked for then, and again a little
 * later. Nothing is shown for a call that cost nothing.
 */
function priceProCall(config: CodeConfig, workspace: Workspace, turn: string, id: string, call: { at: number; tools: string[] }) {
  const look = async (tries: number) => {
    const usd = await instantCostOf(config.composioKey, workspace.owner, portalOrigin(), call.tools, call.at - 5_000, Date.now()).catch(() => null);
    if (usd === null) { if (tries > 1) setTimeout(() => void look(tries - 1), 20_000); return; }
    if (usd <= 0) return;
    try { record(workspace.id, turn, { kind: "tool-cost", id, usd }); } catch { /* the chat was deleted meanwhile */ }
  };
  setTimeout(() => void look(3), 4_000);
}

/** [owner] false: someone the chat is shared with is asking, and the owner's connected apps stay out of it. */
export async function ensure(config: CodeConfig, workspace: Workspace, person: { name: string; email: string }, { owner = true } = {}) {
  /* A project still in Kimono AI's own Kimono Git account moves to its person's, once they have one. */
  workspace = await ownProject(db(), config, workspace, { username: workspace.owner });
  /* Their Kimono Git account, found by email (its username may not be theirs in Kimono), for the node to open pull requests as. */
  const [gitLogin, tools] = await Promise.all([
    workspace.kind === "project" ? gitAccountOf(config, { username: workspace.owner }, false).catch(() => null) : null,
    owner ? toolSession(db(), config.composioKey, workspace.owner, portalOrigin()) : null,
  ]);
  /* Their paid tools open or close with this month's allowance. Once it has been read, the turn goes on with that
     reading while it's checked again (nothing is spent before the agent calls a tool, and each tool call checks
     too); only the first time since Portal started does the agent wait for it, alongside the node readying the sandbox. */
  const held = tools ? holdMediaBudget(db(), config, workspace.owner, portalOrigin()).catch((error) => console.warn("Kimono AI couldn't check the Pro Tools allowance:", error instanceof Error ? error.message : error)) : null;
  const [, answer] = await Promise.all([
    lastAllowance(workspace.owner) ? null : held,
    sandbox.ensure(config, workspace, person, tools, gitLogin),
  ]);
  /* A new, empty sandbox: what was synced into the old one must go back in, not be taken as deleted. */
  if (answer.fresh) sandboxStartedOver(db(), workspace.id);
  awake.at.set(workspace.id, Date.now());
  for (const id of answer.slept ?? []) {
    awake.at.delete(id);
    /* A project is told it was put to sleep (its app stopped); a plain chat just wakes when it's opened. */
    const repo = (db().prepare("SELECT repo_name FROM workspaces WHERE id = ?").get(id) as { repo_name?: string | null } | undefined)?.repo_name;
    if (!repo) continue;
    try { record(id, null, { kind: "slept", for: workspace.title }); } catch { /* not a task this Portal knows */ }
  }
  return answer;
}

/* When each sandbox was last made ready, and the readying under way: kept across dev reloads. */
const awake = ((globalThis as { __kimonoAwake?: { at: Map<string, number>; going: Map<string, Promise<unknown>> } }).__kimonoAwake ??= { at: new Map(), going: new Map() });
const awakeFor = 60_000;

/**
 * Reading from a sandbox (a file, a folder, the changes): [ensure] costs several
 * calls (Git, tools, the allowance, the node) before the first byte, so one
 * made ready in the last minute is read straight away. If that read fails, it
 * is made ready once more and read again. Reads at the same moment share one readying.
 */
export async function readFromSandbox<T>(config: CodeConfig, workspace: Workspace, person: { name: string; email: string }, work: () => Promise<T>): Promise<T> {
  const ready = () => {
    let going = awake.going.get(workspace.id);
    if (!going) {
      going = ensure(config, workspace, person).finally(() => awake.going.delete(workspace.id));
      awake.going.set(workspace.id, going);
    }
    return going;
  };
  if (Date.now() - (awake.at.get(workspace.id) ?? 0) > awakeFor) { await ready(); return work(); }
  try {
    return await work();
  } catch (error) {
    /* Not there, or not allowed: the sandbox answered, so waking it wouldn't change that. */
    if (error instanceof CodeProblem && error.status < 500 && error.status !== 409) throw error;
    awake.at.delete(workspace.id);
    await ready();
    return work();
  }
}

const who = (user: ApiUser) => ({ name: user.name || user.username, email: user.email || `${user.username}@users.kimono` });

/** Who it's talking with and what day it is: the model knows neither by itself. */
const aboutNow = (name: string, at = Date.now()) => `The person's name is ${name}: use it for things they sign or send, but don't call them by it unless they do. Today is ${new Date(at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;

const clock = (at: number) => new Date(at).toLocaleString("en", { weekday: "short", hour: "numeric", minute: "2-digit" });

/** Refuses a person who has used their share of the plan's 5-hour or weekly window. The owner has no share: it's their plan. */
export function checkShare(config: CodeConfig, user: ApiUser) {
  if (user.role === "owner") return;
  const used = usageOf(db(), user.username), extra = extraOf(db(), user.username);
  if (used.fiveHour.used >= config.shares.fiveHour + extra.fiveHour) throw new CodeProblem(`You've used your share of this 5-hour window. It opens again ${clock(used.fiveHour.resetsAt!)}.`, 429);
  if (used.week.used >= config.shares.week + extra.week) throw new CodeProblem(`You've used your share for this week. It opens again ${clock(used.week.resetsAt!)}.`, 429);
}

/** Sends a message to the agent and returns at once; the turn runs on, recording as it goes. */
export function ask(config: CodeConfig, workspace: Workspace, user: ApiUser, text: string, attachments: Attachment[], effort?: Effort, model?: ModelChoice, /** The app it was sent from can show two takes side by side. */ canTake = false) {
  const prompt = text.trim();
  if (!prompt && !attachments.length) throw new CodeProblem("Say what to do.");
  if (prompt.length > 32_000) throw new CodeProblem("That message is too long.");
  checkShare(config, user);
  /* Steering: while the agent works, a message waits in line and the next turn starts with it. */
  const busy = runningTurn(db(), workspace.id);
  if (busy) {
    const queue = (live.queued ??= new Map());
    const asked = record(workspace.id, busy, { kind: "ask", by: user.username, text: prompt, attachments, queued: true });
    queue.set(workspace.id, [...(queue.get(workspace.id) ?? []), { user, prompt, attachments, effort, model, seq: asked.seq }]);
    /* Handed to the agent as it works: its hooks read it after the next step (cli/internal/sandbox SteerSettings). */
    /* Only into a turn for the same side: someone the chat is shared with never steers the owner's turn, which has the owner's apps and files. */
    const sameSide = turnByOwner(db(), busy) === (user.username.toLowerCase() === workspace.owner);
    if (prompt && !attachments.length && sameSide) void steer(config, workspace, user, asked.seq, prompt);
    return asked;
  }
  const turn = startTurn(db(), workspace.id);
  const asked = record(workspace.id, turn, { kind: "ask", by: user.username, text: prompt, attachments });
  void run(config, workspace, user, turn, prompt || "Look at the attached files.", attachments, effort, model, undefined, { canTake });
  return asked;
}

/**
 * The person changed a message they sent earlier: it and everything after it go, and it runs again
 * from that point, the agent's session carried on from its last message before it.
 */
export function editAsk(config: CodeConfig, workspace: Workspace, user: ApiUser, seq: number, text: string, effort?: Effort, model?: ModelChoice) {
  const prompt = text.trim();
  if (!prompt) throw new CodeProblem("Say what to do.");
  if (prompt.length > 32_000) throw new CodeProblem("That message is too long.");
  if (runningTurn(db(), workspace.id)) throw new CodeProblem("Stop it first, or wait until it's done.", 409);
  checkShare(config, user);
  const asked = eventsAfter(db(), workspace.id, seq - 1, 1)[0];
  if (!asked || asked.seq !== seq || asked.event.kind !== "ask") throw new CodeProblem("That message isn't here.", 404);
  if (asked.event.by.toLowerCase() !== user.username.toLowerCase()) throw new CodeProblem("You can only change your own messages.", 403);
  const attachments = asked.event.attachments;
  const { resume, before } = rewindTo(db(), workspace.id, seq);
  live.queued?.delete(workspace.id);
  /* Whoever is watching starts the chat again from what's left. */
  broadcast(workspace.id, null, { kind: "rewound", seq });
  let rewound: Rewound | undefined;
  if (resume?.session && resume.at) { setSession(db(), workspace.id, resume.session); rewound = { at: resume.at }; }
  else {
    setSession(db(), workspace.id, null);
    if (resume) rewound = { before: transcriptOf(before) };
  }
  const turn = startTurn(db(), workspace.id);
  const recorded = record(workspace.id, turn, { kind: "ask", by: user.username, text: prompt, attachments });
  void run(config, workspace, user, turn, prompt, attachments, effort, model, rewound);
  return recorded;
}

/** The conversation as words only, its latest part kept when it's long: who asked what, and what it answered. */
function transcriptOf(events: StoredEvent[], budget = 16_000): string {
  const lines: string[] = [];
  for (const { event } of events) {
    if (event.kind === "ask" && event.text) lines.push(`Person: ${event.text}`);
    else if (event.kind === "text" && event.text.trim()) lines.push(`You: ${event.text.trim()}`);
  }
  let text = lines.join("\n\n");
  if (text.length > budget) text = `…${text.slice(text.length - budget)}`;
  return text;
}

/** How an edited message picks up: carrying the session on from a message of it, or a fresh one told what came before. */
type Rewound = { at: string } | { before: string };

/** How a turn runs besides its message: whether it may answer with two takes, or that it is the second of two. */
type RunOptions = {
  canTake?: boolean;
  /** The second take (takes.ts): the same message, carried on from the same point of the session in a new one. */
  take?: { id: string; kind: TakeKind; session: string | null; at: string | null; told: string };
};

async function run(config: CodeConfig, workspace: Workspace, user: ApiUser, turn: string, prompt: string, attachments: Attachment[], effort?: Effort, choice?: ModelChoice, rewound?: Rewound, options: RunOptions = {}) {
  /* Which Claude answers: what the person chose, or on Auto the chat's model, Opus once it builds. */
  const building = workspace.kind === "project" || Boolean(workspace.preview);
  const model = modelFor(choice, { prompt, attachments: attachments.length, building, last: workspace.lastModel });
  /* Someone the chat is shared with writes as themself: the owner's connected
     apps, memories, earlier chats and Drive are the owner's alone. */
  const byOwner = user.username.toLowerCase() === workspace.owner;
  /* Now and then two takes on one message, for the person to keep one (takes.ts): the second carries the
     session on from where the first began, so both need a point to carry on from (none before a first message). */
  const second = options.take;
  let take: { id: string; kind: TakeKind; n: 0 | 1; before?: { session: string | null; at: string | null } } | null = second ? { id: second.id, kind: second.kind, n: 1 } : null;
  if (!take) {
    const kind = takeKindFor({ weight: weigh({ prompt, attachments: attachments.length, building }), prompt, choice, attachments: attachments.length, byOwner, canShow: options.canTake === true, rewound: Boolean(rewound), tried: triedKinds(db(), workspace.owner) });
    const before = kind ? lastTurnEnd(db(), workspace.id, turn) ?? { session: null, at: null } : null;
    const current = workspaceFor(db(), workspace.id, workspace.owner).session;
    if (kind && before && (before.session ? before.at && before.session === current : !current)) {
      take = { id: startTakes(db(), { workspace: workspace.id, turn, username: workspace.owner, kind, session: before.session, at: before.at }), kind, n: 0, before };
    }
  }
  const plan = take ? takePlan(take.kind) : null;
  /* How hard it thinks: on Auto what the message needs, and not at all for a quick one; Sonnet and Haiku stop at medium. */
  const thought = effortFor(model, { choice, effort, prompt, attachments: attachments.length, building, considered: byOwner && leaningsOf(db(), workspace.owner).depth === "considered" });
  if (take && plan?.thinking) thought.thinking = plan.thinking[take.n];
  effort = thought.effort;
  setLastModel(db(), workspace.id, model);
  setTurnByOwner(db(), turn, byOwner);
  const controller = new AbortController();
  live.turns.set(turn, controller);
  if (take) record(workspace.id, turn, { kind: "take", id: take.id, n: take.n, of: take.kind });
  record(workspace.id, turn, { kind: "started" });
  /* The message as the agent read it, for a second take to read the same. */
  let told = "";
  let result: TurnResult | null = null;
  let done: { exit?: number; cancelled?: boolean } | null = null;
  let failure: string | undefined;
  let context: number | undefined;
  let drafts: Drafts | null = null;
  /* The agent's last message this turn, which a later edit carries the session on from. */
  let lastMessage: string | null = null;
  /* Calls to the person's own tools still waiting for their answer. */
  const composioCalls = new Set<string>();
  const proCalls = new Map<string, { at: number; tools: string[] }>();
  /* The card this turn put up, if any: followed on after the turn only while the sandbox watches its job. */
  let probe: ProgressProbe | undefined;
  /* kimono-ask calls, by id, until they answer with the questions they wrote. */
  const asking = new Set<string>();
  /* kimono-skill calls, by id, until they answer with the skill they wrote. */
  const making = new Set<string>();
  try {
    const timing = { start: Date.now(), ensured: 0, synced: 0, agent: 0, firstWord: 0 };
    /* A sandbox made ready in the last few minutes is still there (the node stops one after 15 quiet minutes):
       what's in it is read while it's made ready, instead of after, a round trip to the node less before the agent starts. */
    const warm = Date.now() - (awake.at.get(workspace.id) ?? 0) < 14 * 60_000 && !second;
    const ahead = warm ? { tree: treeAhead(config, workspace), granted: grantedAhead(db(), config, workspace) } : null;
    const ready = await ensure(config, workspace, who(user), { owner: byOwner });
    /* A new, empty sandbox after all: what was read ahead isn't it. */
    if (ready.fresh && ahead) { ahead.tree = null; ahead.granted = null; }
    timing.ensured = Date.now();
    const session = second ? second.session : workspaceFor(db(), workspace.id, workspace.owner).session;
    /* The person's other chats, for it to look back on (none in a chat shared with others). Each is a file written
       into the sandbox, so a first chat of someone with many would wait seconds for them: the agent starts as they
       go in, told they're there (it only looks back when it needs to, and they're in by then). */
    void syncHistory(db(), config, workspace).catch((error) => console.warn("Kimono AI couldn't bring earlier chats in:", error instanceof Error ? error.message : error));
    const history = hasHistory(db(), workspace);
    /* Whatever a person changed in Drive since last time goes in first, and the agent is told. The task's
       files and the ones the person let it use (.kimono/files) are apart, so both sync at once. */
    const driveSynced = syncDrive(db(), config, workspace, { tree: ahead?.tree }).catch((error) => console.warn("Code couldn't sync from Drive:", error instanceof Error ? error.message : error));
    /* Files the person let it use follow Drive, and what is no longer allowed goes. */
    const openedSynced = syncOpened(db(), config, workspace, { readOnly: turnsByOwner(db(), workspace.id, 2)[1] === false, tree: ahead?.granted }).catch((error) => { console.warn("Kimono AI couldn't sync opened files:", error instanceof Error ? error.message : error); return [] as string[]; });
    /* With Notes on, the person has a notebook before it is named, so the agent can write to it from the first chat. */
    const [, openedNews, notes] = await Promise.all([driveSynced, openedSynced, byOwner ? notesFor(workspace.owner) : ""]);
    timing.synced = Date.now();
    /* A command like /compact goes to the agent as it is; the Drive news waits for the next real message. */
    const changed = prompt.startsWith("/") || second ? [] : [...takeDriveNews(db(), workspace.id), ...openedNews];
    const access = prompt.startsWith("/") || !byOwner ? "" : accessPrompt(db(), workspace);
    const news = changed.length ? `Changed in Drive since last time: ${changed.slice(0, 30).join(", ")}${changed.length > 30 ? `, and ${changed.length - 30} more` : ""}.\n\n` : "";
    /* Someone the chat was shared with wrote this: it should know who it's answering. */
    const from = user.username.toLowerCase() !== workspace.owner ? `(This message is from ${who(user).name}, whom ${workspace.owner} shared this chat with.)\n\n` : "";
    /* An edited message in a chat from before turns kept their place: a new session, told the conversation so far. */
    const earlier = rewound && "before" in rewound && rewound.before ? `(The person went back and changed one of their messages, so this conversation starts again from it. What was said before it:)\n\n${rewound.before}\n\n(Their changed message:)\n\n` : "";
    told = second ? second.told : `${access ? `${access}\n\n` : ""}${news}${earlier}${from}${prompt}`;
    const input = { prompt: plan && take ? withNote(told, plan.notes[take.n]) : told, ...(second?.session ? { fork: true } : {}), session, attachments: attachments.map((a) => a.path), effort, thinking: thought.thinking, model, context: [...(byOwner ? [aboutNow(who(user).name), contextFor(db(), workspace.owner), notes, history ? historyNote : "", mediaNote(lastAllowance(workspace.owner))] : []), askNote, noticeSeen(db(), user.username, "islam") ? "" : islamNoticeNote].filter(Boolean).join("\n\n"), resumeAt: second ? second.at : rewound && "at" in rewound ? rewound.at : null, links: tempLinkBase(portalOrigin(), workspace.id), linkKey: tempLinkKey(workspace.id), ...skillsForTurn(db(), workspace.owner, byOwner) };
    const response = await sandbox.turn(config, workspace, input, controller.signal).catch(async (error) => {
      /* The sandbox lost the chat's session (its container was made again): a new
         one is told the conversation so far, so it never starts from nothing. */
      if (!(error instanceof CodeProblem && error.status === 410)) throw error;
      if (!second) setSession(db(), workspace.id, null);
      const said = transcriptOf(eventsAfter(db(), workspace.id, 0, 100_000).filter((e) => e.turn !== turn));
      const carried = said ? `(Your earlier messages in this chat were lost, but the conversation so far was kept. What was said before this message:)\n\n${said}\n\n(Their new message:)\n\n` : "";
      return sandbox.turn(config, workspace, { ...input, prompt: withNote(`${access ? `${access}\n\n` : ""}${news}${carried}${from}${prompt}`, plan && take ? plan.notes[take.n] : ""), session: null, resumeAt: null, fork: false }, controller.signal);
    });
    timing.agent = Date.now();
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    /* What it is writing, as it writes it; and the artifact calls waiting for their results. */
    drafts = new Drafts((draft) => broadcast(workspace.id, turn, draft), { describe: toolHint });
    const pendingArtifacts = new Map<string, ArtifactCall>();
    for (;;) {
      const { done: ended, value } = await reader.read();
      if (value) buffer += value;
      const lines = buffer.split("\n");
      buffer = ended ? "" : lines.pop() ?? "";
      for (const raw of lines) {
        if (!raw.trim()) continue;
        let line: Record<string, unknown>;
        try { line = JSON.parse(raw); } catch { continue; }
        if (line.type === "stream_event") {
          if (!timing.firstWord) {
            timing.firstWord = Date.now();
            /* Where the wait before its first word went, for the logs. */
            console.info(`Kimono AI turn ${turn}: ready ${timing.ensured - timing.start}ms, synced ${timing.synced - timing.ensured}ms, node ${timing.agent - timing.synced}ms, first word ${timing.firstWord - timing.agent}ms (${timing.firstWord - timing.start}ms in all)`);
          }
          drafts!.take(line);
          continue;
        }
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
        if (line.type === "kimono.memory" && !byOwner) continue;
        if (line.type === "kimono.memory") {
          /* Only ever the person's own memories: an id that isn't theirs isn't found. */
          try {
            if (typeof line.forget === "string") {
              const was = profileOf(db(), workspace.owner).memories.find((m) => m.id === line.forget);
              forget(db(), workspace.owner, line.forget);
              if (was) record(workspace.id, turn, { kind: "remembered", text: was.text, how: "forgot" });
            } else if (typeof line.change === "string" && typeof line.text === "string") {
              const changed = changeMemory(db(), workspace.owner, line.change, line.text);
              record(workspace.id, turn, { kind: "remembered", text: changed.text, how: "changed" });
            } else if (typeof line.text === "string") {
              const kept = remember(db(), workspace.owner, line.text, "ai");
              if (kept) record(workspace.id, turn, { kind: "remembered", text: kept.text });
            }
          } catch (error) { console.warn("Kimono AI couldn't keep a memory:", error instanceof Error ? error.message : error); }
          continue;
        }
        if (line.type === "kimono.access" && typeof line.id === "string" && typeof line.space === "string" && typeof line.why === "string" && (line.need === "read" || line.need === "change")) {
          try {
            const asked = await onRequest(db(), config, workspace, turn, { id: line.id, space: line.space, path: typeof line.path === "string" ? line.path : "", need: line.need, why: line.why }, byOwner);
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
        if (line.type === "assistant" && typeof line.uuid === "string") lastMessage = line.uuid;
        const translated = translate(line);
        if (translated.session) setSession(db(), workspace.id, translated.session);
        for (const thought of translated.thinking ?? []) keepThinking(db(), workspace.id, thought);
        for (const call of translated.calls ?? []) {
          keepToolCall(db(), workspace.id, call);
          if (isAskCommand(call.input)) asking.add(call.id);
          else if (call.output !== undefined && asking.delete(call.id)) await takeQuestions(config, workspace, turn, call.output);
          if (isSkillCommand(call.input)) making.add(call.id);
          else if (call.output !== undefined && making.delete(call.id) && byOwner) await takeSkill(config, workspace, turn, user, call.output);
        }
        if (translated.result) result = translated.result;
        if (translated.context) context = translated.context;
        for (const call of translated.artifacts ?? []) pendingArtifacts.set(call.id, call);
        if (translated.sent) await keepSent(config, workspace, turn, translated.sent).catch((error) => console.warn("Kimono AI couldn't keep a file it sent:", error instanceof Error ? error.message : error));
        for (const event of translated.events) {
          /* An app it used that the person never connected ran on Composio's account: a Pro Tool, marked with its bolt. */
          if (event.kind === "tool" && event.app && event.label === "Used" && await ranAsPro(db(), config, workspace.owner, portalOrigin(), event.app).catch(() => false)) event.pro = true;
          record(workspace.id, turn, event);
          /* A long job's card: follow it in the sandbox from now on. */
          if (event.kind === "tool" && event.progress?.label) probe = followProgress(config, workspace, turn, event.id, event.progress.label);
          /* A tool of theirs answered: what it cost counts against the month's Pro Tools allowance at once. */
          if (event.kind === "tool" && event.name.startsWith("mcp__composio__")) composioCalls.add(event.id);
          if (event.kind === "tool-result" && composioCalls.delete(event.id)) guardMediaBudget(db(), config, workspace.owner, portalOrigin());
          /* after each step, see whether it read what was sent meanwhile */
          if (event.kind === "tool-result" && live.steering?.get(workspace.id)?.size) void checkSteered(config, workspace, turn);
          /* A Pro Tool's price: what Composio charged for it, shown beside its bolt. */
          if (event.kind === "tool" && event.pro && event.tools?.length) proCalls.set(event.id, { at: Date.now(), tools: event.tools });
          const pro = event.kind === "tool-result" ? proCalls.get(event.id) : undefined;
          if (pro && event.kind === "tool-result") { proCalls.delete(event.id); priceProCall(config, workspace, turn, event.id, pro); }
          const call = event.kind === "tool-result" ? pendingArtifacts.get(event.id) : undefined;
          if (call && event.kind === "tool-result") {
            pendingArtifacts.delete(event.id);
            if (event.ok) await keepArtifact(config, workspace, turn, call).catch((error) => console.warn("Kimono AI couldn't keep an artifact:", error instanceof Error ? error.message : error));
          }
        }
      }
      if (ended) break;
    }
  } catch (error) {
    if (controller.signal.aborted) done = { cancelled: true };
    else failure = error instanceof CodeProblem ? error.message : "The sandbox stopped answering.";
  } finally {
    drafts?.close();
    live.turns.delete(turn);
    if (probe && live.probes?.get(workspace.id) === probe) await probe.turnEnded().catch(() => {});
    /* Deleted while it worked: nothing left to record to, or to carry on in. */
    if (!db().prepare("SELECT 1 FROM workspaces WHERE id = ?").get(workspace.id)) {
      live.queued?.delete(workspace.id);
      live.carryOn?.delete(workspace.id);
      return;
    }
    const outcome = { ...finish(result, done, failure, context), model };
    /* What it read while it worked is answered already; what it didn't is taken back. */
    await checkSteered(config, workspace, turn).catch(() => {});
    await unsteer(config, workspace).catch(() => {});
    /* Stopped means stopped: what was waiting is dropped, not started as the next turn. */
    if (outcome.cancelled) {
      const dropped = (live.queued?.get(workspace.id) ?? []).flatMap((m) => m.seq === undefined ? [] : [m.seq]);
      live.queued?.delete(workspace.id);
      live.carryOn?.delete(workspace.id);
      if (dropped.length) record(workspace.id, turn, { kind: "dropped", seqs: dropped });
    }
    record(workspace.id, turn, outcome);
    const sessionNow = workspaceFor(db(), workspace.id, workspace.owner).session;
    if (take) noteTake(db(), take.id, take.n, sessionNow, lastMessage);
    /* The first of two takes came off and nothing was sent meanwhile: the turn goes on with the second. */
    if (take?.n === 0) {
      const movedOn = Boolean(live.queued?.get(workspace.id)?.length) || Boolean(db().prepare(`SELECT 1 FROM events WHERE workspace_id = ? AND turn_id = ? AND data LIKE '%"kind":"steered"%' LIMIT 1`).get(workspace.id, turn));
      if (outcome.ok && !outcome.cancelled && lastMessage && !movedOn) {
        noteTurnEnd(db(), turn, sessionNow, lastMessage);
        void nameChat(config, workspace);
        void syncDrive(db(), config, workspace).catch((error) => console.warn("Code couldn't sync to Drive:", error instanceof Error ? error.message : error));
        void run(config, workspace, user, turn, prompt, attachments, effort, choice, undefined, { take: { id: take.id, kind: take.kind, session: take.before?.session ?? null, at: take.before?.at ?? null, told } });
        return;
      }
      dropTakes(db(), take.id);
    }
    /* The second take didn't come off: the first stands alone, and the chat carries on from it. */
    let ended = { session: sessionNow, at: lastMessage };
    if (take?.n === 1 && (!outcome.ok || outcome.cancelled || !lastMessage)) {
      const first = takeOf(db(), take.id);
      if (first?.a.session) { setSession(db(), workspace.id, first.a.session); ended = { session: first.a.session, at: first.a.at }; }
      dropTakes(db(), take.id);
      record(workspace.id, turn, { kind: "take-dropped", id: take.id, n: 1 });
    }
    endTurn(db(), turn, outcome.cancelled ? "cancelled" : outcome.ok ? "done" : "failed");
    noteTurnEnd(db(), turn, ended.session, ended.at);
    /* A chat still on the words it started with gets a name from its first exchange. */
    if (outcome.ok) void nameChat(config, workspace);
    /* What the agent made goes to Drive, and what it changed in the person's own files goes back to them. */
    void syncDrive(db(), config, workspace).catch((error) => console.warn("Code couldn't sync to Drive:", error instanceof Error ? error.message : error));
    const wroteBack = syncOpened(db(), config, workspace).catch((error) => { console.warn("Kimono AI couldn't write back opened files:", error instanceof Error ? error.message : error); return []; });
    /* Anything sent while it worked starts the next turn straight away, after any note it should carry on with. */
    const queued = live.queued?.get(workspace.id) ?? [];
    const carry = live.carryOn?.get(workspace.id);
    live.queued?.delete(workspace.id);
    live.carryOn?.delete(workspace.id);
    /* One side per turn: the owner's messages (and a note to carry on with, which is the owner's) run together,
       and anyone else's wait for a turn of their own, so their words never run with the owner's apps and files. */
    const ownerSent = (m: { user: ApiUser }) => m.user.username.toLowerCase() === workspace.owner;
    const side = carry ? true : queued.length ? ownerSent(queued[0]) : true;
    const split = queued.findIndex((m) => ownerSent(m) !== side);
    const waiting = split < 0 ? queued : queued.slice(0, split);
    if (split >= 0) (live.queued ??= new Map()).set(workspace.id, queued.slice(split));
    if (waiting.length || carry) {
      /* The next turn is taken now, so nothing sent in the meantime starts one of its own and pushes these out;
         it runs once what this one changed is written back. */
      try {
        const by = waiting[0]?.user ?? carry!.user;
        checkShare(config, by);
        const next = startTurn(db(), workspace.id);
        const said = [...(carry?.notes ?? []), ...waiting.map((m) => m.prompt)].filter(Boolean).join("\n\n");
        void wroteBack.then(() => run(config, workspace, by, next, said || "Look at the attached files.", waiting.flatMap((m) => m.attachments), waiting.at(-1)?.effort, waiting.at(-1)?.model))
          .catch((error) => console.warn("Code couldn't run the next turn:", error instanceof Error ? error.message : error));
      } catch (error) { console.warn("Code couldn't start the next turn:", error instanceof Error ? error.message : error); }
    }
  }
}

/* ── the chat's name ── */

const naming = new Set<string>();

async function nameChat(config: CodeConfig, workspace: Workspace) {
  if (naming.has(workspace.id)) return;
  naming.add(workspace.id);
  try {
    if (!awaitsName(db(), workspace.id)) return;
    const events = eventsAfter(db(), workspace.id, 0, 400);
    const first = events.find((e) => e.event.kind === "ask");
    if (!first || first.event.kind !== "ask") return;
    /* Someone renamed it before Kimono could (or before chats were named): theirs stays. */
    const current = workspaceFor(db(), workspace.id, workspace.owner);
    if (current.title !== titleFrom(first.event.text)) { nameWorkspace(db(), workspace.id, null); return; }
    const reply = events.filter((e) => e.turn === first.turn && e.event.kind === "text").map((e) => (e.event as { text: string }).text).join("\n\n");
    const title = await suggestTitle(config, current, first.event.text || first.event.attachments.map((a) => a.name).join(", "), reply);
    if (!title || !nameWorkspace(db(), workspace.id, title)) return;
    const named = workspaceFor(db(), workspace.id, workspace.owner);
    await retitle(db(), named).catch((error) => console.warn("Kimono AI couldn't rename a chat's folder:", error instanceof Error ? error.message : error));
    broadcast(workspace.id, null, { kind: "renamed", title });
  } catch (error) {
    console.warn("Kimono AI couldn't name a chat:", error instanceof Error ? error.message : error);
  } finally {
    naming.delete(workspace.id);
  }
}

/* ── questions it puts to the person (lib/code/questions.ts) ── */

/** What kimono-ask wrote, put up for the person; a question that can't be read is dropped, so the chat never hangs on it. */
async function takeQuestions(config: CodeConfig, workspace: Workspace, turn: string, output: string) {
  const id = askedId(output);
  if (!id) return;
  try {
    const path = `${questionsDir}/${id}.json`;
    const response = await sandbox.file(config, workspace, path);
    const questions = response.ok ? questionsOf(await response.text()) : undefined;
    if (questions) record(workspace.id, turn, { kind: "question", id, questions });
    await sandbox.removeFile(config, workspace, path).catch(() => {});
  } catch (error) { console.warn("Kimono AI couldn't take its questions:", error instanceof Error ? error.message : error); }
}

/** What kimono-skill wrote, saved as the owner's skill: the chat says so, or why it couldn't be. */
async function takeSkill(config: CodeConfig, workspace: Workspace, turn: string, user: ApiUser, output: string) {
  const id = madeSkillId(output);
  if (!id) return;
  try {
    const path = `${madeSkillsDir}/${id}.json`;
    const response = await sandbox.file(config, workspace, path);
    if (!response.ok) return;
    const made = saveMadeSkill(db(), { username: workspace.owner, admin: user.role === "owner" || user.role === "admin", author: user.name || user.username }, await response.text());
    record(workspace.id, turn, { kind: "skill-made", ...made });
    await sandbox.removeFile(config, workspace, path).catch(() => {});
  } catch (error) { console.warn("Kimono AI couldn't save a skill:", error instanceof Error ? error.message : error); }
}

/** A turn's events, in order. */
const eventsOfTurn = (workspaceId: string, turn: string) => eventsAfter(db(), workspaceId, 0, 100_000).filter((e) => e.turn === turn);

/** What each of a pair's takes made: its artifacts, and its model and time from its Done. */
function takesOf(events: StoredEvent[], id: string) {
  const takes: [{ artifacts: string[]; model?: string; durationMs?: number }, { artifacts: string[]; model?: string; durationMs?: number }] = [{ artifacts: [] }, { artifacts: [] }];
  let n: 0 | 1 | null = null;
  for (const { event } of events) {
    if (event.kind === "take") n = event.id === id ? event.n : null;
    else if (n === null) continue;
    else if (event.kind === "artifact" && event.action !== "shown") takes[n].artifacts.push(event.name);
    else if (event.kind === "done") { takes[n].model = event.model; takes[n].durationMs = event.durationMs; n = null; }
  }
  return takes;
}

/** The person keeps one of two takes (takes.ts): the chat carries on from it, and it answers them that way from now on. */
export function keepOneTake(workspace: Workspace, user: ApiUser, id: string, n: unknown) {
  const latest = db().prepare("SELECT id, state FROM turns WHERE workspace_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1").get(workspace.id) as { id: string; state: string } | undefined;
  const kept = keepTake(db(), { id, workspace: workspace.id, username: user.username, n, latestTurn: latest?.id ?? null, running: latest?.state === "running" });
  /* The bank keeps both takes' artifacts and which was kept, nothing anyone said and no name (feedback.ts keepPick). */
  try { keepPick(db(), workspace.id, { kind: kept.kind, kept: kept.n, takes: takesOf(eventsOfTurn(workspace.id, latest!.id), id) }); }
  catch (error) { console.warn("Kimono AI couldn't keep a pick for feedback:", error instanceof Error ? error.message : error); }
  const event = record(workspace.id, latest!.id, { kind: "take-kept", id, n: kept.n });
  record(workspace.id, latest!.id, { kind: "remembered", text: kept.remembered });
  return event;
}

/** The person answers its questions (or skips them): the answers go to it as their message. */
export function answerQuestions(config: CodeConfig, workspace: Workspace, user: ApiUser, id: string, body: { answers?: unknown; skip?: unknown }) {
  const events = eventsAfter(db(), workspace.id, 0, 100_000);
  const asked = events.findLast((e) => e.event.kind === "question" && e.event.id === id)?.event as Extract<CodeEvent, { kind: "question" }> | undefined;
  if (!asked) throw new CodeProblem("Those questions aren't here.", 404);
  if (events.some((e) => e.event.kind === "question-answer" && e.event.id === id)) throw new CodeProblem("They were answered already.", 409);
  if (body.skip === true) return record(workspace.id, runningTurn(db(), workspace.id), { kind: "question-answer", id, skipped: true });
  const answers = answersOf(asked.questions, body.answers);
  if (!answers) throw new CodeProblem("Answer each question with its options or your own words.");
  const recorded = record(workspace.id, runningTurn(db(), workspace.id), { kind: "question-answer", id, answers });
  ask(config, workspace, user, answerText(asked.questions, answers), []);
  return recorded;
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
/* The sandbox takes plain names only (letters, digits, space and `._()-`, 128 at most): accents fall off, anything else
   (a screenshot's narrow space, quotes, emoji) turns into a dash, and the end is kept so the extension survives. */
const sandboxName = (name: string) =>
  safeName(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 ._()-]+/g, "-")
    .replace(/\.{2,}/g, ".").replace(/-{2,}/g, "-").slice(-120).replace(/^-*(?=\.|$)/, "file").replace(/^-+/, "");

export async function attach(config: CodeConfig, workspace: Workspace, user: ApiUser, name: string, type: string, body: Uint8Array): Promise<Attachment> {
  await ensure(config, workspace, who(user));
  return keepAttachment(config, workspace, name, type, body);
}

/** Several files for one message: the sandbox is woken once, and a few go in at a time. */
export async function attachAll(config: CodeConfig, workspace: Workspace, user: ApiUser, files: { name: string; type: string; bytes: Uint8Array }[]): Promise<Attachment[]> {
  if (!files.length) return [];
  await ensure(config, workspace, who(user));
  return bounded(files, 4, (file) => keepAttachment(config, workspace, file.name, file.type, file.bytes));
}

async function keepAttachment(config: CodeConfig, workspace: Workspace, name: string, type: string, body: Uint8Array): Promise<Attachment> {
  const stored = `${newId(3)}-${sandboxName(name)}`;
  const { path } = await sandbox.attach(config, workspace, stored, body);
  await mkdir(attachmentDir(workspace.id), { recursive: true, mode: 0o700 });
  await writeFile(join(attachmentDir(workspace.id), stored), body, { mode: 0o600 });
  return { name: safeName(name), path, size: body.byteLength, type: type || "application/octet-stream" };
}

/** Where an attachment is kept, for sending it with ranges (a video seeks; iOS plays nothing without them). */
export function attachmentPath(workspace: Workspace, stored: string) {
  if (stored !== safeName(stored) || stored.includes("/")) throw new CodeProblem("That file isn't here.", 404);
  return join(attachmentDir(workspace.id), stored);
}

export async function attachmentBytes(workspace: Workspace, stored: string) {
  if (stored !== safeName(stored) || stored.includes("/")) throw new CodeProblem("That file isn't here.", 404);
  try { return await readFile(join(attachmentDir(workspace.id), stored)); } catch { throw new CodeProblem("That file isn't here.", 404); }
}

export async function forgetAttachments(workspaceId: string) {
  await rm(attachmentDir(workspaceId), { recursive: true, force: true });
  await rm(shotDir(workspaceId), { recursive: true, force: true });
  await rm(mediaDir(workspaceId), { recursive: true, force: true });
}

export { who };
export { driveAttachment, fromDrive, syncDrive, taskFolder, uploadFolder } from "./drive";

/**
 * A file the agent linked for a tool with kimono-link, for whoever has the link: the
 * tools fetching it are outside Kimono. The link's own unguessable token is what opens it.
 */
export async function tempLink(request: Request, id: string, token: string, name: string): Promise<Response> {
  try {
    const config = codeConfig(await getPlatformSettings());
    if (!config.enabled) return new Response("Not found", { status: 404 });
    const row = db().prepare("SELECT owner FROM workspaces WHERE id = ?").get(id) as { owner: string } | undefined;
    if (!row) return new Response("Not found", { status: 404 });
    return await serveTempLink(request, config, workspaceFor(db(), id, row.owner), token, name);
  } catch (error) {
    if (!(error instanceof CodeProblem)) console.warn("Kimono AI couldn't serve a file link:", error instanceof Error ? error.message : error);
    return new Response("Not found", { status: 404 });
  }
}

/** How to use Kimono Notes, for the system prompt; nothing when Notes is off. */
async function notesFor(owner: string): Promise<string> {
  try {
    if (!notesConfig(await getPlatformSettings()).enabled) return "";
    /* Ones shared with them from spaces they aren't in can't be opened in a chat yet. */
    return notesGuide(ensureNotebook(driveDb(), owner).filter((n) => !n.sharedWithYou));
  } catch (error) {
    console.warn("Kimono AI couldn't read the notebooks:", error instanceof Error ? error.message : error);
    return "";
  }
}

/** Which Kimono and sandbox a thumb or report is given on: the Portal's release, and the node's version with the image it runs ("v0.15.6 · kimono-sandbox:0.9.0"). */
export async function feedbackVersions(config: CodeConfig): Promise<Versions> {
  const health = await sandbox.health(config).catch(() => null);
  const image = health?.image?.split("/").at(-1);
  return { kimono: kimonoVersion(), sandbox: health ? [health.version, image].filter(Boolean).join(" · ") : null };
}
