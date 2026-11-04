import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listAccounts, readStanding } from "./directory";
import { stateDir } from "./state";
import { invitedRole, planSync, type Invited, type PlanAccount, type TesterStatus } from "./testflight-plan";
import { appStoreToken } from "./testflight-token";

/*
 * TestFlight for the Kimono iPhone app, kept in step with Kimono's accounts:
 * everyone with one is an internal tester, through App Store Connect's API
 * and a key the admin gives the Portal. The rules are in testflight-plan.ts;
 * this reads App Store Connect, carries the plan out, and remembers whom it
 * invited, so it only ever takes those people off again.
 */

const configPath = join(stateDir, "testflight.json");
const bundleId = "app.kimono.compose";
const api = "https://api.appstoreconnect.apple.com";
const syncEvery = 60 * 60 * 1000;

export type LastSync = { at: number; ok: boolean; message: string; counts: Record<string, number> };
/** Who asked to try the iPhone app, by Kimono username: only they are invited. */
type Requested = Record<string, number>;
type Config = { issuerId: string; keyId: string; privateKey: string; groupName: string; invited: Invited; requested: Requested; lastSync: LastSync | null; statuses: TesterStatus[] };

async function readConfig(): Promise<Config | null> {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as Partial<Config>;
    if (!parsed.issuerId || !parsed.keyId || !parsed.privateKey) return null;
    return {
      issuerId: parsed.issuerId, keyId: parsed.keyId, privateKey: parsed.privateKey,
      groupName: parsed.groupName || "Kimono",
      invited: parsed.invited && typeof parsed.invited === "object" ? parsed.invited : {},
      requested: parsed.requested && typeof parsed.requested === "object" ? parsed.requested : {},
      lastSync: parsed.lastSync ?? null,
      statuses: Array.isArray(parsed.statuses) ? parsed.statuses : [],
    };
  } catch {
    return null;
  }
}

