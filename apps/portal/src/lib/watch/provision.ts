/**
 * Setting up nzbdav and AIOStreams, so nobody opens either.
 *
 * Both run beside the Portal and are configured only from here, from the
 * accounts entered under Admin → Applications → Watch:
 *
 *  - nzbdav gets the Usenet provider through its config API. Its API key and
 *    WebDAV login are fixed at deploy time (the server's environment), so the
 *    Portal and nzbdav agree on them without ever being told.
 *  - AIOStreams gets one configuration for the household through its user
 *    API: the debrid service, nzbdav, the indexer, and the torrent sources
 *    that go with a debrid service. Its address, password and manifest are
 *    kept in Watch's database.
 *
 * Whenever the accounts change, both are set up again on the next request.
 * The documents are built by pure functions, tested in scripts/test-watch.mjs.
 */
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { WatchConfig } from "./config";
import { readState, WatchProblem, writeState } from "./model";

/* nzbdav as AIOStreams reaches it: they always run side by side. */
export const nzbdavForAiostreams = "http://nzbdav:3000";
export const webdavUser = "kimono";

export type NzbdavAccess = { key: string; webdavPassword: string };

/** nzbdav's provider list, as its config API takes it (PascalCase; type 1 is a pooled provider). */
export function nzbdavProviders(usenet: WatchConfig["usenet"]): string {
  return JSON.stringify({ Providers: usenet.host ? [{ Type: 1, Host: usenet.host, Port: usenet.port, UseSsl: usenet.ssl, User: usenet.username, Pass: usenet.password, MaxConnections: usenet.connections }] : [] });
}

/** Newznab indexers answer at /api; people paste the site, the API, or either with a slash. */
export function indexerApi(url: string): string {
  const clean = url.trim().replace(/\/+$/, "");
  return /\/api$/i.test(clean) ? clean : `${clean}/api`;
}

/** AIOStreams' configuration for the household. Streams are sorted cached-first; Watch picks per device after that. */
export function aiostreamsConfig(cfg: Pick<WatchConfig, "usenet" | "indexer" | "debrid">, nzbdav: NzbdavAccess, nzbdavPublicUrl: string) {
  const usenet = Boolean(cfg.usenet.host && cfg.indexer.url && cfg.indexer.key);
  const debrid = Boolean(cfg.debrid.service && cfg.debrid.key);
  const services = [
    ...(debrid ? [{ id: cfg.debrid.service, enabled: true, credentials: { apiKey: cfg.debrid.key } }] : []),
    ...(usenet ? [{ id: "nzbdav", enabled: true, credentials: { url: nzbdavForAiostreams, publicUrl: nzbdavPublicUrl, apiKey: nzbdav.key, username: webdavUser, password: nzbdav.webdavPassword } }] : []),
  ];
  const presets = [
    ...(usenet ? [{ type: "newznab", instanceId: "indexer", enabled: true, options: { name: "Usenet", timeout: 15000, api: { url: indexerApi(cfg.indexer.url), apiKey: cfg.indexer.key }, searchMode: "query", services: ["nzbdav"] } }] : []),
    ...(debrid ? [
      { type: "torrentio", instanceId: "torrentio", enabled: true, options: { name: "Torrentio", timeout: 10000, useMultipleInstances: false, services: [cfg.debrid.service] } },
      { type: "comet", instanceId: "comet", enabled: true, options: { name: "Comet", timeout: 10000, services: [cfg.debrid.service] } },
    ] : []),
  ];
  return {
    formatter: { id: "gdrive" },
    sortCriteria: { global: [{ key: "cached", direction: "desc" }, { key: "resolution", direction: "desc" }, { key: "quality", direction: "desc" }, { key: "size", direction: "desc" }] },
    services,
    presets,
  };
}

/** What the setup depends on: when this changes, set it up again. Secrets are hashed, never kept. */
export function fingerprint(cfg: Pick<WatchConfig, "usenet" | "indexer" | "debrid">, nzbdavPublicUrl: string): string {
  return createHash("sha256").update(JSON.stringify([cfg.usenet, cfg.indexer, cfg.debrid, nzbdavPublicUrl, 2])).digest("hex");
}

export const hasSources = (cfg: Pick<WatchConfig, "usenet" | "indexer" | "debrid">) =>
  Boolean((cfg.usenet.host && cfg.usenet.username && cfg.indexer.url && cfg.indexer.key) || (cfg.debrid.service && cfg.debrid.key));

/* ───── Kept state ───── */

type Setup = { fingerprint: string; uuid: string; password: string; manifest: string; at: number };

function readSetup(db: DatabaseSync): Setup | null {
  const row = db.prepare("SELECT body FROM state WHERE key = 'aiostreams'").get() as { body?: string } | undefined;
  try { return row?.body ? JSON.parse(row.body) as Setup : null; } catch { return null; }
}
function writeSetup(db: DatabaseSync, setup: Setup) {
  db.prepare("INSERT INTO state (key, body) VALUES ('aiostreams', ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body").run(JSON.stringify(setup));
}

