/*
 * Kimono Code's own records: workspaces, the turns run in them, and every event
 * those turns produced, in order. Plain functions over a SQLite handle so the
 * tests can run them against an in-memory database.
 *
 * A workspace is one repository, one branch and one sandbox. Events are written
 * here before anyone sees them, so a page that reconnects replays exactly what
 * happened from the sequence number it last saw.
 */
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CodeEvent } from "./events";

export class CodeProblem extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export type TurnState = "running" | "done" | "failed" | "cancelled";

export type Workspace = {
  id: string; owner: string; title: string;
  repo: { owner: string; name: string }; base: string; branch: string;
  session: string | null;
  pullRequest: { url: string; number: number } | null;
  /** The app the agent is running, open to anyone with the link while it's up. */
  preview: { url: string; port: number } | null;
  /** The name its owner chose for the app's link, if they chose one. */
  previewName: string | null;
  /** Where the task's files are in Drive: the Code space, and the task's own folder there. */
  drive: { spaceId: string; folderId: string } | null;
  createdAt: number; updatedAt: number;
  /* the last turn, which is what the list shows */
  turn: { id: string; state: TurnState; startedAt: number; endedAt: number | null } | null;
  lastSeq: number;
};

export type StoredEvent = { seq: number; turn: string | null; at: number; event: CodeEvent };

export const newId = (bytes = 8) => randomBytes(bytes).toString("hex");

export function migrate(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const version = Number((db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value?: string } | undefined)?.value ?? 0);
  if (version < 1) {
    db.exec(`
      BEGIN;
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL,
        repo_owner TEXT NOT NULL, repo_name TEXT NOT NULL, base TEXT NOT NULL, branch TEXT NOT NULL,
        session TEXT, pr_url TEXT, pr_number INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX workspaces_by_owner ON workspaces (owner, updated_at DESC);
      CREATE TABLE turns (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK (state IN ('running', 'done', 'failed', 'cancelled')),
        started_at INTEGER NOT NULL, ended_at INTEGER
      );
      CREATE INDEX turns_by_workspace ON turns (workspace_id, started_at DESC);
      CREATE TABLE events (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL, turn_id TEXT, at INTEGER NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (workspace_id, seq)
      );
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '1');
      COMMIT;
    `);
  }
  if (version < 2) {
    db.exec(`
      BEGIN;
      ALTER TABLE workspaces ADD COLUMN preview_url TEXT;
      ALTER TABLE workspaces ADD COLUMN preview_port INTEGER;
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '2');
      COMMIT;
    `);
  }
  if (version < 3) {
    /* Each person's Code space in Drive, each task's folder in it, and what both sides held when they last agreed. */
    db.exec(`
      BEGIN;
      CREATE TABLE drive_spaces (owner TEXT PRIMARY KEY, space_id TEXT NOT NULL);
      ALTER TABLE workspaces ADD COLUMN drive_folder TEXT;
      CREATE TABLE synced (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        path TEXT NOT NULL, node_id TEXT NOT NULL, sha1 TEXT NOT NULL, content_version INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, path)
      );
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '3');
      COMMIT;
    `);
  }
  if (version < 4) {
    /* What a person changed in Drive, held until the agent's next turn is told. */
    db.exec(`
      BEGIN;
      ALTER TABLE workspaces ADD COLUMN drive_news TEXT;
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '4');
      COMMIT;
    `);
  }
  if (version < 5) {
    /* What each turn used of the Claude plan's 5-hour and weekly windows, and the windows as last seen. */
    db.exec(`
      BEGIN;
      CREATE TABLE usage (
        username TEXT NOT NULL, at INTEGER NOT NULL,
        five_hour REAL NOT NULL, five_hour_reset INTEGER, week REAL NOT NULL, week_reset INTEGER
      );
      CREATE INDEX usage_by_person ON usage (username, at);
      CREATE TABLE plan_windows (id INTEGER PRIMARY KEY CHECK (id = 1), five_hour REAL, five_hour_reset INTEGER, week REAL, week_reset INTEGER, at INTEGER NOT NULL);
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '5');
      COMMIT;
    `);
  }
  if (version < 6) {
    /* The name its owner chose for a task's app link, given back whenever the app is started again. */
    db.exec(`
      BEGIN;
      ALTER TABLE workspaces ADD COLUMN preview_name TEXT;
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '6');
      COMMIT;
    `);
  }
}

