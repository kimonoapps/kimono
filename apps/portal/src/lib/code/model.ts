/*
 * Kimono Code's own records: workspaces, the turns run in them, and every event
 * those turns produced, in order. Plain functions over a SQLite handle so the
 * tests can run them against an in-memory database.
 *
 * A workspace is one repository, one branch and one sandbox. Events are written
 * here before anyone sees them, so a page that reconnects replays exactly what
 * happened from the sequence number it last saw.
 */
import { migrateSkills } from "./skills";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CodeEvent } from "./events";

export class CodeProblem extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export type TurnState = "running" | "done" | "failed" | "cancelled";

export type Preview = { url: string; port: number; kind: string | null; stopped: boolean };

export type Workspace = {
  id: string; owner: string; title: string;
  /** A chat has no project: its repo, base and branch are empty, and it never touches Kimono Git. */
  kind: "chat" | "project";
  /** The project (a folder of chats) it's in, if any. */
  folder: { id: string; name: string } | null;
  repo: { owner: string; name: string }; base: string; branch: string;
  session: string | null;
  pullRequest: { url: string; number: number } | null;
  /** The app the agent published, open to anyone with the link while it's up: what kind it is, and whether its owner stopped it. */
  preview: Preview | null;
  /** The name its owner chose for the app's link, if they chose one. */
  previewName: string | null;
  /** Where the task's files are in Drive: the Code space, and the task's own folder there. */
  drive: { spaceId: string; folderId: string } | null;
  createdAt: number; updatedAt: number;
  /** When its owner archived it: it shows under Archived, not in the list. */
  archivedAt: number | null;
  /** The model that answered its last message, so Auto stays on it and switching can be warned about. */
  lastModel: "fable" | "opus" | "sonnet" | "haiku" | null;
  /* the last turn, which is what the list shows */
  turn: { id: string; state: TurnState; startedAt: number; endedAt: number | null } | null;
  lastSeq: number;
};

export type StoredEvent = { seq: number; turn: string | null; at: number; event: CodeEvent };

export const newId = (bytes = 8) => randomBytes(bytes).toString("hex");

/**
 * A chat's sandbox was made again from nothing (its files were forgotten after
 * long disuse, or lost): forget what Kimono had copied into it, so the next sync
 * puts the chat's Drive files and the person's opened files back in rather than
 * taking their absence for deletions, and earlier chats are given again.
 */
