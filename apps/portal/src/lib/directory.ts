import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stateDir } from "./state";

/**
 * Who Kimono has seen sign in.
 *
 * Granting Kimono VPN needs a real account to point at, and the identity
 * provider already tells Kimono who someone is at sign-in. Recording that is
 * enough to offer a proper picker, and it costs no API token and no extra
 * permission on the identity provider — which is the whole point of an
 * appliance that should not hold more privilege than it needs.
 */
export type Account = {
  username: string;
  name: string;
  email: string;
  lastSeen: string;
};

/** The Authentik group that carries Kimono VPN access. */
export const meshGroup = "kimono-vpn";
/** The user attribute holding who that person has invited into their mesh. */
export const meshGuestsAttribute = "kimono_vpn_guests";

export type MeshMember = {
  username: string;
  displayName: string;
  guests: string[];
};

const directoryPath = join(stateDir, "directory.json");

export async function listAccounts(): Promise<Account[]> {
  try {
    const parsed = JSON.parse(await readFile(directoryPath, "utf8")) as { accounts?: unknown };
    if (!parsed.accounts || typeof parsed.accounts !== "object") return [];
    return Object.values(parsed.accounts as Record<string, Account>)
      .filter((account) => account && typeof account.username === "string" && account.username)
      .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username));
  } catch {
    return [];
  }
}

type IdentityUser = {
  pk?: number;
  username?: string;
  name?: string;
  email?: string;
  is_active?: boolean;
  type?: string;
  groups?: string[];
  groups_obj?: Array<{ name?: string }>;
  attributes?: Record<string, unknown>;
};

function identityEndpoint() {
  return (process.env.KIMONO_IDENTITY_API_URL || "http://authentik-server:9000").replace(/\/+$/, "");
}

async function identityRequest(path: string, init?: RequestInit) {
  const token = process.env.KIMONO_IDENTITY_API_TOKEN;
  if (!token) throw new Error("Kimono cannot reach the account directory yet.");
  const response = await fetch(`${identityEndpoint()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? `The identity provider refused Kimono's directory token (${response.status}). Run \`sudo kimono server repair\`.`
      : `The identity provider replied ${response.status} to ${path}.`);
  }
  return response;
}

function guestsOf(user: IdentityUser): string[] {
  const raw = user.attributes?.[meshGuestsAttribute];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((item): item is string => typeof item === "string" && item !== user.username))];
}

async function fetchPeople(): Promise<IdentityUser[]> {
  const response = await identityRequest("/api/v3/core/users/?page_size=500&include_groups=true");
  const payload = await response.json() as { results?: IdentityUser[] };
  return (payload.results || []).filter((user) =>
    Boolean(user.username) && user.is_active !== false && user.type !== "service_account" && user.type !== "internal_service_account");
}

/**
 * Kimono VPN membership lives in the identity provider, not in Kimono's own
 * settings: it is an entitlement on an account, and duplicating it here would
 * let the two drift. Access is the `kimono-vpn` group; the people a member has
 * invited are an attribute on that member.
 */
export async function readMeshMembers(): Promise<Record<string, MeshMember>> {
  const members: Record<string, MeshMember> = {};
  const people = await fetchPeople();
  const granted = people.filter((user) => (user.groups_obj || []).some((group) => group.name === meshGroup));
  for (const user of granted) {
    const username = (user.username as string).toLowerCase();
    members[username] = {
      username,
      displayName: user.name?.trim() || username,
      guests: guestsOf(user),
    };
  }
  /* An invitation to somebody without access cannot become a policy rule. */
  for (const member of Object.values(members)) {
    member.guests = member.guests.filter((guest) => members[guest]);
  }
  return members;
}

async function findUser(username: string): Promise<IdentityUser> {
  const response = await identityRequest(`/api/v3/core/users/?username=${encodeURIComponent(username)}&include_groups=true`);
  const payload = await response.json() as { results?: IdentityUser[] };
  const user = (payload.results || []).find((item) => item.username?.toLowerCase() === username.toLowerCase());
  if (!user?.pk) throw new Error(`${username} is not an account on this Kimono`);
  return user;
}

async function meshGroupId(): Promise<string> {
  const response = await identityRequest(`/api/v3/core/groups/?name=${encodeURIComponent(meshGroup)}`);
  const payload = await response.json() as { results?: Array<{ pk?: string; name?: string }> };
  const group = (payload.results || []).find((item) => item.name === meshGroup);
  if (!group?.pk) throw new Error("The Kimono VPN group is missing. Run `sudo kimono server repair`.");
  return group.pk;
}

