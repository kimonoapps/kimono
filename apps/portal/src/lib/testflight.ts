import "server-only";

import { mkdir, readFile, rm } from "node:fs/promises";
import { serialize, writeFileAtomic } from "./serial";
import { dirname, join } from "node:path";
import { listAccounts, readStanding } from "./directory";
import { stateDir } from "./state";
import { invitedRole, isStuck, nameParts, planAlso, planSync, type Invited, type PlanAccount, type TesterStatus } from "./testflight-plan";
import { appStoreToken } from "./testflight-token";

/*
 * TestFlight for Kimono's iPhone apps (Kimono, and Kimono Photos once it's in
 * App Store Connect), kept in step with Kimono's accounts:
 * everyone with one is an internal tester, through App Store Connect's API
 * and a key the admin gives the Portal. The rules are in testflight-plan.ts;
 * this reads App Store Connect, carries the plan out, and remembers whom it
 * invited, so it only ever takes those people off again.
 */

const configPath = join(stateDir, "testflight.json");
/** Kimono's phone apps on iPhone, the Kimono app first: its group decides who is on the team. */
const phoneApps = [
  { bundleId: "app.kimono.compose", name: "Kimono" },
  { bundleId: "app.kimono.photos", name: "Kimono Photos" },
  { bundleId: "app.kimono.watch", name: "Kimono Watch" },
] as const;
const api = "https://api.appstoreconnect.apple.com";
const syncEvery = 60 * 60 * 1000;

export type LastSync = {
  at: number; ok: boolean; message: string; counts: Record<string, number>;
  /** The phone apps found in App Store Connect, by name. */
  apps?: string[];
};
/** Kimono's iPhone apps by bundle ID, as people ask for them. */
export type PhoneAppId = (typeof phoneApps)[number]["bundleId"];
export const mainApp: PhoneAppId = "app.kimono.compose";
export const phoneAppName = (bundleId: string) => phoneApps.find((a) => a.bundleId === bundleId)?.name ?? null;
export const isPhoneApp = (bundleId: unknown): bundleId is PhoneAppId => typeof bundleId === "string" && phoneApps.some((a) => a.bundleId === bundleId);
/** Someone's ask for one app: nothing is sent until an admin approves it. */
export type AppRequest = { at: number; state: "pending" | "approved" | "declined"; decidedAt?: number; by?: string };
/** Requests by Kimono username, then by app. */
type Requests = Record<string, Partial<Record<PhoneAppId, AppRequest>>>;
/** A request an admin hasn't answered yet. */
export type PendingRequest = { username: string; bundleId: PhoneAppId; app: string; at: number };
/** When each email was last sent a fresh invite, so a button pressed twice doesn't send two. */
type Resent = Record<string, number>;
/** The email of someone's Apple Account, by Kimono username, when it isn't their Kimono email: Apple only lets them accept there. */
type AppleEmails = Record<string, string>;
type Config = { issuerId: string; keyId: string; privateKey: string; groupName: string; invited: Invited; requests: Requests; resent: Resent; appleEmails: AppleEmails; lastSync: LastSync | null; statuses: TesterStatus[] };

async function readConfig(): Promise<Config | null> {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as Partial<Config>;
    if (!parsed.issuerId || !parsed.keyId || !parsed.privateKey) return null;
    return {
      issuerId: parsed.issuerId, keyId: parsed.keyId, privateKey: parsed.privateKey,
      groupName: parsed.groupName || "Kimono",
      invited: parsed.invited && typeof parsed.invited === "object" ? parsed.invited : {},
      requests: requestsFrom(parsed),
      resent: parsed.resent && typeof parsed.resent === "object" ? parsed.resent : {},
      appleEmails: parsed.appleEmails && typeof parsed.appleEmails === "object" ? parsed.appleEmails : {},
      lastSync: parsed.lastSync ?? null,
      statuses: Array.isArray(parsed.statuses) ? parsed.statuses : [],
    };
  } catch {
    return null;
  }
}

/* Requests as kept, from before approval too: whoever had asked was let in to Kimono, and stays so. */
function requestsFrom(parsed: { requests?: Requests; requested?: Record<string, number> }): Requests {
  const requests: Requests = parsed.requests && typeof parsed.requests === "object" ? structuredClone(parsed.requests) : {};
  for (const [username, at] of Object.entries(parsed.requested && typeof parsed.requested === "object" ? parsed.requested : {})) {
    const mine = requests[username] ??= {};
    mine[mainApp] ??= { at: Number(at) || Date.now(), state: "approved" };
  }
  return requests;
}

