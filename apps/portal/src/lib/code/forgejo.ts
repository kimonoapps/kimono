import "server-only";

import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CodeProblem, type Workspace } from "./model";
import type { CodeConfig } from "./config";
import { gitAdminToken, gitToken, managedGitUser } from "./git-token";

/*
 * Kimono Git, with Kimono AI's token. Projects are each person's own: Kimono AI is
 * Kimono Git's administrator, so it acts as the person (Forgejo's Sudo) to list and make
 * their repositories, and its pull requests are theirs too. Their account there is the
 * one they sign in to Kimono Git with (same username); one who never has gets it made.
 */

export type Repository = { owner: string; name: string; description: string; defaultBranch: string; updatedAt: number; private: boolean };

/** A Kimono Git API call with Code's token; a minted token Forgejo no longer knows is replaced once. */
async function send(config: CodeConfig, path: string, init: { method?: string; body?: string; timeout: number; as?: string }): Promise<Response> {
  for (const stale of [false, true]) {
    const token = await gitToken(config, stale);
    let response: Response;
    try {
      response = await fetch(`${config.gitAddress}/api/v1${path}`, {
        method: init.method,
        headers: { Authorization: `token ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.as ? { Sudo: init.as } : {}) },
        body: init.body,
        signal: AbortSignal.timeout(init.timeout),
        cache: "no-store",
      });
    } catch {
      throw new CodeProblem("Kimono Git isn't answering.", 502);
    }
    if (response.status !== 401 || stale || config.gitToken) return response;
  }
  throw new CodeProblem("Kimono Git refused Code's token.", 502);
}

async function get<T>(config: CodeConfig, path: string, as?: string): Promise<T> {
  const response = await send(config, path, { timeout: 15_000, as });
  if (response.status === 401 || response.status === 403) throw new CodeProblem("Kimono Git refused Code's token.", 502);
  if (response.status === 404) throw new CodeProblem("That repository isn't in Kimono Git.", 404);
  if (!response.ok) throw new CodeProblem("Kimono Git couldn't answer that.", 502);
  return (await response.json()) as T;
}

type ForgejoRepo = { name: string; owner: { login: string }; description: string; default_branch: string; updated_at: string; private: boolean; archived: boolean };

/** Someone in Kimono, as Kimono Git knows them. */
export type GitPerson = { username: string; name?: string | null; email?: string | null };

const known = new Map<string, string>();

/** The person's Kimono Git login, making their account when they have none (and [make] allows). */
export async function gitAccountOf(config: CodeConfig, person: GitPerson, make = true): Promise<string | null> {
  const username = person.username.toLowerCase();
  const seen = known.get(username);
  if (seen) return seen;
  const found = await send(config, `/users/${encodeURIComponent(username)}`, { timeout: 15_000 });
  if (found.ok) {
    const login = ((await found.json()) as { login: string }).login;
    known.set(username, login);
    return login;
  }
  if (found.status !== 404) throw new CodeProblem("Kimono Git couldn't answer that.", 502);
  /* Signed in under another username (one Kimono Git had already, say): the account with their email is theirs. */
  const byEmail = await accountByEmail(config, person.email);
  if (byEmail) {
    known.set(username, byEmail);
    return byEmail;
  }
  if (!make) return null;
  if (!/^[a-z0-9][a-z0-9._-]{0,38}$/.test(username) || !person.email) throw new CodeProblem("Sign in to Kimono Git once, then try again.", 409);
  /* Their account, made the way signing in would; signing in later takes it over (same username and email). */
  for (const stale of [false, true]) {
    const admin = await gitAdminToken(config, stale);
    if (!admin) throw new CodeProblem("Sign in to Kimono Git once, then try again.", 409);
    let made: Response;
    try {
      made = await fetch(`${config.gitAddress}/api/v1/admin/users`, {
        method: "POST",
        headers: { Authorization: `token ${admin}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ username, email: person.email, full_name: person.name ?? "", password: randomBytes(24).toString("base64url"), must_change_password: false, send_notify: false }),
        signal: AbortSignal.timeout(15_000), cache: "no-store",
      });
    } catch {
      throw new CodeProblem("Kimono Git isn't answering.", 502);
    }
    if (made.status === 401 && !stale) continue;
    if (!made.ok) {
      const taken = await accountByEmail(config, person.email);
      if (taken) { known.set(username, taken); return taken; }
      console.error(`Kimono AI couldn't make ${username}'s Kimono Git account: ${made.status} ${(await made.text()).slice(0, 200)}`);
      throw new CodeProblem("Sign in to Kimono Git once, then try again.", 409);
    }
    known.set(username, username);
    return username;
  }
  throw new CodeProblem("Kimono Git refused Code's token.", 502);
}