export async function setMeshAccess(username: string, granted: boolean) {
  const user = await findUser(username);
  const group = await meshGroupId();
  // Written from the user rather than through the group's add_user endpoint:
  // Authentik checks change_group against the group object, so a global grant
  // never satisfies it, while change_user is checked globally.
  const current = user.groups || [];
  const groups = granted
    ? [...new Set([...current, group])]
    : current.filter((item) => item !== group);
  await identityRequest(`/api/v3/core/users/${user.pk}/`, {
    method: "PATCH",
    body: JSON.stringify({ groups }),
  });
  if (!granted) {
    /* Somebody who has lost access must also stop reaching everyone else. */
    for (const other of await fetchPeople()) {
      const guests = guestsOf(other);
      if (!guests.includes(username.toLowerCase())) continue;
      await writeGuests(other, guests.filter((guest) => guest !== username.toLowerCase()));
    }
  }
}

async function writeGuests(user: IdentityUser, guests: string[]) {
  await identityRequest(`/api/v3/core/users/${user.pk}/`, {
    method: "PATCH",
    body: JSON.stringify({ attributes: { ...(user.attributes || {}), [meshGuestsAttribute]: guests } }),
  });
}

export async function setMeshGuests(username: string, guests: string[]) {
  const user = await findUser(username);
  await writeGuests(user, [...new Set(guests.map((guest) => guest.toLowerCase()))]);
}

/**
 * Pulls the account list from the identity provider so the picker is complete
 * the moment Kimono is installed, rather than filling in as people sign in.
 * Sign-in recording stays as a fallback for when this is unavailable.
 */