/* The file is read, changed and written whole: one change at a time, each from a fresh read. */
const configTurn = <T>(work: () => Promise<T>) => serialize(configPath, work);

async function writeConfig(config: Config) {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}
`, 0o600);
}

/** What the admin page shows: never the key itself. */
export async function testflightSettings(): Promise<{ keyId: string; issuerId: string; groupName: string; lastSync: LastSync | null; statuses: TesterStatus[]; pending: PendingRequest[] } | null> {
  const config = await readConfig();
  if (!config) return null;
  const pending = Object.entries(config.requests).flatMap(([username, mine]) => Object.entries(mine)
    .filter(([, request]) => request?.state === "pending")
    .map(([bundleId, request]) => ({ username, bundleId: bundleId as PhoneAppId, app: phoneAppName(bundleId) ?? bundleId, at: request!.at })))
    .sort((a, b) => a.at - b.at);
  return { keyId: config.keyId, issuerId: config.issuerId, groupName: config.groupName, lastSync: config.lastSync, statuses: config.statuses, pending };
}

/** The iPhone apps people can ask for: Kimono, and the others once they're in App Store Connect. */
export async function testflightApps(): Promise<{ bundleId: PhoneAppId; name: string }[]> {
  const config = await readConfig().catch(() => null);
  const found = config?.lastSync?.apps;
  return phoneApps.filter((a) => a.bundleId === mainApp || found?.includes(a.name)).map((a) => ({ bundleId: a.bundleId, name: a.name }));
}

/** Where someone stands with each iPhone app: the last sync's word, or their request while it waits. */
export async function myTestflight(username: string): Promise<{ email: string | null; apps: { bundleId: PhoneAppId; name: string; status: string }[] } | null> {
  const config = await readConfig();
  if (!config) return null;
  const key = username.toLowerCase();
  const row = config.statuses.find((s) => s.username.toLowerCase() === key);
  const apps = (await testflightApps()).map((a) => {
    const request = config.requests[key]?.[a.bundleId];
    const synced = a.bundleId === mainApp ? row?.status : row?.also?.[a.name];
    const status = request?.state === "pending" ? "awaiting approval"
      : request?.state === "declined" ? "declined"
      : synced && synced !== "not requested" && synced !== "no email" ? synced
      : request?.state === "approved" ? "approved"
      : synced ?? "not requested";
    return { ...a, status };
  });
  /* The email Apple invites: the one given for their Apple Account, else their Kimono one. */
  return { email: config.appleEmails[key] ?? row?.email ?? null, apps };
}

/* Whom the Portal invited, and who asked, kept even without a key. */
async function readKept(): Promise<{ invited: Invited; requests: Requests; appleEmails: AppleEmails }> {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as { invited?: Invited; requests?: Requests; requested?: Record<string, number>; appleEmails?: AppleEmails };
    return {
      invited: parsed.invited && typeof parsed.invited === "object" ? parsed.invited : {},
      requests: requestsFrom(parsed),
      appleEmails: parsed.appleEmails && typeof parsed.appleEmails === "object" ? parsed.appleEmails : {},
    };
  } catch {
    return { invited: {}, requests: {}, appleEmails: {} };
  }
}

/**
 * Notes that someone asked for one iPhone app: Kimono is theirs as soon as
 * they ask, and so is any other app once they have Kimono.
 */
export function requestTestflight(username: string, bundleId: PhoneAppId = mainApp): Promise<AppRequest["state"]> {
  return configTurn(async () => {
  const config = await readConfig();
  if (!config) throw new Error("The iPhone app isn't set up on this Kimono yet.");
  const key = username.toLowerCase();
  const existing = config.requests[key]?.[bundleId];
  if (existing?.state === "approved") return "approved" as const;
  const ready = bundleId === mainApp || config.requests[key]?.[mainApp]?.state === "approved";
  if (!ready && existing?.state === "pending") return "pending" as const;
  const request: AppRequest = ready
    ? { at: existing?.at ?? Date.now(), state: "approved", decidedAt: Date.now(), by: "asked" }
    : { at: Date.now(), state: "pending" };
  await writeConfig({ ...config, requests: { ...config.requests, [key]: { ...config.requests[key], [bundleId]: request } } });
  return request.state;
  });
}

/** An admin's answer to a request. Approving sends the invite (or adds them to the app's group) straight away. */
export async function decideTestflight(username: string, bundleId: PhoneAppId, approve: boolean, by: string) {
  await configTurn(async () => {
  const config = await readConfig();
  if (!config) throw new Error("The iPhone app isn't set up on this Kimono yet.");
  const key = username.toLowerCase();
  const existing = config.requests[key]?.[bundleId];
  const decided: AppRequest = { at: existing?.at ?? Date.now(), state: approve ? "approved" : "declined", decidedAt: Date.now(), by };
  await writeConfig({ ...config, requests: { ...config.requests, [key]: { ...config.requests[key], [bundleId]: decided } } });
  });
  return approve ? syncTestflight() : null;
}

/** Whether text looks enough like an email to hand to Apple. */
export const looksLikeEmail = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) && text.length <= 254;

/**
 * Invites someone at their Apple Account's email instead of their Kimono one
 * (or back at their Kimono one, given null). The sync that follows cancels
 * what the Portal sent to the old email and invites the new one.
 */
export async function setAppleEmail(username: string, email: string | null) {
  await configTurn(async () => {
  const config = await readConfig();
  if (!config) throw new Error("The iPhone app isn't set up on this Kimono yet.");
  const key = username.toLowerCase();
  const clean = email?.trim().toLowerCase() || null;
  if (clean && !looksLikeEmail(clean)) throw new Error("That doesn't look like an email.");
  const appleEmails = { ...config.appleEmails };
  if (clean) appleEmails[key] = clean; else delete appleEmails[key];
  await writeConfig({ ...config, appleEmails });
  });
  return syncTestflight();
}

export function saveTestflightKey(input: { issuerId: string; keyId: string; privateKey: string; groupName: string }) {
  return configTurn(async () => writeConfig({
    issuerId: input.issuerId, keyId: input.keyId, privateKey: input.privateKey, groupName: input.groupName || "Kimono",
    ...(await readKept()), resent: {}, lastSync: null, statuses: [],
  }));
}

/** Forgets the key. Whom the Portal invited is kept, so a key given again can still tidy up after them. */
export function forgetTestflightKey() {
  return configTurn(async () => {
    const existing = await readConfig();
    if (!existing) return;
    if (!Object.keys(existing.invited).length) { await rm(configPath, { force: true }); return; }
    await writeFileAtomic(configPath, `${JSON.stringify({ invited: existing.invited }, null, 2)}\n`, 0o600);
  });
}

/* ── App Store Connect ── */

type Resource = { id: string; type: string; attributes?: Record<string, unknown> };

class AppStoreConnect {
  constructor(private readonly config: Config) {}

  private async request(path: string, init: RequestInit = {}): Promise<{ data?: Resource | Resource[]; links?: { next?: string } } | null> {
    const response = await fetch(path.startsWith("http") ? path : `${api}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${appStoreToken(this.config.issuerId, this.config.keyId, this.config.privateKey)}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({})) as { data?: Resource | Resource[]; links?: { next?: string }; errors?: { detail?: string; title?: string; status?: string }[] };
    if (!response.ok) {
      const error = body.errors?.[0];
      throw Object.assign(new Error(error?.detail || error?.title || `App Store Connect answered ${response.status}`), { status: response.status });
    }
    return body;
  }

  /** Every page of a list. */
  async all(path: string): Promise<Resource[]> {
    const out: Resource[] = [];
    let next: string | undefined = path;
    for (let pages = 0; next && pages < 50; pages += 1) {
      const body = await this.request(next);
      const data = body?.data;
      out.push(...(Array.isArray(data) ? data : data ? [data] : []));
      next = body?.links?.next;
    }
    return out;
  }

  async create(type: string, attributes: Record<string, unknown>, relationships: Record<string, unknown>): Promise<Resource> {
    const body = await this.request(`/v1/${type}`, { method: "POST", body: JSON.stringify({ data: { type, ...(Object.keys(attributes).length ? { attributes } : {}), relationships } }) });
    return body?.data as Resource;
  }

  async link(path: string, data: { type: string; id: string }[]) {
    await this.request(path, { method: "POST", body: JSON.stringify({ data }) });
  }

  async remove(path: string) {
    await this.request(path, { method: "DELETE" });
  }
}