/** The Kimono Git login whose email is [email], if there is one. Kimono AI, an administrator, sees everyone's. */
async function accountByEmail(config: CodeConfig, email: string | null | undefined): Promise<string | null> {
  const wanted = email?.trim().toLowerCase();
  if (!wanted) return null;
  const response = await send(config, `/users/search?q=${encodeURIComponent(wanted)}&limit=10`, { timeout: 15_000 });
  if (!response.ok) return null;
  const { data } = (await response.json()) as { data?: { login: string; email?: string }[] };
  return data?.find((user) => user.email?.toLowerCase() === wanted)?.login ?? null;
}

/** The person's own repositories, and the ones shared with them or their teams. */
export async function repositories(config: CodeConfig, person: GitPerson): Promise<Repository[]> {
  const login = await gitAccountOf(config, person);
  const list: ForgejoRepo[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await get<ForgejoRepo[]>(config, `/user/repos?limit=50&page=${page}`, login ?? undefined);
    list.push(...batch);
    if (batch.length < 50) break;
  }
  return list.filter((repo) => !repo.archived).map((repo) => ({
    owner: repo.owner.login, name: repo.name, description: repo.description || "",
    defaultBranch: repo.default_branch || "main", updatedAt: Date.parse(repo.updated_at) || 0, private: repo.private,
  })).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function branches(config: CodeConfig, owner: string, name: string): Promise<string[]> {
  const list = await get<{ name: string }[]>(config, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches?limit=100`);
  return list.map((branch) => branch.name).filter((branch) => !branch.startsWith("code/"));
}

/** A Kimono Git-safe name from what someone typed: "Family Recipes!" → "family-recipes". */
export function repositoryName(input: string) {
  return input.normalize("NFKD").toLowerCase().replace(/[^a-z0-9._\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 60);
}

/** Makes a new, private repository in the person's account, with a first commit, so there's a branch to start from. */
export async function createRepository(config: CodeConfig, person: GitPerson, title: string): Promise<Repository> {
  const name = repositoryName(title);
  if (!name) throw new CodeProblem("Give the project a name.");
  const login = await gitAccountOf(config, person);
  const response = await send(config, "/user/repos", {
    method: "POST",
    as: login ?? undefined,
    body: JSON.stringify({ name, description: title.trim().slice(0, 200), private: true, auto_init: true, default_branch: "main", readme: "Default" }),
    timeout: 20_000,
  });
  if (response.status === 409) throw new CodeProblem("There's already a project with that name.", 409);
  if (response.status === 401 || response.status === 403) throw new CodeProblem("Kimono Git refused Code's token.", 502);
  if (!response.ok) throw new CodeProblem("Kimono Git couldn't make that project.", 502);
  const repo = (await response.json()) as ForgejoRepo;
  return { owner: repo.owner.login, name: repo.name, description: repo.description || "", defaultBranch: repo.default_branch || "main", updatedAt: Date.now(), private: repo.private };
}

/**
 * Projects Kimono AI started before they were people's own sat in its account: the chat's
 * repository moves to the person whose chat it is, and every chat on it follows. Kimono Git
 * keeps the old address working too. Returns the chat as it now is.
 */
export async function ownProject(db: DatabaseSync, config: CodeConfig, workspace: Workspace, owner: GitPerson): Promise<Workspace> {
  if (workspace.kind !== "project" || workspace.repo.owner.toLowerCase() !== managedGitUser) return workspace;
  const login = await gitAccountOf(config, owner, Boolean(owner.email)).catch(() => null);
  if (!login) return workspace;
  const { name } = workspace.repo;
  const moved = await send(config, `/repos/${managedGitUser}/${encodeURIComponent(name)}/transfer`, { method: "POST", body: JSON.stringify({ new_owner: login }), timeout: 20_000 });
  /* Moved just now, or already theirs (an earlier chat on it moved it; Kimono Git then answers for the old address too). */
  if (!moved.ok) {
    const there = await send(config, `/repos/${encodeURIComponent(login)}/${encodeURIComponent(name)}`, { timeout: 15_000 });
    const owner = there.ok ? ((await there.json()) as ForgejoRepo).owner.login.toLowerCase() : "";
    if (owner !== login.toLowerCase()) return workspace;
  }
  db.prepare("UPDATE workspaces SET repo_owner = ? WHERE lower(repo_owner) = ? AND repo_name = ?").run(login, managedGitUser, name);
  return { ...workspace, repo: { owner: login, name } };
}