/* ── usage: each person's share of the Claude plan behind Kimono Code ── */

export type UsageReport = { five_hour?: number; week?: number; five_hour_now?: number; five_hour_reset?: number; week_now?: number; week_reset?: number };
export type PlanWindow = { used: number; resetsAt: number | null };
export type PersonUsage = {
  fiveHour: PlanWindow; week: PlanWindow; reported: boolean;
  /** The whole plan's use of each window, as last seen. */
  plan: { fiveHour: number | null; week: number | null };
  /** Some plans have no 5-hour window: usage is reported, but never a 5-hour figure. */
  fiveHourLimited: boolean;
};

const fraction = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10 ? value : 0;
const seconds = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

/** Records what a turn used, as the node reported it, and the plan's windows as it last saw them. */
export function recordUsage(db: DatabaseSync, username: string, report: UsageReport, now = Date.now()) {
  const fiveReset = seconds(report.five_hour_reset), weekReset = seconds(report.week_reset);
  db.prepare("INSERT INTO usage (username, at, five_hour, five_hour_reset, week, week_reset) VALUES (?, ?, ?, ?, ?, ?)")
    .run(username, now, fraction(report.five_hour), fiveReset, fraction(report.week), weekReset);
  if (fiveReset || weekReset) {
    db.prepare(`INSERT INTO plan_windows (id, five_hour, five_hour_reset, week, week_reset, at) VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        five_hour = COALESCE(excluded.five_hour, five_hour), five_hour_reset = COALESCE(excluded.five_hour_reset, five_hour_reset),
        week = COALESCE(excluded.week, week), week_reset = COALESCE(excluded.week_reset, week_reset), at = excluded.at`)
      .run(fiveReset ? fraction(report.five_hour_now) : null, fiveReset, weekReset ? fraction(report.week_now) : null, weekReset, now);
  }
}

/** How much of the current 5-hour and weekly windows a person has used, as fractions of the whole plan. */
export function usageOf(db: DatabaseSync, username: string, now = Date.now()): PersonUsage {
  const plan = db.prepare("SELECT five_hour, five_hour_reset, week, week_reset FROM plan_windows WHERE id = 1").get() as { five_hour: number | null; five_hour_reset: number | null; week: number | null; week_reset: number | null } | undefined;
  const current = (value: number | null | undefined, reset: number | null | undefined) => value != null && reset && reset * 1000 > now ? value : reset ? 0 : null;
  const window = (column: "five_hour" | "week", reset: number | null | undefined): PlanWindow => {
    /* A window whose reset has passed is a fresh one: nobody has used any of it yet. */
    if (!reset || reset * 1000 <= now) return { used: 0, resetsAt: null };
    const row = db.prepare(`SELECT COALESCE(SUM(${column}), 0) AS used FROM usage WHERE username = ? AND ${column}_reset = ?`).get(username, reset) as { used: number };
    return { used: row.used, resetsAt: reset * 1000 };
  };
  return {
    fiveHour: window("five_hour", plan?.five_hour_reset), week: window("week", plan?.week_reset), reported: Boolean(plan),
    plan: { fiveHour: current(plan?.five_hour, plan?.five_hour_reset), week: current(plan?.week, plan?.week_reset) },
    fiveHourLimited: Boolean(plan?.five_hour_reset),
  };
}

type WorkspaceRow = {
  id: string; owner: string; title: string; repo_owner: string; repo_name: string; base: string; branch: string;
  session: string | null; pr_url: string | null; pr_number: number | null; preview_url: string | null; preview_port: number | null; preview_name: string | null; drive_folder: string | null; drive_space: string | null; created_at: number; updated_at: number; last_seq: number;
  turn_id: string | null; turn_state: TurnState | null; turn_started: number | null; turn_ended: number | null;
};