export function sandboxStartedOver(db: DatabaseSync, workspaceId: string) {
  db.prepare("DELETE FROM synced WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM opened_files WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM history_synced WHERE workspace_id = ?").run(workspaceId);
}

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
  if (version < 7) {
    /* What kind of app a task published (a Node API, a static site…), and whether its owner stopped it but kept the link. */
    db.exec(`
      BEGIN;
      ALTER TABLE workspaces ADD COLUMN preview_kind TEXT;
      ALTER TABLE workspaces ADD COLUMN preview_stopped INTEGER NOT NULL DEFAULT 0;
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '7');
      COMMIT;
    `);
  }
  if (version < 8) {
    /* Each person's Composio session, kept and reused; key_hash says which API key made it. */
    db.exec(`
      BEGIN;
      CREATE TABLE tool_sessions (
        username TEXT PRIMARY KEY, key_hash TEXT NOT NULL, session_id TEXT NOT NULL, mcp_url TEXT NOT NULL, checked_at INTEGER NOT NULL
      );
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '8');
      COMMIT;
    `);
  }
  if (version < 9) {
    /*
     * Asking for a person's Drive (docs/kimono-ai.md, "Your files, and asking"):
     * what the agent asked for, what the person allowed (for a chat, or always),
     * what each chat has open and where, and each open file's last agreed state.
     */
    db.exec(`
      BEGIN;
      CREATE TABLE access_requests (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, turn_id TEXT,
        space_name TEXT NOT NULL, path TEXT NOT NULL, need TEXT NOT NULL, why TEXT NOT NULL,
        space_id TEXT, node_id TEXT,
        state TEXT NOT NULL CHECK (state IN ('pending', 'allowed', 'denied', 'missing', 'auto')),
        created_at INTEGER NOT NULL, answered_at INTEGER
      );
      CREATE TABLE grants (
        id TEXT PRIMARY KEY, username TEXT NOT NULL, workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
        space_id TEXT NOT NULL, node_id TEXT NOT NULL, need TEXT NOT NULL CHECK (need IN ('read', 'change')), created_at INTEGER NOT NULL
      );
      CREATE INDEX grants_by_person ON grants (username);
      CREATE TABLE opened (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, node_id TEXT NOT NULL,
        space_id TEXT NOT NULL, dir TEXT NOT NULL, PRIMARY KEY (workspace_id, node_id)
      );
      CREATE TABLE opened_files (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        path TEXT NOT NULL, node_id TEXT NOT NULL, sha1 TEXT NOT NULL, content_version INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, path)
      );
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '9');
      COMMIT;
    `);
  }
  if (version < 10) {
    /* Each person's own instructions, and what Kimono AI remembers about them (memory.ts). */
    db.exec(`
      BEGIN;
      CREATE TABLE profiles (username TEXT PRIMARY KEY, instructions TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
      CREATE TABLE memories (
        id TEXT PRIMARY KEY, username TEXT NOT NULL, text TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('person', 'ai')), created_at INTEGER NOT NULL
      );
      CREATE INDEX memories_by_person ON memories (username, created_at);
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '10');
      COMMIT;
    `);
  }
  if (version < 11) {
    /* Projects: folders a person keeps chats in. A chat is in one, or none. */
    db.exec(`
      BEGIN;
      CREATE TABLE projects (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX projects_by_owner ON projects (owner);
      ALTER TABLE workspaces ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '11');
      COMMIT;
    `);
  }
  if (version < 12) {
    /* Artifacts: the latest of each page a chat made (lib/code/artifacts.ts). */
    db.exec(`
      BEGIN;
      CREATE TABLE artifacts (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, name));
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '12');
      COMMIT;
    `);
  }
  if (version < 13) {
    /* Whether a chat has its name: one it was given after a reply, or one its owner chose. */
    db.exec(`
      BEGIN;
      ALTER TABLE workspaces ADD COLUMN named INTEGER NOT NULL DEFAULT 0;
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '13');
      COMMIT;
    `);
  }
  if (version < 14) {
    /*
     * Sharing (lib/code/sharing.ts): a chat shared with people, who may read it or write in it;
     * a chat's link, which anyone may read and signed-in people may join; an artifact's link,
     * open to the people it was shared with or to anyone.
     */
    db.exec(`
      BEGIN;
      CREATE TABLE chat_shares (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, username TEXT NOT NULL, access TEXT NOT NULL CHECK (access IN ('read', 'edit')), created_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, username));
      CREATE INDEX chat_shares_by_user ON chat_shares (username);
      CREATE TABLE chat_links (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, access TEXT NOT NULL CHECK (access IN ('read', 'edit')));
      CREATE TABLE artifact_links (workspace_id TEXT NOT NULL, name TEXT NOT NULL, token TEXT NOT NULL UNIQUE, public INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id, name), FOREIGN KEY (workspace_id, name) REFERENCES artifacts (workspace_id, name) ON DELETE CASCADE);
      CREATE TABLE artifact_people (workspace_id TEXT NOT NULL, name TEXT NOT NULL, username TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, name, username), FOREIGN KEY (workspace_id, name) REFERENCES artifacts (workspace_id, name) ON DELETE CASCADE);
      CREATE INDEX artifact_people_by_user ON artifact_people (username);
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '14');
      COMMIT;
    `);
  }
  if (version < 15) {
    /* Earlier chats as each chat's sandbox holds them (lib/code/history.ts): which version of each it was given. */
    db.exec(`
      BEGIN;
      CREATE TABLE history_synced (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, chat_id TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (workspace_id, chat_id));
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '15');
      COMMIT;
    `);
  }
  /* A memory written as a page has a title of its own (lib/code/memory.ts). */
  if (!(db.prepare("PRAGMA table_info(memories)").all() as { name: string }[]).some((c) => c.name === "title")) {
    db.exec("ALTER TABLE memories ADD COLUMN title TEXT");
  }
  /* When its owner archived a chat: out of the list, in Archived. Added by its column, not a version, so it sits beside any. */
  if (!(db.prepare("PRAGMA table_info(workspaces)").all() as { name: string }[]).some((c) => c.name === "archived_at")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN archived_at INTEGER");
  }
  /* Where an artifact's media is served: a key of its own (lib/code/artifacts.ts). */
  if (!(db.prepare("PRAGMA table_info(artifacts)").all() as { name: string }[]).some((c) => c.name === "media_key")) {
    db.exec("ALTER TABLE artifacts ADD COLUMN media_key TEXT; CREATE UNIQUE INDEX artifacts_by_media_key ON artifacts (media_key)");
  }
  /* Whether a person's tool session may use Composio's Instant tools: off once their month's media allowance is spent (lib/code/media.ts). */
  if (!(db.prepare("PRAGMA table_info(tool_sessions)").all() as { name: string }[]).some((c) => c.name === "instant")) {
    db.exec("ALTER TABLE tool_sessions ADD COLUMN instant INTEGER NOT NULL DEFAULT 1");
  }
  /* The model that answered a chat's last message. */
  if (!(db.prepare("PRAGMA table_info(workspaces)").all() as { name: string }[]).some((c) => c.name === "last_model")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN last_model TEXT");
  }
  /* Where each turn left the agent's session, so a later message can be edited and run again from there. */
  if (!(db.prepare("PRAGMA table_info(turns)").all() as { name: string }[]).some((c) => c.name === "resume_at")) {
    db.exec("ALTER TABLE turns ADD COLUMN session TEXT; ALTER TABLE turns ADD COLUMN resume_at TEXT;");
  }
  /* Whether the chat's owner sent the message a turn runs for (0: someone it's shared with), so that turn never acts as the owner. */
  if (!(db.prepare("PRAGMA table_info(turns)").all() as { name: string }[]).some((c) => c.name === "by_owner")) {
    db.exec("ALTER TABLE turns ADD COLUMN by_owner INTEGER");
  }
  /* The feedback bank (lib/code/feedback.ts): thumbs on answers, and chats reported with no name. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_ratings (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, seq INTEGER NOT NULL, username TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating IN (1, -1)), note TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, seq, username)
    );
    CREATE INDEX IF NOT EXISTS ai_ratings_by_time ON ai_ratings (at);
    CREATE TABLE IF NOT EXISTS ai_reports (id TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '', chat TEXT NOT NULL, at INTEGER NOT NULL);
    /* What the agent thought, after the event it followed: never in the timeline, so nobody a chat is shared with sees it. Read only for feedback. */
    CREATE TABLE IF NOT EXISTS thinking (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, after_seq INTEGER NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS thinking_by_chat ON thinking (workspace_id, after_seq);
    /* Each tool call as it really was (the timeline keeps them shortened), for feedback alone. */
    CREATE TABLE IF NOT EXISTS tool_calls (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, id TEXT NOT NULL, input TEXT, output TEXT,
      PRIMARY KEY (workspace_id, id)
    );
  `);
  /* Which skills each person turned on (lib/code/skills.ts). */
  migrateSkills(db);
  /* Which Kimono a thumb or report was given on (its release tag, or "dev"), and which sandbox node and image. */
  for (const table of ["ai_ratings", "ai_reports"]) {
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes("version")) db.exec(`ALTER TABLE ${table} ADD COLUMN version TEXT`);
    if (!columns.includes("sandbox_version")) db.exec(`ALTER TABLE ${table} ADD COLUMN sandbox_version TEXT`);
  }
  /* An administrator's reply to a thumb: a thank-you, with a note if they wrote one, shown to the person under the answer. */
  if (!(db.prepare("PRAGMA table_info(ai_ratings)").all() as { name: string }[]).some((c) => c.name === "reply_at")) {
    db.exec("ALTER TABLE ai_ratings ADD COLUMN reply_at INTEGER; ALTER TABLE ai_ratings ADD COLUMN reply_note TEXT; ALTER TABLE ai_ratings ADD COLUMN reply_by TEXT;");
  }
  /* Where an administrator left each piece of feedback: done (replied to, or dealt with) or ignored; null is still to do. */
  for (const table of ["ai_ratings", "ai_reports"]) {
    if (!(db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === "status")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN status TEXT CHECK (status IN ('done', 'ignored')); ALTER TABLE ${table} ADD COLUMN status_at INTEGER;`);
    }
  }
  /* More of the plan an administrator gave someone, on top of their share, until the window it was given in ends. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_grants (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL, window TEXT NOT NULL CHECK (window IN ('five_hour', 'week')),
      extra REAL NOT NULL, until INTEGER NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS usage_grants_by_person ON usage_grants (username, until);
    CREATE TABLE IF NOT EXISTS credit_grants (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL, dollars REAL NOT NULL, until INTEGER NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS credit_grants_by_person ON credit_grants (username, until);
  `);
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

export type UsageWindow = "five_hour" | "week";
export type UsageGrant = { id: number; username: string; window: UsageWindow; extra: number; until: number; by: string; at: number };

/** Gives someone [extra] of the plan (a fraction) on top of their share, until the current window ends. */
export function grantUsage(db: DatabaseSync, username: string, window: UsageWindow, extra: number, by: string, now = Date.now()) {
  if (!(extra > 0 && extra <= 10)) throw new Error("That isn't an amount to give.");
  const used = usageOf(db, username, now);
  /* A window not seen yet starts with the next message: the grant lasts as long as such a window would. */
  const until = (window === "week" ? used.week.resetsAt : used.fiveHour.resetsAt) ?? now + (window === "week" ? 7 * 24 : 5) * 3_600_000;
  db.prepare("INSERT INTO usage_grants (username, window, extra, until, by, at) VALUES (?, ?, ?, ?, ?, ?)").run(username.toLowerCase(), window, extra, until, by, now);
}