async function writeConfig(config: Config) {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.${randomUUID()}.new`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, configPath);
}

/** What the admin page shows: never the key itself. */
export async function testflightSettings(): Promise<{ keyId: string; issuerId: string; groupName: string; lastSync: LastSync | null; statuses: TesterStatus[] } | null> {
  const config = await readConfig();
  return config ? { keyId: config.keyId, issuerId: config.issuerId, groupName: config.groupName, lastSync: config.lastSync, statuses: config.statuses } : null;
}

/* Whom the Portal invited, and who asked, kept even without a key. */
async function readKept(): Promise<{ invited: Invited; requested: Requested }> {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as { invited?: Invited; requested?: Requested };
    return {
      invited: parsed.invited && typeof parsed.invited === "object" ? parsed.invited : {},
      requested: parsed.requested && typeof parsed.requested === "object" ? parsed.requested : {},
    };
  } catch {
    return { invited: {}, requested: {} };
  }
}

/** Notes that someone asked to try the iPhone app; true when they hadn't before. */
export async function requestTestflight(username: string): Promise<boolean> {
  const config = await readConfig();
  if (!config) throw new Error("The iPhone app isn't set up on this Kimono yet.");
  const key = username.toLowerCase();
  if (config.requested[key]) return false;
  await writeConfig({ ...config, requested: { ...config.requested, [key]: Date.now() } });
  return true;
}

export async function saveTestflightKey(input: { issuerId: string; keyId: string; privateKey: string; groupName: string }) {
  await writeConfig({
    issuerId: input.issuerId, keyId: input.keyId, privateKey: input.privateKey, groupName: input.groupName || "Kimono",
    ...(await readKept()), lastSync: null, statuses: [],
  });
}

/** Forgets the key. Whom the Portal invited is kept, so a key given again can still tidy up after them. */
export async function forgetTestflightKey() {
  const existing = await readConfig();
  if (!existing) return;
  if (!Object.keys(existing.invited).length) { await rm(configPath, { force: true }); return; }
  await writeFile(configPath, `${JSON.stringify({ invited: existing.invited }, null, 2)}\n`, { mode: 0o600 });
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
    const body = await this.request(`/v1/${type}`, { method: "POST", body: JSON.stringify({ data: { type, attributes, relationships } }) });
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

/** The Kimono accounts, with whether each may still sign in (null when the directory can't say). */
async function kimonoAccounts(config: Config): Promise<{ list: PlanAccount[]; notAsked: Set<string> }> {
  const accounts = await listAccounts();
  /* Only people who asked, plus anyone already invited (so no one is taken off for not asking). */
  const invited = new Set(Object.keys(config.invited).map((email) => email.toLowerCase()));
  const notAsked = new Set<string>();
  const list = await Promise.all(accounts.map(async (account) => {
    const standing = await readStanding(account.username).catch(() => null);
    const email = account.email || null;
    const wanted = Boolean(config.requested[account.username.toLowerCase()] || (email && invited.has(email.toLowerCase())));
    if (email && !wanted) notAsked.add(account.username.toLowerCase());
    return { username: account.username, name: account.name || account.username, email: wanted ? email : null, active: standing ? standing.active : null };
  }));
  return { list, notAsked };
}

/** Brings TestFlight in step with Kimono's accounts now. */
export async function syncTestflight(): Promise<{ ok: boolean; message: string; statuses: TesterStatus[] }> {
  const config = await readConfig();
  if (!config) return { ok: false, message: "No App Store Connect key yet.", statuses: [] };
  const store = new AppStoreConnect(config);
  let statuses: TesterStatus[] = [];
  let outcome: { ok: boolean; message: string };
  try {
    const apps = await store.all(`/v1/apps?filter[bundleId]=${bundleId}&limit=1`);
    const app = apps[0];
    if (!app) throw new Error(`There's no app with the bundle ID ${bundleId} in App Store Connect yet. Upload a first build, then sync.`);
    const groups = await store.all(`/v1/apps/${app.id}/betaGroups?limit=200`);
    let group = groups.find((g) => text(g, "name") === config.groupName && g.attributes?.isInternalGroup === true);
    if (!group) {
      group = await store.create("betaGroups", { name: config.groupName, isInternalGroup: true, hasAccessToAllBuilds: true }, { app: { data: { type: "apps", id: app.id } } });
    }
    const [users, invitations, testers, { list: accounts, notAsked }] = await Promise.all([
      store.all("/v1/users?limit=200"),
      store.all("/v1/userInvitations?limit=200"),
      store.all(`/v1/betaGroups/${group.id}/betaTesters?limit=200`),
      kimonoAccounts(config),
    ]);
    const plan = planSync({
      accounts,
      users: users.map((u) => ({ id: u.id, email: text(u, "username"), roles: Array.isArray(u.attributes?.roles) ? u.attributes.roles as string[] : [] })),
      invitations: invitations.map((i) => ({ id: i.id, email: text(i, "email") })),
      testers: testers.map((t) => ({ id: t.id, email: text(t, "email") })),
      invited: config.invited,
    });
    /* People with an email who haven't asked show as such, not as missing an email. */
    statuses = plan.statuses.map((row) => row.status === "no email" && notAsked.has(row.username.toLowerCase()) ? { ...row, status: "not requested" } : row);
    const failed = (email: string, error: unknown) => {
      for (const row of statuses) if (row.email?.toLowerCase() === email) row.status = `error: ${error instanceof Error ? error.message : "didn't work"}`;
    };
    for (const step of plan.steps) {
      try {
        switch (step.kind) {
          case "invite": {
            const made = await store.create("userInvitations", {
              email: step.email, firstName: step.firstName, lastName: step.lastName,
              roles: [invitedRole], allAppsVisible: false, provisioningAllowed: false,
            }, { visibleApps: { data: [{ type: "apps", id: app.id }] } });
            config.invited[step.email] = { at: Date.now(), invitationId: made?.id };
            break;
          }
          case "add": {
            try {
              await store.create("betaTesters", { email: step.email, firstName: step.firstName, lastName: step.lastName }, { betaGroups: { data: [{ type: "betaGroups", id: group.id }] } });
            } catch (error) {
              /* Already a tester elsewhere: put the existing tester in the group. */
              if ((error as { status?: number }).status !== 409) throw error;
              const found = await store.all(`/v1/betaTesters?filter[email]=${encodeURIComponent(step.email)}&limit=1`);
              if (!found[0]) throw error;
              await store.link(`/v1/betaGroups/${group.id}/relationships/betaTesters`, [{ type: "betaTesters", id: found[0].id }]);
            }
            const user = users.find((u) => text(u, "username").toLowerCase() === step.email);
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
    const errors = statuses.filter((s) => s.status.startsWith("error")).length;
    outcome = { ok: errors === 0, message: errors ? `${errors} ${errors === 1 ? "person" : "people"} couldn't be updated.` : "In step." };
  } catch (error) {
    outcome = { ok: false, message: error instanceof Error ? error.message : "App Store Connect couldn't be reached." };
    statuses = config.statuses;
  }
  const counts: Record<string, number> = {};
  for (const row of statuses) { const key = row.status.startsWith("error") ? "error" : row.status; counts[key] = (counts[key] ?? 0) + 1; }
  /* Read again before writing: the key may have been changed meanwhile. */
  const latest = await readConfig();
  if (latest && latest.keyId === config.keyId) {
    await writeConfig({ ...latest, invited: config.invited, lastSync: { at: Date.now(), ...outcome, counts }, statuses });
  }
  return { ...outcome, statuses };
}

let running: Promise<unknown> | null = null;

/** Syncs when it's been [every] (an hour unless said), at most one at a time. Never throws. */
export async function syncTestflightIfDue(every = syncEvery): Promise<void> {
  if (running) { await running; return; }
  const config = await readConfig().catch(() => null);
  if (!config || (config.lastSync && Date.now() - config.lastSync.at < every)) return;
  running = syncTestflight().catch((error) => console.warn("TestFlight sync failed:", error instanceof Error ? error.message : error)).finally(() => { running = null; });
  await running;
}
