import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { serialize, writeFileAtomic } from "./serial";
import { secretsPath } from "./state";

export type SecretStore = Record<string, string>;

const namePattern = /^KIMONO_SECRET_[A-Z0-9_]+$/;

async function read(): Promise<SecretStore> {
  try {
    const parsed = JSON.parse(await readFile(secretsPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => namePattern.test(entry[0]) && typeof entry[1] === "string" && entry[1].length > 0));
  } catch {
    return {};
  }
}

async function write(store: SecretStore) {
  await mkdir(dirname(secretsPath), { recursive: true, mode: 0o700 });
  await writeFileAtomic(secretsPath, `${JSON.stringify(store, null, 2)}\n`, 0o600);
}

/**
 * Returns a value for every requested reference, minting and persisting the ones
 * that do not exist yet. Values are hex so that consumers such as Outline, which
 * require hexadecimal keys, accept them unchanged.
 */
export function resolveSecrets(names: readonly string[]): Promise<SecretStore> {
  return serialize(secretsPath, () => mint(names));
}

async function mint(names: readonly string[]): Promise<SecretStore> {
  const store = await read();
  const resolved: SecretStore = {};
  let minted = false;
  for (const name of names) {
    if (!namePattern.test(name)) continue;
    if (!store[name]) { store[name] = randomBytes(32).toString("hex"); minted = true; }
    resolved[name] = store[name];
  }
  if (minted) await write(store);
  return resolved;
}

export function renderSecretEnvironment(secrets: SecretStore) {
  return `${Object.entries(secrets).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => `${name}=${value}`).join("\n")}\n`;
}

/** One stored value, without minting it: absent until something put it there. */
export async function readSecret(name: string): Promise<string> {
  return (await read())[name] || "";
}

/** Keeps a value the Portal obtained rather than minted, such as a token another app issued. */
export async function storeSecret(name: string, value: string) {
  if (!namePattern.test(name) || !value) return;
  await serialize(secretsPath, async () => {
    const store = await read();
    if (store[name] === value) return;
    store[name] = value;
    await write(store);
  });
}