/** The grants still running, for one person or everyone. */
export function usageGrants(db: DatabaseSync, username?: string, now = Date.now()): UsageGrant[] {
  const rows = username
    ? db.prepare("SELECT * FROM usage_grants WHERE username = ? AND until > ? ORDER BY at").all(username.toLowerCase(), now)
    : db.prepare("SELECT * FROM usage_grants WHERE until > ? ORDER BY at").all(now);
  return rows as UsageGrant[];
}

export function takeBackGrant(db: DatabaseSync, id: number) {
  db.prepare("DELETE FROM usage_grants WHERE id = ?").run(id);
}

/** What someone was given on top of their share, in each window, as fractions of the plan. */
export function extraOf(db: DatabaseSync, username: string, now = Date.now()) {
  const grants = usageGrants(db, username, now);
  const sum = (window: UsageWindow) => grants.filter((g) => g.window === window).reduce((total, g) => total + g.extra, 0);
  return { fiveHour: sum("five_hour"), week: sum("week") };
}

/* ── Pro Tools credits given on top of the monthly allowance (lib/code/media.ts) ── */

export type CreditGrant = { id: number; username: string; dollars: number; until: number; by: string; at: number };

/** Gives someone [dollars] more of Pro Tools (100 credits each), until the month's allowance comes back. */
export function grantCredits(db: DatabaseSync, username: string, dollars: number, by: string, now = Date.now()) {
  if (!(dollars > 0 && dollars <= 10_000)) throw new Error("That isn't an amount to give.");
  const d = new Date(now);
  const until = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  db.prepare("INSERT INTO credit_grants (username, dollars, until, by, at) VALUES (?, ?, ?, ?, ?)").run(username.toLowerCase(), dollars, until, by, now);
}