const text = (resource: Resource, key: string) => String(resource.attributes?.[key] ?? "");
const asInvitation = (i: Resource) => {
  const expires = Date.parse(text(i, "expirationDate"));
  return { id: i.id, email: text(i, "email"), expired: Number.isFinite(expires) && expires < Date.now() };
};
const asTester = (t: Resource) => ({ id: t.id, email: text(t, "email"), state: text(t, "state") || undefined });

/**
 * The Kimono accounts, with whether each may still sign in (null when the
 * directory can't say). Only people approved for an app have an email here,
 * plus anyone already invited (so no one is taken off for not asking);
 * [approved] says which apps each was approved for.
 */
async function kimonoAccounts(config: Config): Promise<{ list: PlanAccount[]; notAsked: Set<string>; approved: (username: string, bundleId: PhoneAppId) => boolean }> {
  const accounts = await listAccounts();
  const approved = (username: string, bundleId: PhoneAppId) => config.requests[username.toLowerCase()]?.[bundleId]?.state === "approved";
  const invited = new Set(Object.keys(config.invited).map((email) => email.toLowerCase()));
  const notAsked = new Set<string>();
  const list = await Promise.all(accounts.map(async (account) => {
    const standing = await readStanding(account.username).catch(() => null);
    const email = config.appleEmails[account.username.toLowerCase()] || account.email || null;
    const wanted = phoneApps.some((a) => approved(account.username, a.bundleId)) || Boolean(email && invited.has(email.toLowerCase()));
    if (email && !wanted) notAsked.add(account.username.toLowerCase());
    const asked = phoneApps.some((a) => approved(account.username, a.bundleId));
    return { username: account.username, name: account.name || account.username, email: wanted ? email : null, active: standing ? standing.active : null, wants: approved(account.username, mainApp), asked };
  }));
  return { list, notAsked, approved };
}