/* ───── Requests ───── */

type Envelope = { success?: boolean; data?: { uuid?: string; encryptedPassword?: string }; error?: { message?: string } | null };

async function nzbdavConfigure(base: string, key: string, usenet: WatchConfig["usenet"]) {
  const body = new URLSearchParams({ "usenet.providers": nzbdavProviders(usenet) });
  const response = await fetch(`${base}/api/update-config`, { method: "POST", headers: { "x-api-key": key, "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok) throw new WatchProblem("Watch couldn't set up Usenet streaming. Check that nzbdav is running.", 502);
}

async function aiostreams(base: string, method: "POST" | "PUT", body: unknown, auth?: { uuid: string; password: string }): Promise<Envelope> {
  const response = await fetch(`${base}/api/v1/user`, {
    method, body: JSON.stringify(body),
    headers: { "content-type": "application/json", accept: "application/json", ...(auth ? { authorization: `Basic ${Buffer.from(`${auth.uuid}:${auth.password}`).toString("base64")}` } : {}) },
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!response) throw new WatchProblem("Watch couldn't reach its stream search. Check that AIOStreams is running.", 502);
  const envelope = (await response.json().catch(() => ({}))) as Envelope;
  if (!response.ok || envelope.success === false) throw new WatchProblem(`The stream search refused Watch's setup: ${envelope.error?.message || response.status}.`, 502);
  return envelope;
}

/**
 * Makes sure nzbdav and AIOStreams are set up for the accounts as they are now,
 * and gives back AIOStreams' manifest. Cheap when nothing changed.
 */
export async function ensureProvisioned(db: DatabaseSync, cfg: WatchConfig, nzbdav: NzbdavAccess): Promise<string> {
  try {
    const manifest = await provision(db, cfg, nzbdav);
    if (provisioningOf(db).ok !== true) noteProvisioning(db, null);
    return manifest;
  } catch (error) {
    noteProvisioning(db, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** Whether the last setup worked, when it last ran, and what went wrong if it didn't. */
export type Provisioning = { ok: boolean | null; at: number | null; setupAt: number | null; error: string | null };

export function noteProvisioning(db: DatabaseSync, error: string | null, now = Date.now()) {
  writeState(db, "provisioning", { ok: error === null, at: now, error });
}
export function provisioningOf(db: DatabaseSync): Provisioning {
  const last = readState<{ ok: boolean; at: number; error: string | null }>(db, "provisioning");
  return { ok: last?.ok ?? null, at: last?.at ?? null, setupAt: readSetup(db)?.at ?? null, error: last?.ok === false ? last.error : null };
}

async function provision(db: DatabaseSync, cfg: WatchConfig, nzbdav: NzbdavAccess): Promise<string> {
  if (!hasSources(cfg)) throw new WatchProblem("Watch has nowhere to stream from yet. Add a Usenet provider and indexer, or a debrid service, in Applications → Watch.", 503);
  const print = fingerprint(cfg, cfg.nzbdavStreamUrl);
  const kept = readSetup(db);
  if (kept && kept.fingerprint === print) return kept.manifest;

  if (cfg.usenet.host) await nzbdavConfigure(cfg.nzbdavUrl, nzbdav.key, cfg.usenet);
  const config = aiostreamsConfig(cfg, nzbdav, cfg.nzbdavStreamUrl);
  let uuid = kept?.uuid, password = kept?.password, encrypted: string | undefined;
  if (uuid && password) {
    await aiostreams(cfg.aiostreamsUrl, "PUT", { config }, { uuid, password });
    /* The manifest's password part is re-encrypted per answer; a GET hands back a valid one. */
    const got = await fetch(`${cfg.aiostreamsUrl}/api/v1/user`, { headers: { accept: "application/json", authorization: `Basic ${Buffer.from(`${uuid}:${password}`).toString("base64")}` }, signal: AbortSignal.timeout(15_000) }).then((r) => r.json() as Promise<Envelope>).catch(() => null);
    encrypted = got?.data?.encryptedPassword;
  } else {
    password = randomBytes(24).toString("base64url");
    const created = await aiostreams(cfg.aiostreamsUrl, "POST", { config, password });
    uuid = created.data?.uuid;
    encrypted = created.data?.encryptedPassword;
  }
  if (!uuid || !encrypted) throw new WatchProblem("The stream search didn't confirm Watch's setup. Try again in a moment.", 502);
  const manifest = `${cfg.aiostreamsUrl}/stremio/${uuid}/${encrypted}/manifest.json`;
  writeSetup(db, { fingerprint: print, uuid, password, manifest, at: Date.now() });
  return manifest;
}