export function creditGrants(db: DatabaseSync, username?: string, now = Date.now()): CreditGrant[] {
  const rows = username
    ? db.prepare("SELECT * FROM credit_grants WHERE username = ? AND until > ? ORDER BY at").all(username.toLowerCase(), now)
    : db.prepare("SELECT * FROM credit_grants WHERE until > ? ORDER BY at").all(now);
  return rows as CreditGrant[];
}

export function takeBackCredits(db: DatabaseSync, id: number) {
  db.prepare("DELETE FROM credit_grants WHERE id = ?").run(id);
}

/** The Pro Tools dollars someone was given this month, on top of everyone's allowance. */
export const extraCredits = (db: DatabaseSync, username: string, now = Date.now()) =>
  creditGrants(db, username, now).reduce((total, g) => total + g.dollars, 0);

type WorkspaceRow = {
  id: string; owner: string; title: string; repo_owner: string; repo_name: string; base: string; branch: string;
  session: string | null; pr_url: string | null; pr_number: number | null; preview_url: string | null; preview_port: number | null; preview_name: string | null; preview_kind: string | null; preview_stopped: number; drive_folder: string | null; drive_space: string | null; project_id: string | null; project_name: string | null; archived_at: number | null; last_model: string | null; created_at: number; updated_at: number; last_seq: number;
  turn_id: string | null; turn_state: TurnState | null; turn_started: number | null; turn_ended: number | null;
};