/** Gives someone limited to some apps sight of this one too: internal testers must see the app. */
async function letSee(store: AppStoreConnect, user: Resource | undefined, appId: string) {
  if (!user || user.attributes?.allAppsVisible !== false) return;
  await store.link(`/v1/users/${user.id}/relationships/visibleApps`, [{ type: "apps", id: appId }]);
}

/** Puts someone in a group, whether or not they're a tester somewhere already. */
async function addTester(store: AppStoreConnect, groupId: string, step: { email: string; firstName: string; lastName: string }) {
  try {
    await store.create("betaTesters", { email: step.email, firstName: step.firstName, lastName: step.lastName }, { betaGroups: { data: [{ type: "betaGroups", id: groupId }] } });
  } catch (error) {
    /* Already a tester elsewhere: put the existing tester in the group. */
    if ((error as { status?: number }).status !== 409) throw error;
    const found = await store.all(`/v1/betaTesters?filter[email]=${encodeURIComponent(step.email)}&limit=1`);
    if (!found[0]) throw error;
    await store.link(`/v1/betaGroups/${groupId}/relationships/betaTesters`, [{ type: "betaTesters", id: found[0].id }]);
  }
}

/** Kimono's phone apps as App Store Connect has them, and each one's internal group (made when missing). */
async function findApps(store: AppStoreConnect, config: Config) {
  const found = await Promise.all(phoneApps.map(async (phoneApp) => {
    const apps = await store.all(`/v1/apps?filter[bundleId]=${phoneApp.bundleId}&limit=200`);
    return { ...phoneApp, app: apps.find((a) => text(a, "bundleId") === phoneApp.bundleId) };
  }));
  const [main, ...others] = found;
  const app = main.app;
  if (!app) throw new Error(`There's no app with the bundle ID ${main.bundleId} in App Store Connect yet. Upload a first build, then sync.`);
  /* Kimono's other apps join as they reach App Store Connect; one that hasn't yet holds nothing up. */
  const present = others.filter((other): other is typeof other & { app: Resource } => Boolean(other.app));
  const notYet = others.filter((other) => !other.app).map((other) => other.name);
  const groupFor = async (appId: string) => {
    const groups = await store.all(`/v1/apps/${appId}/betaGroups?limit=200`);
    return groups.find((g) => text(g, "name") === config.groupName && g.attributes?.isInternalGroup === true)
      ?? await store.create("betaGroups", { name: config.groupName, isInternalGroup: true, hasAccessToAllBuilds: true }, { app: { data: { type: "apps", id: appId } } });
  };
  return { main, app, present, notYet, groupFor };
}