const selectWorkspace = `
  SELECT w.*, (SELECT space_id FROM drive_spaces d WHERE d.owner = w.owner) AS drive_space, t.id AS turn_id, t.state AS turn_state, t.started_at AS turn_started, t.ended_at AS turn_ended
  FROM workspaces w
  LEFT JOIN turns t ON t.id = (SELECT id FROM turns WHERE workspace_id = w.id ORDER BY started_at DESC LIMIT 1)`;

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id, owner: row.owner, title: row.title,
    repo: { owner: row.repo_owner, name: row.repo_name }, base: row.base, branch: row.branch,
    session: row.session,
    pullRequest: row.pr_url && row.pr_number ? { url: row.pr_url, number: row.pr_number } : null,
    preview: row.preview_url && row.preview_port ? { url: row.preview_url, port: row.preview_port } : null,
    previewName: row.preview_name ?? null,
    drive: row.drive_space && row.drive_folder ? { spaceId: row.drive_space, folderId: row.drive_folder } : null,
    createdAt: row.created_at, updatedAt: row.updated_at, lastSeq: row.last_seq,
    turn: row.turn_id ? { id: row.turn_id, state: row.turn_state!, startedAt: row.turn_started!, endedAt: row.turn_ended } : null,
  };
}

const namePattern = /^[A-Za-z0-9._-]{1,100}$/;
const branchPattern = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]{1,200}$/;

/** A title from what was asked: its first line, at most 72 characters. */
export function titleFrom(prompt: string) {
  const line = prompt.trim().split("\n")[0].trim().replace(/\s+/g, " ");
  return line.length > 72 ? `${line.slice(0, 71).trimEnd()}…` : line || "Untitled";
}

/** `code/<a few words>-<4 hex>`: readable in Kimono Git, never colliding. */
export function branchFor(title: string, suffix = newId(2)) {
  const words = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, "").trim().split(/[\s-]+/).filter(Boolean).slice(0, 5).join("-");
  return `code/${(words || "task").slice(0, 40).replace(/-+$/, "")}-${suffix}`;
}