const selectWorkspace = `
  SELECT w.*, (SELECT space_id FROM drive_spaces d WHERE d.owner = w.owner) AS drive_space, (SELECT name FROM projects p WHERE p.id = w.project_id) AS project_name, t.id AS turn_id, t.state AS turn_state, t.started_at AS turn_started, t.ended_at AS turn_ended
  FROM workspaces w
  LEFT JOIN turns t ON t.id = (SELECT id FROM turns WHERE workspace_id = w.id ORDER BY started_at DESC LIMIT 1)`;

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id, owner: row.owner, title: row.title,
    kind: row.repo_name ? "project" : "chat",
    folder: row.project_id && row.project_name ? { id: row.project_id, name: row.project_name } : null,
    repo: { owner: row.repo_owner, name: row.repo_name }, base: row.base, branch: row.branch,
    session: row.session,
    pullRequest: row.pr_url && row.pr_number ? { url: row.pr_url, number: row.pr_number } : null,
    preview: row.preview_url && row.preview_port ? { url: row.preview_url, port: row.preview_port, kind: row.preview_kind ?? null, stopped: row.preview_stopped === 1 } : null,
    previewName: row.preview_name ?? null,
    drive: row.drive_space && row.drive_folder ? { spaceId: row.drive_space, folderId: row.drive_folder } : null,
    createdAt: row.created_at, updatedAt: row.updated_at, lastSeq: row.last_seq, archivedAt: row.archived_at ?? null,
    lastModel: row.last_model === "fable" || row.last_model === "opus" || row.last_model === "sonnet" || row.last_model === "haiku" ? row.last_model : null,
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

