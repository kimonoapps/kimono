import "server-only";

import { CodeProblem } from "./model";
import type { CodeConfig } from "./config";

/* Kimono Git, read with Code's token: which repositories there are to work on, and their branches. */

export type Repository = { owner: string; name: string; description: string; defaultBranch: string; updatedAt: number; private: boolean };

async function get<T>(config: CodeConfig, path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.gitAddress}/api/v1${path}`, {
      headers: { Authorization: `token ${config.gitToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new CodeProblem("Kimono Git isn't answering.", 502);
  }
  if (response.status === 401 || response.status === 403) throw new CodeProblem("Kimono Git refused Code's token.", 502);
  if (response.status === 404) throw new CodeProblem("That repository isn't in Kimono Git.", 404);
  if (!response.ok) throw new CodeProblem("Kimono Git couldn't answer that.", 502);
  return (await response.json()) as T;
}

type ForgejoRepo = { name: string; owner: { login: string }; description: string; default_branch: string; updated_at: string; private: boolean; archived: boolean };

export async function repositories(config: CodeConfig): Promise<Repository[]> {
  const list: ForgejoRepo[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await get<ForgejoRepo[]>(config, `/user/repos?limit=50&page=${page}`);
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

/** Makes a new, private repository with a first commit, so there's a branch to start from. */
export async function createRepository(config: CodeConfig, title: string): Promise<Repository> {
  const name = repositoryName(title);
  if (!name) throw new CodeProblem("Give the project a name.");
  let response: Response;
  try {
    response = await fetch(`${config.gitAddress}/api/v1/user/repos`, {
      method: "POST",
      headers: { Authorization: `token ${config.gitToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name, description: title.trim().slice(0, 200), private: true, auto_init: true, default_branch: "main", readme: "Default" }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new CodeProblem("Kimono Git isn't answering.", 502);
  }
  if (response.status === 409) throw new CodeProblem("There's already a project with that name.", 409);
  if (response.status === 401 || response.status === 403) throw new CodeProblem("Kimono Git refused Code's token.", 502);
  if (!response.ok) throw new CodeProblem("Kimono Git couldn't make that project.", 502);
  const repo = (await response.json()) as ForgejoRepo;
  return { owner: repo.owner.login, name: repo.name, description: repo.description || "", defaultBranch: repo.default_branch || "main", updatedAt: Date.now(), private: repo.private };
}
