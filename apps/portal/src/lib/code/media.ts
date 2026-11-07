import type { DatabaseSync } from "node:sqlite";
import type { CodeConfig } from "./config";
import { connections, instantCharges, instantOpen, instantSpent, instantToolkit, setInstant, SpendUnreadable } from "./composio";

/*
 * Each person's monthly allowance for paid tools: Composio's Instant tools
 * (voice, video, pictures, web search and the rest), which Composio charges to
 * Kimono's balance. What they spent comes from Composio's own logs; once it
 * reaches the allowance,
 * Instant is switched off on their session, so Composio itself refuses more,
 * and on again when a new month starts or the allowance is raised. Logs lag a
 * little, so the last call or two of a month can go slightly over.
 */

/** unreadable: the key can't see what was spent, so Pro Tools stay closed until it can. */
export type MediaAllowance = { budget: number; spent: number | null; resetsAt: number; open: boolean; unreadable?: boolean };

/** This calendar month (UTC): when it began, and when the next one does. */
export function monthOf(now: number) {
  const d = new Date(now);
  return { from: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), resetsAt: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) };
}

const last = new Map<string, MediaAllowance>();

/**
 * Reads what the person spent this month and opens or closes their Instant
 * tools to match. Null when there's no Composio, or they have no tool session yet.
 */
export async function holdMediaBudget(db: DatabaseSync, config: CodeConfig, username: string, origin: string, now = Date.now(), fresh = 60_000): Promise<MediaAllowance | null> {
  if (!config.composioKey) return null;
  const was = instantOpen(db, username);
  if (was === null) return null;
  const { from, resetsAt } = monthOf(now);
  let spent: number | null = null, unreadable = false;
  if (config.mediaBudget > 0) {
    try { spent = await instantSpent(config.composioKey, username, origin, from, now, fresh); }
    catch (error) {
      if (!(error instanceof SpendUnreadable)) throw error;
      /* Never spend what can't be counted: closed until the key may read the logs. */
      unreadable = true;
      console.warn(`Kimono AI's Pro Tools are off: ${error.message}`);
    }
  }
  /* When the logs can't be reached for a moment, it stays as it was. */
  const open = config.mediaBudget > 0 && !unreadable && (spent === null ? was : spent < config.mediaBudget);
  if (open !== was) await setInstant(db, config.composioKey, username, open);
  const allowance = { budget: config.mediaBudget, spent, resetsAt, open: instantOpen(db, username) ?? open, unreadable };
  last.set(username, allowance);
  return allowance;
}

/**
 * What one chat of the person's spent on paid tools this month, in US dollars:
 * their charges made while one of its turns ran. Two chats working at once
 * could each count the other's; that's rare, and only decides what's shown.
 */
export function chatSpent(db: DatabaseSync, workspaceId: string, username: string, now = Date.now()): number {
  const { from } = monthOf(now);
  const charges = instantCharges(username, from);
  if (!charges.length) return 0;
  /* A charge is logged as the call runs; a little slack covers the log's clock. */
  const slack = 60_000;
  const turns = db.prepare("SELECT started_at, ended_at FROM turns WHERE workspace_id = ? AND (ended_at IS NULL OR ended_at >= ?)").all(workspaceId, from) as { started_at: number; ended_at: number | null }[];
  let micros = 0;
  for (const charge of charges) {
    if (turns.some((t) => charge.at >= t.started_at - slack && charge.at <= (t.ended_at ?? now) + slack)) micros += charge.micros;
  }
  return micros / 1_000_000;
}

/** The person's allowance as it was last read. */
export const lastAllowance = (username: string) => last.get(username) ?? null;

const guarded = new Map<string, number>();

/** While a turn runs: after one of its tools answers, checks again (at most every 15 seconds), so a turn can't spend far past the allowance. */
export function guardMediaBudget(db: DatabaseSync, config: CodeConfig, username: string, origin: string, now = Date.now()) {
  if (!config.composioKey || config.mediaBudget <= 0 || now - (guarded.get(username) ?? 0) < 15_000) return;
  guarded.set(username, now);
  void holdMediaBudget(db, config, username, origin, now, 15_000).catch((error) => console.warn("Kimono AI couldn't check the Pro Tools allowance:", error instanceof Error ? error.message : error));
}

/* Pro Tools are counted in credits, a hundred to the dollar, everywhere a person sees them. */
const dollars = (n: number) => `${Math.round(n * 100).toLocaleString("en")} credits`;
const dayOf = (at: number) => new Date(at).toLocaleDateString("en", { month: "long", day: "numeric", timeZone: "UTC" });

/** What the agent is told this turn about the Pro Tools allowance; nothing when there's none. */
export function mediaNote(allowance: MediaAllowance | null): string {
  if (!allowance || allowance.budget <= 0) return "";
  if (allowance.unreadable) return "Pro Tools (tools that need no account of the person's) aren't available right now. Don't use them or ask the person to connect one for this: say they're unavailable, and use what's here instead.";
  if (!allowance.open) {
    return `This person's Pro Tools allowance for the month (${dollars(allowance.budget)}) is used up, and comes back on ${dayOf(allowance.resetsAt)}. Pro Tools (voice, video, pictures, web search and the like) now work only through an account the person connected themselves: don't ask them to connect one for this. Say it's used up and when it returns, and offer an artifact where one would do.`;
  }
  const left = allowance.spent === null ? null : Math.max(0, allowance.budget - allowance.spent);
  return `Pro Tools (tools that need no account of theirs: voice, video, pictures, web search and the like) cost this person's monthly Pro Tools allowance: ${left === null ? "some" : dollars(left)} of ${dollars(allowance.budget)} left, until ${dayOf(allowance.resetsAt)}. Speak of it in credits, never dollars: a credit is a US cent, so a tool that says it costs $2.31 used 231 credits.`;
}

const connected = new Map<string, { apps: Set<string>; at: number }>();

/**
 * Whether a call to [app] ran as a Pro Tool: Pro Tools are open for the
 * person, they haven't connected that app themselves (Composio uses their own
 * account first), and the app has Instant tools. False when it can't be told.
 */
export async function ranAsPro(db: DatabaseSync, config: CodeConfig, username: string, origin: string, app: string, now = Date.now()): Promise<boolean> {
  if (!config.composioKey || config.mediaBudget <= 0 || instantOpen(db, username) !== true) return false;
  let mine = connected.get(username);
  if (!mine || now - mine.at > 60_000) {
    try {
      mine = { apps: new Set((await connections(db, config.composioKey, username, origin)).filter((c) => c.status === "ACTIVE").map((c) => c.app)), at: now };
      connected.set(username, mine);
    } catch {
      return false;
    }
  }
  if (mine.apps.has(app)) return false;
  return instantToolkit(config.composioKey, app, now);
}
