import "server-only";

import { secretName } from "../deployment";
import { readSecret, storeSecret } from "../secrets";
import type { CodeConfig } from "./config";
import { CodeProblem } from "./model";

/* Kimono Git's own administrator, which Kimono sets up (app-definitions/forgejo) and Kimono AI works as. */
export const managedGitUser = "kimono-ai";

let minting: Promise<string> | null = null;

/**
 * The token Kimono AI uses with Kimono Git: the one an administrator entered, or else one
 * minted from Kimono's own Forgejo account and kept. [stale] drops a kept token Forgejo refused.
 */
export async function gitToken(config: CodeConfig, stale = false): Promise<string> {
  if (config.gitToken) return config.gitToken;
  if (!config.gitApp) return "";
  if (!stale) {
    const kept = await readSecret(secretName(config.gitApp, "AI_TOKEN"));
    if (kept) return kept;
  }
  minting ??= mint(config, config.gitApp).finally(() => { minting = null; });
  return minting;
}

async function mint(config: CodeConfig, app: string): Promise<string> {
  const password = await readSecret(secretName(app, "ADMIN_PASSWORD"));
  if (!password) throw new CodeProblem("Kimono Git is still being set up. Try again in a minute.", 503);
  let response: Response;
  try {
    response = await fetch(`${config.gitAddress}/api/v1/users/${managedGitUser}/tokens`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${managedGitUser}:${password}`).toString("base64")}`,
        "Content-Type": "application/json", Accept: "application/json",
      },
      body: JSON.stringify({ name: `kimono-ai-${Date.now()}`, scopes: ["write:repository", "write:user", "read:organization"] }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CodeProblem("Kimono Git isn't answering.", 502);
  }
  /* Before Kimono has made its account, Forgejo knows no such user. */
  if (response.status === 401 || response.status === 403 || response.status === 404) throw new CodeProblem("Kimono Git is still being set up. Try again in a minute.", 503);
  if (!response.ok) throw new CodeProblem("Kimono Git couldn't answer that.", 502);
  const { sha1 } = (await response.json()) as { sha1?: string };
  if (!sha1) throw new CodeProblem("Kimono Git couldn't answer that.", 502);
  await storeSecret(secretName(app, "AI_TOKEN"), sha1);
  return sha1;
}