/** The apps someone may see on the team: only those they were approved for (Kimono's own always, as the team is for it). */
function appsFor(config: Config, username: string | undefined, found: { bundleId: PhoneAppId; app: Resource }[]): Resource[] {
  const mine = username ? config.requests[username.toLowerCase()] ?? {} : {};
  return found.filter((f) => f.bundleId === mainApp || mine[f.bundleId]?.state === "approved").map((f) => f.app);
}

/** Invites someone to the App Store Connect team, seeing only the Kimono apps they asked for; Apple emails them. */
async function inviteToTeam(store: AppStoreConnect, config: Config, step: { email: string; firstName: string; lastName: string }, apps: Resource[]) {
  const made = await store.create("userInvitations", {
    email: step.email, firstName: step.firstName, lastName: step.lastName,
    roles: [invitedRole], allAppsVisible: false, provisioningAllowed: false,
  }, { visibleApps: { data: apps.map((a) => ({ type: "apps", id: a.id })) } });
  config.invited[step.email] = { at: Date.now(), invitationId: made?.id };
}

/** How long before the same person can be sent another invite. */
const resendGap = 10 * 60 * 1000;

export type Resend = { username: string; outcome: "sent" | "too soon" | "nothing to send" | "error"; message?: string };

/**
 * Sends fresh invites: a new App Store Connect invite to someone whose
 * invite expired or went unanswered, or TestFlight's invite again to
 * someone in the group who never accepted it. Only for people who asked
 * (or were already invited) and still have Kimono access. [who] is
 * usernames, or "stuck" for everyone the last sync found stuck. Syncs
 * afterwards so the statuses show what changed.
 */
export async function resendTestflight(who: string[] | "stuck"): Promise<{ ok: boolean; message: string; results: Resend[] }> {
  const config = await readConfig();
  if (!config) return { ok: false, message: "No App Store Connect key yet.", results: [] };
  const usernames = who === "stuck"
    ? config.statuses.filter((row) => isStuck(row.status)).map((row) => row.username.toLowerCase())
    : who.map((name) => name.toLowerCase());
  if (!usernames.length) return { ok: true, message: "Nobody is stuck.", results: [] };
  const store = new AppStoreConnect(config);
  const results: Resend[] = [];
  try {
    const { app, present, groupFor } = await findApps(store, config);
    const { list: accounts } = await kimonoAccounts(config);
    const [invitations, users] = await Promise.all([store.all("/v1/userInvitations?limit=200"), store.all("/v1/users?limit=200")]);
    const groups = await Promise.all([app, ...present.map((other) => other.app)].map(async (a) => {
      const group = await groupFor(a.id);
      return { app: a, group, testers: await store.all(`/v1/betaGroups/${group.id}/betaTesters?limit=200`) };
    }));
    for (const username of usernames) {
      const account = accounts.find((a) => a.username.toLowerCase() === username);
      const email = account?.email?.trim().toLowerCase();
      if (!account || !email || account.active === false) { results.push({ username, outcome: "nothing to send", message: "No Kimono access, or no email" }); continue; }
      if (!account.asked) { results.push({ username: account.username, outcome: "nothing to send", message: "Hasn't asked for an app" }); continue; }
      const last = config.resent[email];
      if (last && Date.now() - last < resendGap) { results.push({ username: account.username, outcome: "too soon" }); continue; }
      try {
        const invitation = invitations.find((i) => text(i, "email").toLowerCase() === email);
        const onTeam = users.some((u) => text(u, "username").toLowerCase() === email);
        if (invitation || !onTeam) {
          /* Apple's team invite: a new one replaces the old, whose link may have expired. */
          if (invitation) await store.remove(`/v1/userInvitations/${invitation.id}`);
          await inviteToTeam(store, config, { email, ...nameParts(account.name, account.username) }, appsFor(config, account.username, [{ bundleId: mainApp, app }, ...present]));
        } else {
          /* On the team: TestFlight's own invite again, for each app whose group they're in. */
          let sent = 0;
          for (const { app: groupApp, testers } of groups) {
            const tester = testers.find((t) => text(t, "email").toLowerCase() === email);
            if (!tester) continue;
            await store.create("betaTesterInvitations", {}, { app: { data: { type: "apps", id: groupApp.id } }, betaTester: { data: { type: "betaTesters", id: tester.id } } });
            sent += 1;
          }
          /* Not in a group yet: the sync below adds them, and adding sends the invite. */
          if (!sent) { results.push({ username: account.username, outcome: "nothing to send", message: "Being added now" }); continue; }
        }
        config.resent[email] = Date.now();
        results.push({ username: account.username, outcome: "sent" });
      } catch (error) {
        results.push({ username: account.username, outcome: "error", message: error instanceof Error ? error.message : "didn't work" });
      }
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "App Store Connect couldn't be reached.", results };
  }
  /* Keep what was sent before the sync reads the file again. */
  await configTurn(async () => {
    const latest = await readConfig();
    if (latest && latest.keyId === config.keyId) await writeConfig({ ...latest, invited: { ...latest.invited, ...config.invited }, resent: config.resent });
  });
  await syncTestflight();
  const sent = results.filter((r) => r.outcome === "sent").length;
  const failed = results.filter((r) => r.outcome === "error").length;
  return {
    ok: failed === 0,
    message: [sent ? `Sent ${sent} new ${sent === 1 ? "invite" : "invites"}.` : "No invites sent.", ...(failed ? [`${failed} couldn't be sent.`] : [])].join(" "),
    results,
  };
}