export function createWorkspace(db: DatabaseSync, owner: string, input: { repoOwner: unknown; repoName: unknown; base: unknown; prompt: unknown }, now = Date.now()): Workspace {
  const repoOwner = String(input.repoOwner ?? "");
  const repoName = String(input.repoName ?? "");
  const base = String(input.base ?? "");
  const prompt = String(input.prompt ?? "").trim();
  if (!namePattern.test(repoOwner) || !namePattern.test(repoName)) throw new CodeProblem("Choose a repository.");
  if (!branchPattern.test(base)) throw new CodeProblem("Choose a branch.");
  if (!prompt) throw new CodeProblem("Say what to do.");
  const id = newId();
  const title = titleFrom(prompt);
  db.prepare(`INSERT INTO workspaces (id, owner, title, repo_owner, repo_name, base, branch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, owner.toLowerCase(), title, repoOwner, repoName, base, branchFor(title), now, now);
  return workspaceFor(db, id, owner);
}

/** One workspace, if it is yours. */
export function workspaceFor(db: DatabaseSync, id: string, owner: string): Workspace {
  const row = db.prepare(`${selectWorkspace} WHERE w.id = ? AND w.owner = ?`).get(id, owner.toLowerCase()) as WorkspaceRow | undefined;
  if (!row) throw new CodeProblem("That workspace isn't here.", 404);
  return toWorkspace(row);
}

export function workspacesOf(db: DatabaseSync, owner: string): Workspace[] {
  return (db.prepare(`${selectWorkspace} WHERE w.owner = ? ORDER BY w.updated_at DESC LIMIT 200`).all(owner.toLowerCase()) as WorkspaceRow[]).map(toWorkspace);
}

export function renameWorkspace(db: DatabaseSync, id: string, owner: string, title: unknown) {
  const value = String(title ?? "").trim().replace(/\s+/g, " ");
  if (!value || value.length > 120) throw new CodeProblem("Give it a name of up to 120 characters.");
  workspaceFor(db, id, owner);
  db.prepare("UPDATE workspaces SET title = ?, updated_at = ? WHERE id = ?").run(value, Date.now(), id);
  return workspaceFor(db, id, owner);
}

export function removeWorkspace(db: DatabaseSync, id: string, owner: string) {
  workspaceFor(db, id, owner);
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
}

export function setSession(db: DatabaseSync, id: string, session: string) {
  db.prepare("UPDATE workspaces SET session = ? WHERE id = ?").run(session, id);
}

export function setPullRequest(db: DatabaseSync, id: string, pr: { url: string; number: number }) {
  db.prepare("UPDATE workspaces SET pr_url = ?, pr_number = ?, updated_at = ? WHERE id = ?").run(pr.url, pr.number, Date.now(), id);
}

/** Records the app's link, or forgets it with null. Only http(s) links are kept. */
export function setPreview(db: DatabaseSync, id: string, preview: { url: string; port: number } | null) {
  const ok = preview && /^https?:\/\//.test(preview.url) && Number.isInteger(preview.port) && preview.port > 0 && preview.port < 65536;
  db.prepare("UPDATE workspaces SET preview_url = ?, preview_port = ?, updated_at = ? WHERE id = ?").run(ok ? preview.url : null, ok ? preview.port : null, Date.now(), id);
}

/** The turn running in a workspace now, if any. */
export function runningTurn(db: DatabaseSync, workspaceId: string): string | null {
  const row = db.prepare("SELECT id FROM turns WHERE workspace_id = ? AND state = 'running'").get(workspaceId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function setPreviewName(db: DatabaseSync, id: string, name: string | null) {
  db.prepare("UPDATE workspaces SET preview_name = ? WHERE id = ?").run(name, id);
}

/** Starts a turn, refusing while another is running in the same workspace. */
export function startTurn(db: DatabaseSync, workspaceId: string, now = Date.now()): string {
  const running = db.prepare("SELECT id FROM turns WHERE workspace_id = ? AND state = 'running'").get(workspaceId);
  if (running) throw new CodeProblem("The agent is still working on the last message.", 409);
  const id = newId();
  db.prepare("INSERT INTO turns (id, workspace_id, state, started_at) VALUES (?, ?, 'running', ?)").run(id, workspaceId, now);
  db.prepare("UPDATE workspaces SET updated_at = ? WHERE id = ?").run(now, workspaceId);
  return id;
}

export function endTurn(db: DatabaseSync, turnId: string, state: Exclude<TurnState, "running">, now = Date.now()) {
  db.prepare("UPDATE turns SET state = ?, ended_at = ? WHERE id = ? AND state = 'running'").run(state, now, turnId);
}

/** Turns left running by a Portal that stopped mid-turn: nothing is driving them any more. */
export function abandonRunningTurns(db: DatabaseSync, now = Date.now()): { workspace: string; turn: string }[] {
  const rows = db.prepare("SELECT id, workspace_id FROM turns WHERE state = 'running'").all() as { id: string; workspace_id: string }[];
  for (const row of rows) endTurn(db, row.id, "failed", now);
  return rows.map((row) => ({ workspace: row.workspace_id, turn: row.id }));
}

/** Appends an event and returns it with its sequence number. */
export function appendEvent(db: DatabaseSync, workspaceId: string, turnId: string | null, event: CodeEvent, now = Date.now()): StoredEvent {
  const { last_seq } = db.prepare("UPDATE workspaces SET last_seq = last_seq + 1 WHERE id = ? RETURNING last_seq").get(workspaceId) as { last_seq: number };
  db.prepare("INSERT INTO events (workspace_id, seq, turn_id, at, data) VALUES (?, ?, ?, ?, ?)").run(workspaceId, last_seq, turnId, now, JSON.stringify(event));
  return { seq: last_seq, turn: turnId, at: now, event };
}

export function eventsAfter(db: DatabaseSync, workspaceId: string, after: number, limit = 2000): StoredEvent[] {
  const rows = db.prepare("SELECT seq, turn_id, at, data FROM events WHERE workspace_id = ? AND seq > ? ORDER BY seq LIMIT ?").all(workspaceId, after, limit) as { seq: number; turn_id: string | null; at: number; data: string }[];
  return rows.map((row) => ({ seq: row.seq, turn: row.turn_id, at: row.at, event: JSON.parse(row.data) as CodeEvent }));
}

/* ── Drive ── */

export function driveSpaceOf(db: DatabaseSync, owner: string): string | null {
  return (db.prepare("SELECT space_id FROM drive_spaces WHERE owner = ?").get(owner.toLowerCase()) as { space_id?: string } | undefined)?.space_id ?? null;
}

export function setDriveSpace(db: DatabaseSync, owner: string, spaceId: string) {
  db.prepare("INSERT INTO drive_spaces (owner, space_id) VALUES (?, ?) ON CONFLICT (owner) DO UPDATE SET space_id = excluded.space_id").run(owner.toLowerCase(), spaceId);
}

/** The task's folder changed (it was made, or made again): what was synced before no longer describes it. */
export function setDriveFolder(db: DatabaseSync, workspaceId: string, folderId: string) {
  db.prepare("UPDATE workspaces SET drive_folder = ? WHERE id = ?").run(folderId, workspaceId);
  db.prepare("DELETE FROM synced WHERE workspace_id = ?").run(workspaceId);
}

export function syncedRows(db: DatabaseSync, workspaceId: string): { path: string; nodeId: string; sha1: string; contentVersion: number }[] {
  return (db.prepare("SELECT path, node_id, sha1, content_version FROM synced WHERE workspace_id = ?").all(workspaceId) as { path: string; node_id: string; sha1: string; content_version: number }[])
    .map((r) => ({ path: r.path, nodeId: r.node_id, sha1: r.sha1, contentVersion: r.content_version }));
}

export function recordSynced(db: DatabaseSync, workspaceId: string, path: string, row: { nodeId: string; sha1: string; contentVersion: number } | null) {
  if (!row) db.prepare("DELETE FROM synced WHERE workspace_id = ? AND path = ?").run(workspaceId, path);
  else db.prepare("INSERT INTO synced (workspace_id, path, node_id, sha1, content_version) VALUES (?, ?, ?, ?, ?) ON CONFLICT (workspace_id, path) DO UPDATE SET node_id = excluded.node_id, sha1 = excluded.sha1, content_version = excluded.content_version")
    .run(workspaceId, path, row.nodeId, row.sha1, row.contentVersion);
}

/** Paths a person changed in Drive that the agent hasn't been told about yet; whoever takes them, takes them once. */
export function noteDriveNews(db: DatabaseSync, workspaceId: string, paths: string[]) {
  if (!paths.length) return;
  const row = db.prepare("SELECT drive_news FROM workspaces WHERE id = ?").get(workspaceId) as { drive_news: string | null } | undefined;
  const news = new Set<string>(row?.drive_news ? JSON.parse(row.drive_news) as string[] : []);
  for (const path of paths) news.add(path);
  db.prepare("UPDATE workspaces SET drive_news = ? WHERE id = ?").run(JSON.stringify([...news].slice(-500)), workspaceId);
}

export function takeDriveNews(db: DatabaseSync, workspaceId: string): string[] {
  const row = db.prepare("SELECT drive_news FROM workspaces WHERE id = ?").get(workspaceId) as { drive_news: string | null } | undefined;
  db.prepare("UPDATE workspaces SET drive_news = NULL WHERE id = ?").run(workspaceId);
  return row?.drive_news ? JSON.parse(row.drive_news) as string[] : [];
}
