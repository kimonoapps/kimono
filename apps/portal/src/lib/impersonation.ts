import "server-only";

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { identityRequest, listAccounts } from "./directory";
import { serialize, writeFileAtomic } from "./serial";
import { stateDir } from "./state";

/*
 * An administrator can sign in as someone else from the identity provider's
 * People page. Kimono follows: a sign-in made while that is going on is that
 * person's, with who is really there carried beside it, and the person is
 * told about it the next time they sign in themselves.
 *
 * The identity provider is the record. Its events say who started signing in
 * as whom, why, and on whose behalf each sign-in to an app was made; Kimono
 * keeps only which of those each person has already been shown.
 */

type EventUser = { username?: string; on_behalf_of?: { username?: string } };
type IdentityEvent = { pk: string; action: string; created: string; user?: EventUser; context?: { message?: string; reason?: string } };

export type Impersonator = { username: string; name: string };
export type ImpersonationNotice = { id: string; at: string; by: string; reason: string };

async function recentEvents(action: string, pageSize: number): Promise<IdentityEvent[]> {
  const response = await identityRequest(`/api/v3/events/events/?action=${action}&ordering=-created&page_size=${pageSize}`);
  const payload = await response.json() as { results?: IdentityEvent[] };
  return payload.results || [];
}

const same = (a: string | undefined, b: string) => Boolean(a) && a!.toLowerCase() === b.toLowerCase();

async function nameOf(username: string) {
  const account = (await listAccounts()).find((item) => same(item.username, username));
  return account?.name?.trim() || username;
}

/**
 * Who is really behind this sign-in as [username], if it was made by someone
 * signed in as them. The identity provider notes every app sign-in the moment
 * it hands it over, so the newest one involving this account in the last few
 * minutes is this one; it says on whose behalf it was made.
 */
export async function impersonatorOf(username: string): Promise<Impersonator | null> {
  const since = Date.now() - 3 * 60 * 1000;
  const events = await recentEvents("authorize_application", 50);
  const latest = events.find((event) => Date.parse(event.created) >= since
    && (same(event.user?.on_behalf_of?.username, username) || (same(event.user?.username, username) && !event.user?.on_behalf_of)));
  const by = latest?.user?.on_behalf_of ? latest.user.username : undefined;
  if (!by || same(by, username)) return null;
  return { username: by.toLowerCase(), name: await nameOf(by) };
}

/* ── What each person has been told ─────────────────────────── */

const noticePath = join(stateDir, "impersonation-notices.json");
type Notices = { seen: Record<string, string>; pending: Record<string, ImpersonationNotice[]> };

async function readNotices(): Promise<Notices> {
  try {
    const parsed = JSON.parse(await readFile(noticePath, "utf8")) as Partial<Notices>;
    return { seen: parsed.seen && typeof parsed.seen === "object" ? parsed.seen : {}, pending: parsed.pending && typeof parsed.pending === "object" ? parsed.pending : {} };
  } catch {
    return { seen: {}, pending: {} };
  }
}

async function writeNotices(notices: Notices) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFileAtomic(noticePath, `${JSON.stringify(notices, null, 2)}\n`, 0o600);
}

/**
 * Called when [username] signs in themselves: every time someone signed in as
 * them since they were last told is set aside, to be shown until they close it.
 */
export async function noteImpersonationsOf(username: string) {
  const key = username.toLowerCase();
  const events = (await recentEvents("impersonation_started", 200))
    .filter((event) => same(event.user?.on_behalf_of?.username, key) && event.user?.username && !same(event.user.username, key));
  if (!events.length) return;
  const found = await Promise.all(events.map(async (event): Promise<ImpersonationNotice> => ({
    id: event.pk,
    at: event.created,
    by: await nameOf(event.user!.username!),
    reason: (event.context?.reason || event.context?.message || "").trim(),
  })));
  await serialize(noticePath, async () => {
    const notices = await readNotices();
    const seen = notices.seen[key] ? Date.parse(notices.seen[key]) : 0;
    const fresh = found.filter((notice) => Date.parse(notice.at) > seen);
    if (!fresh.length) return;
    const pending = [...(notices.pending[key] || []), ...fresh];
    const byId = new Map(pending.map((notice) => [notice.id, notice]));
    notices.pending[key] = [...byId.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
    notices.seen[key] = fresh.reduce((latest, notice) => notice.at > latest ? notice.at : latest, notices.seen[key] || "");
    await writeNotices(notices);
  });
}

/** The times someone signed in as [username] that they haven't closed yet, newest first. */
export async function pendingImpersonations(username: string): Promise<ImpersonationNotice[]> {
  return (await readNotices()).pending[username.toLowerCase()] || [];
}

export function dismissImpersonations(username: string) {
  const key = username.toLowerCase();
  return serialize(noticePath, async () => {
    const notices = await readNotices();
    if (!notices.pending[key]) return;
    delete notices.pending[key];
    await writeNotices(notices);
  });
}

/** Where the browser ends signing in as someone else: the identity provider's own address. */
export function identityOrigin() {
  const issuer = process.env.AUTHENTIK_ISSUER;
  try { return issuer ? new URL(issuer).origin : null; } catch { return null; }
}