/** Brings TestFlight in step with Kimono's accounts now, for every Kimono phone app in App Store Connect. */
type Synced = { ok: boolean; message: string; statuses: TesterStatus[] };
let syncing: Promise<Synced> | null = null;
let again: Promise<Synced> | null = null;

/*
 * One sync at a time: two at once would send the same invites twice and each
 * write back its own list of whom it invited. Asking during a sync runs one
 * more after it (it may have been asked because something changed), and
 * everyone asking meanwhile shares that one.
 */
export function syncTestflight(): Promise<Synced> {
  if (!syncing) {
    syncing = runSync().finally(() => { syncing = null; });
    return syncing;
  }
  again ??= syncing.catch(() => {}).then(() => { again = null; return syncTestflight(); });
  return again;
}

async function runSync(): Promise<Synced> {
  const config = await readConfig();
  if (!config) return { ok: false, message: "No App Store Connect key yet.", statuses: [] };
  const store = new AppStoreConnect(config);
  let statuses: TesterStatus[] = [];
  let outcome: { ok: boolean; message: string; apps?: string[] };
  try {
    const { main, app, present, notYet, groupFor } = await findApps(store, config);
    const broken: string[] = [];
    const group = await groupFor(app.id);
    const [users, invitations, testers, { list: accounts, notAsked, approved }] = await Promise.all([
      store.all("/v1/users?limit=200"),
      store.all("/v1/userInvitations?limit=200"),
      store.all(`/v1/betaGroups/${group.id}/betaTesters?limit=200`),
      kimonoAccounts(config),
    ]);
    const planUsers = users.map((u) => ({ id: u.id, email: text(u, "username"), roles: Array.isArray(u.attributes?.roles) ? u.attributes.roles as string[] : [] }));
    const userBy = (email: string) => users.find((u) => text(u, "username").toLowerCase() === email);
    const plan = planSync({
      accounts,
      users: planUsers,
      invitations: invitations.map(asInvitation),
      testers: testers.map(asTester),
      invited: config.invited,
    });
    /* People with an email who haven't asked show as such, not as missing an email. */
    statuses = plan.statuses.map((row) => row.status === "no email" && notAsked.has(row.username.toLowerCase()) ? { ...row, status: "not requested" } : row);
    const failed = (email: string, error: unknown, appName?: string) => {
      const message = `error: ${error instanceof Error ? error.message : "didn't work"}`;
      for (const row of statuses) {
        if (row.email?.toLowerCase() !== email) continue;
        if (appName) row.also = { ...row.also, [appName]: message };
        else row.status = message;
      }
    };
    for (const step of plan.steps) {
      try {
        switch (step.kind) {
          case "invite": {
            const who = accounts.find((a) => a.email?.trim().toLowerCase() === step.email);
            await inviteToTeam(store, config, step, appsFor(config, who?.username, [{ bundleId: mainApp, app }, ...present]));
            break;
          }
          case "add": {
            await addTester(store, group.id, step);
            const user = userBy(step.email);
            if (config.invited[step.email] && user) config.invited[step.email].userId = user.id;
            break;
          }
          case "removeInvitation":
            await store.remove(`/v1/userInvitations/${step.invitationId}`);
            delete config.invited[step.email];
            break;
          case "removeUser":
            await store.remove(`/v1/users/${step.userId}`);
            delete config.invited[step.email];
            break;
          case "forget":
            delete config.invited[step.email];
            break;
        }
      } catch (error) {
        failed(step.email, error);
      }
    }
    /* The same people in each other app's group. Someone the steps above just removed has left the team, so isn't there to add. */
    for (const other of present) {
      try {
        const otherGroup = await groupFor(other.app.id);
        const otherTesters = await store.all(`/v1/betaGroups/${otherGroup.id}/betaTesters?limit=200`);
        const removed = new Set(plan.steps.filter((step) => step.kind === "removeUser" || step.kind === "removeInvitation").map((step) => step.email));
        const also = planAlso({ accounts: accounts.map((a) => ({ ...a, wants: approved(a.username, other.bundleId) })), users: planUsers.filter((u) => !removed.has(u.email.toLowerCase())), testers: otherTesters.map(asTester) });
        for (const row of statuses) {
          const status = also.statuses.get(row.username.toLowerCase());
          if (status) row.also = { ...row.also, [other.name]: status };
        }
        for (const step of also.steps) {
          try {
            await letSee(store, userBy(step.email), other.app.id);
            await addTester(store, otherGroup.id, step);
          } catch (error) {
            failed(step.email, error, other.name);
          }
        }
      } catch (error) {
        broken.push(`${other.name}: ${error instanceof Error ? error.message : "didn't work"}`);
      }
    }
    const errors = statuses.filter((s) => s.status.startsWith("error") || Object.values(s.also ?? {}).some((v) => v.startsWith("error"))).length;
    const notes = [
      ...(notYet.length ? [`${notYet.join(" and ")} ${notYet.length === 1 ? "isn't" : "aren't"} in App Store Connect yet.`] : []),
      ...broken,
    ];
    outcome = {
      ok: errors === 0 && broken.length === 0,
      message: [errors ? `${errors} ${errors === 1 ? "person" : "people"} couldn't be updated.` : "In step.", ...notes].join(" "),
      apps: [main.name, ...present.map((other) => other.name)],
    };
  } catch (error) {
    outcome = { ok: false, message: error instanceof Error ? error.message : "App Store Connect couldn't be reached." };
    statuses = config.statuses;
  }
  const counts: Record<string, number> = {};
  for (const row of statuses) { const key = row.status.startsWith("error") ? "error" : row.status; counts[key] = (counts[key] ?? 0) + 1; }
  /* Read again before writing: the key, the requests or the emails may have changed meanwhile. */
  await configTurn(async () => {
    const latest = await readConfig();
    if (latest && latest.keyId === config.keyId) {
      const apps = outcome.apps ?? latest.lastSync?.apps;
      await writeConfig({ ...latest, invited: config.invited, lastSync: { at: Date.now(), ok: outcome.ok, message: outcome.message, counts, ...(apps ? { apps } : {}) }, statuses });
    }
  });
  return { ok: outcome.ok, message: outcome.message, statuses };
}

let checking: Promise<void> | null = null;

/** Syncs when it's been [every] (an hour unless said), at most one at a time. Never throws. */
export function syncTestflightIfDue(every = syncEvery): Promise<void> {
  /* Taken before anything is awaited, so two callers can't both decide it's due. */
  checking ??= (async () => {
    if (syncing) { await syncing.catch(() => {}); return; }
    const config = await readConfig().catch(() => null);
    if (!config || (config.lastSync && Date.now() - config.lastSync.at < every)) return;
    await syncTestflight().then(() => {}, (error) => console.warn("TestFlight sync failed:", error instanceof Error ? error.message : error));
  })().finally(() => { checking = null; });
  return checking;
}