export async function syncAccountsFromIdentity(): Promise<{ synced: number } | { error: string }> {
  const token = process.env.KIMONO_IDENTITY_API_TOKEN;
  const base = (process.env.KIMONO_IDENTITY_API_URL || "http://authentik-server:9000").replace(/\/+$/, "");
  if (!token) return { error: "Kimono cannot read the account directory yet." };
  try {
    const response = await fetch(`${base}/api/v3/core/users/?page_size=500`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (response.status === 401 || response.status === 403) {
      return { error: `The identity provider refused Kimono's directory token (${response.status}). Run \`sudo kimono server repair\`.` };
    }
    if (!response.ok) return { error: `The identity provider replied ${response.status} when listing accounts.` };
    const payload = await response.json() as { results?: IdentityUser[] };
    const people = (payload.results || []).filter((user) =>
      Boolean(user.username) && user.is_active !== false && user.type !== "service_account" && user.type !== "internal_service_account");
    for (const person of people) {
      await recordAccount({ username: person.username as string, name: person.name, email: person.email });
    }
    return { synced: people.length };
  } catch {
    return { error: "The identity provider did not answer." };
  }
}

export async function recordAccount(input: { username: string; name?: string | null; email?: string | null }) {
  const username = input.username?.trim().toLowerCase();
  if (!username) return;
  const accounts = Object.fromEntries((await listAccounts()).map((account) => [account.username, account]));
  const existing = accounts[username];
  const name = input.name?.trim() || existing?.name || username;
  const email = input.email?.trim().toLowerCase() || existing?.email || "";
  /* A write per page load would be wasteful; only a real change is persisted. */
  if (existing && existing.name === name && existing.email === email) return;
  accounts[username] = { username, name, email, lastSeen: new Date().toISOString() };
  await mkdir(dirname(directoryPath), { recursive: true, mode: 0o700 });
  const temporary = `${directoryPath}.new`;
  await writeFile(temporary, `${JSON.stringify({ accounts }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, directoryPath);
}

/* ═══════════════════════════════════════════════════════════════
   One person's own account: what they see on /account and through
   /api/v1/me. Every call names the signed-in person; nothing here
   lets one account read or change another.
   ═══════════════════════════════════════════════════════════════ */

/** The attribute the identity provider can be told to read pictures from. */
export const avatarAttribute = "avatar";

export type IdentityProfile = { username: string; name: string; email: string };

/** Whether another active account already uses this email. Compared case-insensitively. */
export async function emailUsedByOther(email: string, username: string): Promise<boolean> {
  const wanted = email.trim().toLowerCase();
  return (await fetchPeople()).some((user) =>
    user.username?.toLowerCase() !== username.toLowerCase() && user.email?.trim().toLowerCase() === wanted);
}

export async function readIdentityProfile(username: string): Promise<IdentityProfile> {
  const user = await findUser(username);
  return { username: (user.username as string).toLowerCase(), name: user.name?.trim() || "", email: user.email?.trim() || "" };
}

export async function updateIdentityProfile(username: string, change: { name?: string; email?: string; avatar?: string | null }) {
  const user = await findUser(username);
  const body: Record<string, unknown> = {};
  if (change.name !== undefined) body.name = change.name;
  if (change.email !== undefined) body.email = change.email;
  if (change.avatar !== undefined) {
    const attributes = { ...(user.attributes || {}) };
    if (change.avatar) attributes[avatarAttribute] = change.avatar;
    else delete attributes[avatarAttribute];
    body.attributes = attributes;
  }
  await identityRequest(`/api/v3/core/users/${user.pk}/`, { method: "PATCH", body: JSON.stringify(body) });
  await recordAccount({ username, name: change.name, email: change.email });
}

type IdentitySession = {
  uuid?: string;
  user?: number;
  last_ip?: string;
  last_used?: string;
  expires?: string | null;
  user_agent?: {
    device?: { family?: string; brand?: string | null; model?: string | null };
    os?: { family?: string };
    user_agent?: { family?: string };
  };
  geo_ip?: { city?: string | null; country?: string | null } | null;
};

export type IdentitySessionSummary = {
  id: string;
  browser: string;
  os: string;
  device: string;
  ip: string;
  lastUsed: string | null;
  place: string | null;
};

async function sessionsOf(username: string): Promise<IdentitySession[]> {
  const user = await findUser(username);
  const response = await identityRequest(`/api/v3/core/authenticated_sessions/?user__username=${encodeURIComponent(user.username as string)}&page_size=100`);
  const payload = await response.json() as { results?: IdentitySession[] };
  /* Checked again here, so a filter the provider ignores can never leak someone else's sessions. */
  return (payload.results || []).filter((session) => session.user === user.pk && typeof session.uuid === "string");
}

const known = (value: string | null | undefined) => value && value !== "Other" ? value : "";

export async function listIdentitySessions(username: string): Promise<IdentitySessionSummary[]> {
  return (await sessionsOf(username))
    .map((session) => ({
      id: session.uuid as string,
      browser: known(session.user_agent?.user_agent?.family) || "A browser",
      os: known(session.user_agent?.os?.family),
      device: [known(session.user_agent?.device?.brand), known(session.user_agent?.device?.model)].filter(Boolean).join(" ") || known(session.user_agent?.device?.family),
      ip: session.last_ip || "",
      lastUsed: session.last_used || null,
      place: [session.geo_ip?.city, session.geo_ip?.country].filter(Boolean).join(", ") || null,
    }))
    .sort((a, b) => (b.lastUsed || "").localeCompare(a.lastUsed || ""));
}

/** Ends one of this person's sign-ins. Returns false when it was not theirs. */
export async function endIdentitySession(username: string, id: string): Promise<boolean> {
  const session = (await sessionsOf(username)).find((item) => item.uuid === id);
  if (!session) return false;
  await identityRequest(`/api/v3/core/authenticated_sessions/${encodeURIComponent(id)}/`, { method: "DELETE" });
  return true;
}

/**
 * Ends the identity provider's sign-in in the browser that is signing out of
 * Kimono. The provider doesn't tell Kimono which of its sessions a browser
 * holds, so it is found by the browser's exact user agent, narrowed to its
 * address when that also matches.
 */
export async function endIdentitySessionsOfBrowser(username: string, browser: { userAgent: string; ip: string | null }): Promise<number> {
  if (!browser.userAgent) return 0;
  const sameAgent = (await sessionsOf(username)).filter((session) => (session as { last_user_agent?: string }).last_user_agent === browser.userAgent);
  const sameAddress = browser.ip ? sameAgent.filter((session) => session.last_ip === browser.ip) : [];
  const ending = sameAddress.length ? sameAddress : sameAgent;
  for (const session of ending) {
    await identityRequest(`/api/v3/core/authenticated_sessions/${encodeURIComponent(session.uuid as string)}/`, { method: "DELETE" });
  }
  return ending.length;
}

export async function endAllIdentitySessions(username: string): Promise<number> {
  const sessions = await sessionsOf(username);
  for (const session of sessions) {
    await identityRequest(`/api/v3/core/authenticated_sessions/${encodeURIComponent(session.uuid as string)}/`, { method: "DELETE" });
  }
  return sessions.length;
}

/* ─── passwords ───
   Kimono never stores or compares passwords. It asks the identity provider:
   the current password is checked by walking the provider's own sign-in flow
   as that person would, and the new one is set through its API. */

const checkAgent = "Kimono password check";

/** True when the identity provider accepts this password for this account. */
export async function verifyIdentityPassword(username: string, password: string): Promise<boolean> {
  const url = `${identityEndpoint()}/api/v3/flows/executor/default-authentication-flow/?query=`;
  const jar = new Map<string, string>();
  type Step = { component?: string; password_fields?: boolean; finished?: boolean };
  async function step(method: "GET" | "POST", body?: unknown): Promise<Step> {
    const csrf = jar.get("authentik_csrf");
    const response = await fetch(url, {
      method,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": checkAgent,
        Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
        ...(csrf ? { "X-authentik-CSRF": csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";")[0];
      const split = pair.indexOf("=");
      if (split > 0) jar.set(pair.slice(0, split), pair.slice(split + 1));
    }
    /* The executor answers a submitted stage by redirecting to itself. */
    if (method === "POST" && response.status >= 300 && response.status < 400) return step("GET");
    /* The flow handing the browser onward means every stage was satisfied. */
    if (response.status >= 300 && response.status < 400) return { finished: true };
    if (!response.ok) throw new Error(`The identity provider replied ${response.status} while checking a password.`);
    return await response.json() as Step;
  }
  const first = await step("GET");
  if (first.component !== "ak-stage-identification") throw new Error(`The identity provider's sign-in flow starts with ${first.component ?? "nothing"}, not identification.`);
  let next = await step("POST", { component: "ak-stage-identification", uid_field: username, ...(first.password_fields ? { password } : {}) });
  if (!first.password_fields) {
    if (next.component !== "ak-stage-password") throw new Error(`The identity provider's sign-in flow asks for ${next.component ?? "nothing"} before a password.`);
    next = await step("POST", { component: "ak-stage-password", password });
  }
  /* Only an explicit success counts. Being asked for the password (or the
     identity) again means it was wrong; any other screen — a denial, a
     captcha, an error — is not a verdict on the password, so it is an error,
     never a pass. A second factor after the password means the password held. */
  if (next.component === "ak-stage-password" || next.component === "ak-stage-identification") return false;
  if (next.finished || next.component === "xak-flow-redirect" || next.component === "ak-stage-authenticator-validate") {
    await endChecksFor(username);
    return true;
  }
  throw new Error(`The identity provider's sign-in flow answered a password with ${next.component ?? "nothing"}.`);
}

/** A check that ran to the end of the flow signs in; that sign-in is ended at once. */
async function endChecksFor(username: string) {
  try {
    for (const session of await sessionsOf(username)) {
      if ((session as { last_user_agent?: string }).last_user_agent === checkAgent) {
        await identityRequest(`/api/v3/core/authenticated_sessions/${encodeURIComponent(session.uuid as string)}/`, { method: "DELETE" });
      }
    }
  } catch {
    /* Best effort: such a session holds no browser and expires on its own. */
  }
}

export async function setIdentityPassword(username: string, password: string) {
  const user = await findUser(username);
  await identityRequest(`/api/v3/core/users/${user.pk}/set_password/`, { method: "POST", body: JSON.stringify({ password }) });
}

/* ─── standing ───
   Whether an account is still active and which groups it holds, read live so
   a deactivation or a change of role reaches a signed-in Portal session within
   a minute instead of when its cookie expires. */

export type Standing = { active: boolean; groups: string[] };
const standingTtl = 60 * 1000;
const standings = new Map<string, { at: number; value: Standing }>();

/** The account's live standing, or null when the directory can't be asked. */
export async function readStanding(username: string): Promise<Standing | null> {
  const key = username.toLowerCase();
  const hit = standings.get(key);
  if (hit && Date.now() - hit.at < standingTtl) return hit.value;
  let value: Standing;
  try {
    const response = await identityRequest(`/api/v3/core/users/?username=${encodeURIComponent(username)}&include_groups=true`);
    const payload = await response.json() as { results?: IdentityUser[] };
    const user = (payload.results || []).find((item) => item.username?.toLowerCase() === key);
    value = user
      ? { active: user.is_active !== false, groups: (user.groups_obj || []).map((group) => group.name || "").filter(Boolean) }
      : { active: false, groups: [] };
  } catch {
    return null;
  }
  standings.set(key, { at: Date.now(), value });
  return value;
}

/** Whether an account carries Kimono VPN, without pulling the whole mesh. */
export async function holdsMeshAccess(username: string): Promise<boolean> {
  try {
    const user = await findUser(username);
    return (user.groups_obj || []).some((group) => group.name === meshGroup);
  } catch {
    return false;
  }
}
