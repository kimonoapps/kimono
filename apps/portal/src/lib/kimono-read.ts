import "server-only";

import { createHash, randomBytes, randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stateDir } from "./state";

/**
 * 携 Kimono Read: e-readers paired to a person's Kimono.
 *
 * Nobody types on the reader. It gets on Wi-Fi from a page it serves on its
 * own hotspot, filled in on the phone, and then it is paired one of two ways:
 *
 * - From the phone first (Account > Set up Kimono Read): the phone asks for a
 *   setup ticket, hands it to the reader with the Wi-Fi details, and the
 *   reader trades it for its token. Nothing to approve afterwards.
 * - From the reader first: once online it asks for a pairing and shows a QR
 *   code and a six-character code; the person opens it on a signed-in phone
 *   and taps Pair, and the reader collects its token.
 *
 * A device token is long-lived and stands for one reader of one person. Only
 * its hash is kept. It reads and writes Kimono Books and reads Kimono Drive,
 * nothing else (lib/api-v1.ts), and the person can rename or revoke it from
 * their account; signing out everywhere ends it too.
 */

const root = process.env.KIMONO_READ_DIR || join(stateDir, "kimono-read");
const g = globalThis as unknown as { kimonoReadDb?: DatabaseSync };

const PAIRING_MS = 10 * 60 * 1000;
const TICKET_MS = 20 * 60 * 1000;
const MAX_PENDING = 200;
/* No 0/O, 1/I/L: read off an e-paper screen and typed on a phone. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TOKEN_PREFIX = "kr_";

export class ReadProblem extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function db(): DatabaseSync {
  if (!g.kimonoReadDb) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(join(root, "kimono-read.db"));
    database.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, device_id TEXT NOT NULL, model TEXT NOT NULL, name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS devices_user ON devices (username, created_at);
CREATE TABLE IF NOT EXISTS pairings (
  code TEXT PRIMARY KEY, device_id TEXT NOT NULL, model TEXT NOT NULL, secret_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL, username TEXT, token TEXT
);
CREATE TABLE IF NOT EXISTS tickets (
  ticket_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at INTEGER NOT NULL
);
`);
    g.kimonoReadDb = database;
  }
  return g.kimonoReadDb;
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const now = () => Date.now();

function sweep() {
  const t = now();
  db().prepare("DELETE FROM pairings WHERE expires_at < ?").run(t);
  db().prepare("DELETE FROM tickets WHERE expires_at < ?").run(t);
}

function cleanDeviceId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{4,64}$/.test(value)) throw new ReadProblem("That isn't a Kimono Read device id.");
  return value;
}
function cleanModel(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9._-]{1,32}$/i.test(value)) throw new ReadProblem("That isn't a Kimono Read model.");
  return value.toLowerCase();
}
function cleanSecret(value: unknown): string {
  if (typeof value !== "string" || value.length < 16 || value.length > 128) throw new ReadProblem("A pairing needs the device's secret.");
  return value;
}
export function cleanCode(value: unknown): string {
  const code = typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  if (code.length !== 6) throw new ReadProblem("A pairing code has six letters and numbers.");
  return code;
}
const defaultName = (model: string) => model === "silkscreen" ? "Kimono Read" : `Kimono Read (${model})`;

/** A new token for this reader of this person; an earlier one for the same reader stops working. */
function mint(username: string, deviceId: string, model: string): string {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const t = now();
  const previous = db().prepare("SELECT name FROM devices WHERE username = ? AND device_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1")
    .get(username, deviceId) as { name: string } | undefined;
  db().prepare("UPDATE devices SET revoked_at = ? WHERE username = ? AND device_id = ? AND revoked_at IS NULL").run(t, username, deviceId);
  db().prepare("INSERT INTO devices (id, username, device_id, model, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(randomBytes(9).toString("base64url"), username, deviceId, model, previous?.name ?? defaultName(model), sha(token), t);
  return token;
}

/* ── Reader first ─────────────────────────────────────────────────────── */

/** The reader asks to be paired: a code for the person, valid ten minutes. */
export function startPairing(body: { deviceId?: unknown; model?: unknown; secret?: unknown }) {
  const deviceId = cleanDeviceId(body.deviceId);
  const model = cleanModel(body.model);
  const secret = cleanSecret(body.secret);
  sweep();
  db().prepare("DELETE FROM pairings WHERE device_id = ?").run(deviceId);
  const pending = (db().prepare("SELECT count(*) AS n FROM pairings").get() as { n: number }).n;
  if (pending >= MAX_PENDING) throw new ReadProblem("Too many readers are pairing right now. Try again in a few minutes.", 429);
  let code = "";
  for (let tries = 0; tries < 20 && !code; tries++) {
    const candidate = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    if (!db().prepare("SELECT 1 FROM pairings WHERE code = ?").get(candidate)) code = candidate;
  }
  if (!code) throw new ReadProblem("Couldn't make a pairing code. Try again.", 503);
  const expiresAt = now() + PAIRING_MS;
  db().prepare("INSERT INTO pairings (code, device_id, model, secret_hash, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(code, deviceId, model, sha(secret), expiresAt);
  return { code, expiresIn: Math.round(PAIRING_MS / 1000), interval: 3 };
}

/** What the pairing page shows before the person taps Pair. */
export function pairingFor(codeValue: unknown) {
  const code = cleanCode(codeValue);
  sweep();
  const row = db().prepare("SELECT device_id, model, expires_at, username FROM pairings WHERE code = ?").get(code) as
    { device_id: string; model: string; expires_at: number; username: string | null } | undefined;
  if (!row) throw new ReadProblem("That code has run out or was never shown. Start pairing again on the reader.", 404);
  return { code, deviceId: row.device_id, model: row.model, name: defaultName(row.model), paired: !!row.username };
}

/** The signed-in person pairs the reader showing this code with their account. */
export function approvePairing(codeValue: unknown, username: string) {
  const pairing = pairingFor(codeValue);
  if (pairing.paired) throw new ReadProblem("That reader is already paired.", 409);
  const token = mint(username, pairing.deviceId, pairing.model);
  db().prepare("UPDATE pairings SET username = ?, token = ? WHERE code = ?").run(username, token, pairing.code);
  return { paired: true, name: pairing.name };
}

/** The reader collects its token once the person has paired it. */
export function claimPairing(body: { deviceId?: unknown; secret?: unknown }) {
  const deviceId = cleanDeviceId(body.deviceId);
  const secret = cleanSecret(body.secret);
  sweep();
  const row = db().prepare("SELECT code, username, token FROM pairings WHERE device_id = ? AND secret_hash = ?").get(deviceId, sha(secret)) as
    { code: string; username: string | null; token: string | null } | undefined;
  if (!row) throw new ReadProblem("That pairing has run out. Start again.", 404);
  if (!row.username || !row.token) return { pending: true as const };
  /* Handed over once: the plain token never stays here. */
  db().prepare("DELETE FROM pairings WHERE code = ?").run(row.code);
  return { token: row.token, username: row.username };
}

/* ── Phone first ──────────────────────────────────────────────────────── */

/** A one-time ticket the phone passes to the reader with the Wi-Fi details. */
export function createTicket(username: string) {
  sweep();
  const ticket = randomBytes(24).toString("base64url");
  db().prepare("INSERT INTO tickets (ticket_hash, username, expires_at) VALUES (?, ?, ?)").run(sha(ticket), username, now() + TICKET_MS);
  return { ticket, expiresIn: Math.round(TICKET_MS / 1000) };
}

/** The reader trades the ticket for its own token. */
export function redeemTicket(body: { ticket?: unknown; deviceId?: unknown; model?: unknown }) {
  const deviceId = cleanDeviceId(body.deviceId);
  const model = cleanModel(body.model);
  if (typeof body.ticket !== "string" || body.ticket.length < 16 || body.ticket.length > 128) throw new ReadProblem("That setup link is incomplete.");
  sweep();
  const row = db().prepare("SELECT username FROM tickets WHERE ticket_hash = ?").get(sha(body.ticket)) as { username: string } | undefined;
  if (!row) throw new ReadProblem("That setup has run out. Start it again from the phone.", 404);
  db().prepare("DELETE FROM tickets WHERE ticket_hash = ?").run(sha(body.ticket));
  return { token: mint(row.username, deviceId, model), username: row.username };
}

/* ── Tokens and the person's list ─────────────────────────────────────── */

export type ReadDeviceToken = { id: string; username: string; createdAt: number };

export function verifyDeviceToken(token: string): ReadDeviceToken | null {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 128) return null;
  const row = db().prepare("SELECT id, username, created_at, last_used_at FROM devices WHERE token_hash = ? AND revoked_at IS NULL").get(sha(token)) as
    { id: string; username: string; created_at: number; last_used_at: number | null } | undefined;
  if (!row) return null;
  const t = now();
  /* Once a minute is plenty for "last seen". */
  if (!row.last_used_at || t - row.last_used_at > 60_000) db().prepare("UPDATE devices SET last_used_at = ? WHERE id = ?").run(t, row.id);
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

export type PairedReader = { id: string; name: string; model: string; deviceId: string; pairedAt: string; lastSeen: string | null };

export function listReaders(username: string): PairedReader[] {
  const rows = db().prepare("SELECT id, name, model, device_id, created_at, last_used_at FROM devices WHERE username = ? AND revoked_at IS NULL ORDER BY created_at").all(username) as
    { id: string; name: string; model: string; device_id: string; created_at: number; last_used_at: number | null }[];
  return rows.map((r) => ({ id: r.id, name: r.name, model: r.model, deviceId: r.device_id, pairedAt: new Date(r.created_at).toISOString(), lastSeen: r.last_used_at ? new Date(r.last_used_at).toISOString() : null }));
}

export function renameReader(username: string, id: string, nameValue: unknown) {
  const name = typeof nameValue === "string" ? nameValue.trim().slice(0, 60) : "";
  if (!name) throw new ReadProblem("Give it a name.");
  const result = db().prepare("UPDATE devices SET name = ? WHERE id = ? AND username = ? AND revoked_at IS NULL").run(name, id, username);
  if (!result.changes) throw new ReadProblem("That reader isn't paired with you.", 404);
}

export function revokeReader(username: string, id: string) {
  const result = db().prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND username = ? AND revoked_at IS NULL").run(now(), id, username);
  if (!result.changes) throw new ReadProblem("That reader isn't paired with you.", 404);
}
