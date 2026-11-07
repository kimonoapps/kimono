import "server-only";

import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { scanAppDefinitions } from "./definitions";
import { renderDeploymentPlan, type DeploymentPlan } from "./deployment";
import { readMeshMembers, type MeshMember } from "./directory";
import { renderSecretEnvironment, resolveSecrets, type SecretStore } from "./secrets";
import { serialize, writeFileAtomic } from "./serial";
import type { PlatformSettings } from "./settings";
import { deploymentDir, planPath, planSecretsPath, tunnelCredentialsPath } from "./state";

export type ReconcilerStatus = {
  planDigest: string;
  state: "applying" | "ready" | "failed";
  message: string;
  updatedAt: string;
  appliedServices?: string[];
  failedActions?: string[];
};

export type DesiredState = { plan: DeploymentPlan; digest: string };

function secretName(appId: string, key: string) { return `KIMONO_SECRET_${appId}_${key}`.toUpperCase().replaceAll("-", "_"); }

/** Secret values the administrator supplied, which must never be regenerated. */
function providedSecrets(settings: PlatformSettings): SecretStore {
  const provided: SecretStore = {};
  for (const app of Object.values(settings.apps)) {
    for (const [key, override] of Object.entries(app.environment)) if (override.secret && override.value) provided[secretName(app.id, key)] = override.value;
  }
  for (const tunnel of Object.values(settings.tunnels)) {
    const token = tunnel.configuration.TUNNEL_TOKEN?.value;
    if (token) provided[secretName(`tunnel-${tunnel.id}`, "TOKEN")] = token;
  }
  return provided;
}

/**
 * Publishes a copy of each connector's credentials that the non-root connector
 * image can read. The copy stays inside the 0700 deployment directory.
 */
async function publishTunnelCredentials(settings: PlatformSettings, warnings: string[]) {
  for (const tunnel of Object.values(settings.tunnels)) {
    const source = tunnel.configuration.CREDENTIALS_FILE?.value;
    if (!tunnel.enabled || !source) continue;
    const destination = tunnelCredentialsPath(tunnel.id);
    try {
      await copyFile(source, destination);
      await chmod(destination, 0o644);
    } catch {
      warnings.push(`${tunnel.name}: credentials file could not be read at ${source}`);
    }
  }
}

const writeAtomic = (path: string, contents: string, mode: number) => writeFileAtomic(path, contents, mode);

export function planDigest(plan: DeploymentPlan) {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 16);
}

/**
 * Renders the current desired state to the directory the reconciler watches. The
 * plan carries secret references only; values travel beside it in a 0600 env file.
 */
/** The policy already published, used when the identity provider is down. */
async function previousMeshPolicy(): Promise<string | null> {
  try {
    const plan = JSON.parse(await readFile(planPath, "utf8")) as { files?: Record<string, string> };
    return plan.files?.["mesh/policy.hujson"] ?? null;
  } catch {
    return null;
  }
}

/*
 * One publish at a time, and each from the settings as they are when its turn
 * comes: a publish that began earlier can't finish last with what it read then,
 * and two can't each mint a different value for the same new secret. The
 * settings passed in are the caller's; the saved ones are what's published.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- callers still hand over what they read; the saved settings win
export function publishDesiredState(_settings?: PlatformSettings): Promise<DesiredState> {
  return serialize("desired-state", async () => {
    const { getPlatformSettings } = await import("./settings");
    return publish(await getPlatformSettings());
  });
}

async function publish(settings: PlatformSettings): Promise<DesiredState> {
  const { definitions } = await scanAppDefinitions();
  /* Membership lives in the identity provider, so it is read at publish time.
     A provider that is briefly unreachable must not silently empty the mesh
     policy, so the previous plan's policy is kept instead. */
  let meshMembers: Record<string, MeshMember> = {};
  let meshReadable = true;
  try { meshMembers = await readMeshMembers(); } catch { meshReadable = false; }
  const plan = renderDeploymentPlan(settings, definitions, meshMembers);
  if (!meshReadable) {
    const previous = await previousMeshPolicy();
    if (previous) plan.files["mesh/policy.hujson"] = previous;
    else delete plan.files["mesh/policy.hujson"];
  }
  const provided = providedSecrets(settings);
  const generated = await resolveSecrets(plan.secrets.filter((name) => !provided[name]));
  const secrets = Object.fromEntries(plan.secrets.map((name) => [name, provided[name] ?? generated[name]]).filter((entry): entry is [string, string] => Boolean(entry[1])));

  await mkdir(deploymentDir, { recursive: true, mode: 0o700 });
  await publishTunnelCredentials(settings, plan.warnings);
  await writeAtomic(planSecretsPath, renderSecretEnvironment(secrets), 0o600);
  const digest = planDigest(plan);
  await writeAtomic(planPath, `${JSON.stringify({ ...plan, digest }, null, 2)}\n`, 0o600);
  return { plan, digest };
}

export async function readReconcilerStatus(): Promise<ReconcilerStatus | null> {
  try {
    const parsed = JSON.parse(await readFile(`${deploymentDir}/status.json`, "utf8")) as ReconcilerStatus;
    return parsed && typeof parsed.state === "string" ? parsed : null;
  } catch {
    return null;
  }
}