/** A new chat; with a repository named, a project on it. */
export function createWorkspace(db: DatabaseSync, owner: string, input: { repoOwner?: unknown; repoName?: unknown; base?: unknown; prompt: unknown; folder?: unknown }, now = Date.now()): Workspace {
  const repoOwner = String(input.repoOwner ?? "");
  const repoName = String(input.repoName ?? "");
  const base = String(input.base ?? "");
  const prompt = String(input.prompt ?? "").trim();
  const project = Boolean(repoOwner || repoName);
  if (project && (!namePattern.test(repoOwner) || !namePattern.test(repoName))) throw new CodeProblem("Choose a repository.");
  if (project && !branchPattern.test(base)) throw new CodeProblem("Choose a branch.");
  if (!prompt) throw new CodeProblem("Say what to do.");
  const folder = input.folder ? projectFor(db, String(input.folder), owner).id : null;
  const id = newId();
  const title = titleFrom(prompt);
  db.prepare(`INSERT INTO workspaces (id, owner, title, repo_owner, repo_name, base, branch, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, owner.toLowerCase(), title, repoOwner, repoName, project ? base : "", project ? branchFor(title) : "", folder, now, now);
  return workspaceFor(db, id, owner);
}

/** One workspace, if it is yours. */
export function workspaceFor(db: DatabaseSync, id: string, owner: string): Workspace {
  const row = db.prepare(`${selectWorkspace} WHERE w.id = ? AND w.owner = ?`).get(id, owner.toLowerCase()) as WorkspaceRow | undefined;
  if (!row) throw new CodeProblem("That workspace isn't here.", 404);
  return toWorkspace(row);
}

/** Chats other people shared with [username] (lib/code/sharing.ts), the most recently active first. */
export function sharedWorkspacesOf(db: DatabaseSync, username: string): Workspace[] {
  return (db.prepare(`${selectWorkspace} WHERE w.id IN (SELECT workspace_id FROM chat_shares WHERE username = ?) ORDER BY w.updated_at DESC LIMIT 200`).all(username.toLowerCase()) as WorkspaceRow[]).map(toWorkspace);
}

export function workspacesOf(db: DatabaseSync, owner: string): Workspace[] {
  return (db.prepare(`${selectWorkspace} WHERE w.owner = ? ORDER BY w.updated_at DESC LIMIT 200`).all(owner.toLowerCase()) as WorkspaceRow[]).map(toWorkspace);
}

/* ── projects: folders of chats ── */

export type Project = { id: string; name: string; createdAt: number };

const projectName = (raw: unknown) => {
  const name = String(raw ?? "").replace(/[\u0000-\u001f\u007f/\\]/g, " ").replace(/\s+/g, " ").trim();
  if (!name || name.length > 60) throw new CodeProblem("Give the project a name of up to 60 characters.");
  return name;
};

export function projectsOf(db: DatabaseSync, owner: string): Project[] {
  return (db.prepare("SELECT id, name, created_at FROM projects WHERE owner = ? ORDER BY lower(name)").all(owner.toLowerCase()) as { id: string; name: string; created_at: number }[])
    .map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at }));
}

export function projectFor(db: DatabaseSync, id: string, owner: string): Project {
  const found = projectsOf(db, owner).find((p) => p.id === id);
  if (!found) throw new CodeProblem("That project isn't here.", 404);
  return found;
}

export function createProject(db: DatabaseSync, owner: string, raw: unknown, now = Date.now()): Project {
  const name = projectName(raw);
  if (projectsOf(db, owner).some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new CodeProblem("You already have a project by that name.", 409);
  const project = { id: newId(), name, createdAt: now };
  db.prepare("INSERT INTO projects (id, owner, name, created_at) VALUES (?, ?, ?, ?)").run(project.id, owner.toLowerCase(), name, now);
  return project;
}

export function renameProject(db: DatabaseSync, id: string, owner: string, raw: unknown): Project {
  projectFor(db, id, owner);
  const name = projectName(raw);
  if (projectsOf(db, owner).some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) throw new CodeProblem("You already have a project by that name.", 409);
  db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, id);
  return projectFor(db, id, owner);
}

/** Removes a project; its chats stay, out of any project. */
export function removeProject(db: DatabaseSync, id: string, owner: string) {
  projectFor(db, id, owner);
  db.prepare("UPDATE workspaces SET project_id = NULL WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

/** Puts a chat in a project, or (null) in none. */
export function setWorkspaceProject(db: DatabaseSync, workspaceId: string, owner: string, folder: string | null): Workspace {
  workspaceFor(db, workspaceId, owner);
  const id = folder ? projectFor(db, folder, owner).id : null;
  db.prepare("UPDATE workspaces SET project_id = ? WHERE id = ?").run(id, workspaceId);
  return workspaceFor(db, workspaceId, owner);
}

export function renameWorkspace(db: DatabaseSync, id: string, owner: string, title: unknown) {
  const value = String(title ?? "").trim().replace(/\s+/g, " ");
  if (!value || value.length > 120) throw new CodeProblem("Give it a name of up to 120 characters.");
  workspaceFor(db, id, owner);
  db.prepare("UPDATE workspaces SET title = ?, named = 1, updated_at = ? WHERE id = ?").run(value, Date.now(), id);
  return workspaceFor(db, id, owner);
}

/** Whether a chat still has the name it started with, waiting for one from its first exchange. */
export function awaitsName(db: DatabaseSync, id: string) {
  return (db.prepare("SELECT named FROM workspaces WHERE id = ?").get(id) as { named: number } | undefined)?.named === 0;
}

/** Gives a chat its name from its first exchange, unless it has one by now; marks it named either way. */
export function nameWorkspace(db: DatabaseSync, id: string, title: string | null): boolean {
  if (!title) { db.prepare("UPDATE workspaces SET named = 1 WHERE id = ?").run(id); return false; }
  return db.prepare("UPDATE workspaces SET title = ?, named = 1 WHERE id = ? AND named = 0").run(title, id).changes > 0;
}

/** Archives a chat, or brings it back. */
export function archiveWorkspace(db: DatabaseSync, id: string, owner: string, archived: boolean, now = Date.now()) {
  workspaceFor(db, id, owner);
  db.prepare("UPDATE workspaces SET archived_at = ? WHERE id = ?").run(archived ? now : null, id);
  return workspaceFor(db, id, owner);
}

export function removeWorkspace(db: DatabaseSync, id: string, owner: string) {
  workspaceFor(db, id, owner);
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
}

export function setSession(db: DatabaseSync, id: string, session: string | null) {
  db.prepare("UPDATE workspaces SET session = ? WHERE id = ?").run(session, id);
}

export function setPullRequest(db: DatabaseSync, id: string, pr: { url: string; number: number }) {
  db.prepare("UPDATE workspaces SET pr_url = ?, pr_number = ?, updated_at = ? WHERE id = ?").run(pr.url, pr.number, Date.now(), id);
}

/** Records the app's link, or forgets it with null. Only http(s) links are kept. */
export function setPreview(db: DatabaseSync, id: string, preview: { url: string; port: number; kind?: unknown; stopped?: unknown } | null) {
  const ok = preview && /^https?:\/\//.test(preview.url) && Number.isInteger(preview.port) && preview.port > 0 && preview.port < 65536;
  const kind = ok && typeof preview.kind === "string" && preview.kind.trim() ? preview.kind.trim().slice(0, 60) : null;
  db.prepare("UPDATE workspaces SET preview_url = ?, preview_port = ?, preview_kind = ?, preview_stopped = ?, updated_at = ? WHERE id = ?")
    .run(ok ? preview.url : null, ok ? preview.port : null, kind, ok && preview.stopped === true ? 1 : 0, Date.now(), id);
}

/** The turn running in a workspace now, if any. */
export function runningTurn(db: DatabaseSync, workspaceId: string): string | null {
  const row = db.prepare("SELECT id FROM turns WHERE workspace_id = ? AND state = 'running'").get(workspaceId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function setLastModel(db: DatabaseSync, id: string, model: "fable" | "opus" | "sonnet" | "haiku") {
  db.prepare("UPDATE workspaces SET last_model = ? WHERE id = ?").run(model, id);
}

export function setPreviewName(db: DatabaseSync, id: string, name: string | null) {
  db.prepare("UPDATE workspaces SET preview_name = ? WHERE id = ?").run(name, id);
}

/** Starts a turn, refusing while another is running in the same workspace. */
export function startTurn(db: DatabaseSync, workspaceId: string, now = Date.now()): string {
  const running = db.prepare("SELECT id FROM turns WHERE workspace_id = ? AND state = 'running'").get(workspaceId);
  if (running) throw new CodeProblem("It's still working on the last message.", 409);
  const id = newId();
  db.prepare("INSERT INTO turns (id, workspace_id, state, started_at) VALUES (?, ?, 'running', ?)").run(id, workspaceId, now);
  /* Something new said in an archived chat brings it back to the list. */
  db.prepare("UPDATE workspaces SET updated_at = ?, archived_at = NULL WHERE id = ?").run(now, workspaceId);
  return id;
}

export function endTurn(db: DatabaseSync, turnId: string, state: Exclude<TurnState, "running">, now = Date.now()) {
  db.prepare("UPDATE turns SET state = ?, ended_at = ? WHERE id = ? AND state = 'running'").run(state, now, turnId);
}

export function setTurnByOwner(db: DatabaseSync, turnId: string, byOwner: boolean) {
  db.prepare("UPDATE turns SET by_owner = ? WHERE id = ?").run(byOwner ? 1 : 0, turnId);
}

/** Whether the owner sent each of the chat's latest turns, newest first. Turns from before this was kept count as the owner's. */
export function turnsByOwner(db: DatabaseSync, workspaceId: string, limit: number): boolean[] {
  const rows = db.prepare("SELECT by_owner FROM turns WHERE workspace_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?").all(workspaceId, limit) as { by_owner: number | null }[];
  return rows.map((r) => r.by_owner !== 0);
}

/** Whether the owner sent the message [turnId] runs for; null when it isn't known. */
export function turnByOwner(db: DatabaseSync, turnId: string): boolean | null {
  const row = db.prepare("SELECT by_owner FROM turns WHERE id = ?").get(turnId) as { by_owner: number | null } | undefined;
  return row?.by_owner == null ? null : row.by_owner === 1;
}

/** Where a turn left the agent's session: its id, and its last message (the agent's) to carry on from. */
export function noteTurnEnd(db: DatabaseSync, turnId: string, session: string | null, lastMessage: string | null) {
  db.prepare("UPDATE turns SET session = coalesce(?, session), resume_at = coalesce(?, resume_at) WHERE id = ?").run(session, lastMessage, turnId);
}

/**
 * Takes the chat back to just before one of the person's messages, for it to be sent again
 * changed: that message and everything after it go. Returns where the agent's session was at
 * that point (none before the first message, unknown for a turn from before this was kept), and
 * the conversation up to it, for a session that can't be carried on.
 */
export function rewindTo(db: DatabaseSync, workspaceId: string, seq: number): { by: string; resume: { session: string | null; at: string | null } | null; before: StoredEvent[] } {
  const row = db.prepare("SELECT turn_id, data FROM events WHERE workspace_id = ? AND seq = ?").get(workspaceId, seq) as { turn_id: string | null; data: string } | undefined;
  const event = row ? JSON.parse(row.data) as CodeEvent : null;
  if (!event || event.kind !== "ask") throw new CodeProblem("That message isn't here.", 404);
  if (event.queued) throw new CodeProblem("A message sent while it was working can't be edited.", 409);
  const before = eventsAfter(db, workspaceId, 0, 100_000).filter((e) => e.seq < seq);
  const previous = [...before].reverse().find((e) => e.turn && e.turn !== row!.turn_id)?.turn ?? null;
  const turn = previous ? db.prepare("SELECT session, resume_at FROM turns WHERE id = ?").get(previous) as { session: string | null; resume_at: string | null } | undefined : undefined;
  db.exec("BEGIN");
  try {
    const gone = (db.prepare("SELECT DISTINCT turn_id FROM events WHERE workspace_id = ? AND seq >= ? AND turn_id IS NOT NULL").all(workspaceId, seq) as { turn_id: string }[]).map((r) => r.turn_id);
    db.prepare("DELETE FROM events WHERE workspace_id = ? AND seq >= ?").run(workspaceId, seq);
    db.prepare("DELETE FROM thinking WHERE workspace_id = ? AND after_seq >= ?").run(workspaceId, seq);
    for (const id of gone) {
      if (!db.prepare("SELECT 1 FROM events WHERE workspace_id = ? AND turn_id = ? LIMIT 1").get(workspaceId, id)) db.prepare("DELETE FROM turns WHERE id = ?").run(id);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { by: event.by, resume: previous ? { session: turn?.session ?? null, at: turn?.resume_at ?? null } : null, before };
}

/** Turns left running by a Portal that stopped mid-turn: nothing is driving them any more. */
export function abandonRunningTurns(db: DatabaseSync, now = Date.now()): { workspace: string; turn: string }[] {
  const rows = db.prepare("SELECT id, workspace_id FROM turns WHERE state = 'running'").all() as { id: string; workspace_id: string }[];
  for (const row of rows) endTurn(db, row.id, "failed", now);
  return rows.map((row) => ({ workspace: row.workspace_id, turn: row.id }));
}

/** Appends an event and returns it with its sequence number. */
export function appendEvent(db: DatabaseSync, workspaceId: string, turnId: string | null, event: CodeEvent, now = Date.now()): StoredEvent {
  const row = db.prepare("UPDATE workspaces SET last_seq = last_seq + 1 WHERE id = ? RETURNING last_seq").get(workspaceId) as { last_seq: number } | undefined;
  /* Deleted while something was still writing to it. */
  if (!row) throw new CodeProblem("That workspace isn't here.", 404);
  const { last_seq } = row;
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

/** Keeps what the agent thought, placed after the chat's latest event. */
export function keepThinking(db: DatabaseSync, workspaceId: string, text: string, now = Date.now()) {
  const last = db.prepare("SELECT MAX(seq) AS seq FROM events WHERE workspace_id = ?").get(workspaceId) as { seq: number | null };
  db.prepare("INSERT INTO thinking (workspace_id, after_seq, at, text) VALUES (?, ?, ?, ?)").run(workspaceId, last.seq ?? 0, now, text);
}

/** What the agent thought in a chat up to [seq], by the event each came after. */
export function thinkingUpTo(db: DatabaseSync, workspaceId: string, seq: number): Map<number, { text: string; at: number }[]> {
  const rows = db.prepare("SELECT after_seq, text, at FROM thinking WHERE workspace_id = ? AND after_seq <= ? ORDER BY after_seq, rowid").all(workspaceId, seq) as { after_seq: number; text: string; at: number }[];
  const by = new Map<number, { text: string; at: number }[]>();
  for (const row of rows) by.set(row.after_seq, [...(by.get(row.after_seq) ?? []), { text: row.text, at: row.at }]);
  return by;
}

/** Keeps a tool call's full input or output, whichever this is. */
export function keepToolCall(db: DatabaseSync, workspaceId: string, call: { id: string; input?: string; output?: string }) {
  db.prepare(`INSERT INTO tool_calls (workspace_id, id, input, output) VALUES (?, ?, ?, ?)
    ON CONFLICT (workspace_id, id) DO UPDATE SET input = COALESCE(excluded.input, input), output = COALESCE(excluded.output, output)`)
    .run(workspaceId, call.id, call.input ?? null, call.output ?? null);
}

/** A chat's tool calls in full, by their id. */
export function toolCallsOf(db: DatabaseSync, workspaceId: string): Map<string, { input: string | null; output: string | null }> {
  const rows = db.prepare("SELECT id, input, output FROM tool_calls WHERE workspace_id = ?").all(workspaceId) as { id: string; input: string | null; output: string | null }[];
  return new Map(rows.map((r) => [r.id, { input: r.input, output: r.output }]));
}
