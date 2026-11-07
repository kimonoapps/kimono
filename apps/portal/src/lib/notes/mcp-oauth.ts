/**
 * 鍵 Sign-in for Kimono Notes' MCP server: OAuth 2.1, as MCP clients expect.
 *
 * A client registers itself (RFC 7591), sends the person to the Portal to
 * allow it (PKCE, S256 only), and trades the code for tokens. Clients are
 * public: none holds a secret, so the code verifier is what proves the
 * redeemer is the one that asked.
 *
 * What a person allows is a grant: one client, one person, Notes only. Its
 * tokens are opaque and kept here only as hashes. Access tokens last an hour;
 * a refresh token is used once, rotating to a new one, and lapses after 30
 * days unused. Presenting a code or refresh token a second time revokes the
 * whole grant, since one of the two presenters isn't who it should be.
 *
 * Pure logic over its own SQLite database, tested in scripts/test-notes-mcp.mjs.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const notesScope = "notes";
export const accessTtl = 60 * 60 * 1000;
export const refreshTtl = 30 * 24 * 60 * 60 * 1000;
export const codeTtl = 60 * 1000;
/** Registered clients nobody has allowed are forgotten after a day. */
const unusedClientTtl = 24 * 60 * 60 * 1000;
const maxClients = 500;

export class OAuthProblem extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}

export function migrateOAuth(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, uri TEXT, redirect_uris TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS codes (
      hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, username TEXT NOT NULL, redirect_uri TEXT NOT NULL,
      challenge TEXT NOT NULL, resource TEXT NOT NULL, expires_at INTEGER NOT NULL, grant_id TEXT
    );
    CREATE TABLE IF NOT EXISTS grants (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL, username TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, revoked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS tokens (
      hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
      expires_at INTEGER NOT NULL, used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS tokens_by_grant ON tokens(grant_id);
    CREATE INDEX IF NOT EXISTS grants_by_user ON grants(username);
  `);
}

const secret = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;
export const hashOf = (value: string) => createHash("sha256").update(value).digest("base64url");

/** PKCE, S256 only: the verifier's hash is the challenge sent with the authorization request. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const expected = Buffer.from(hashOf(verifier));
  const given = Buffer.from(challenge);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const validChallenge = (challenge: unknown): challenge is string => typeof challenge === "string" && /^[A-Za-z0-9_-]{43}$/.test(challenge);

/**
 * Where a client may be sent back: an https address, a loopback address on
 * any port (RFC 8252), or an app's own scheme ("cursor://…"). Never one that
 * runs or carries content, and never with a fragment.
 */
export function validRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2000 || /[\u0000- \\]/.test(raw)) return false;
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (["javascript:", "data:", "vbscript:", "file:", "blob:", "about:", "ftp:", "ws:", "wss:"].includes(url.protocol)) return false;
  /* An app's own scheme is reverse-DNS or a plain word: "com.example.app:", "cursor:". */
  return /^[a-z][a-z0-9+.-]{1,}:$/.test(url.protocol);
}

/**
 * Loopback addresses match on everything but the port, which a native client
 * picks when it starts listening (RFC 8252 §7.3). Everything else matches exactly.
 */
export function redirectMatches(registered: string[], asked: string): boolean {
  if (registered.includes(asked)) return true;
  let url: URL;
  try { url = new URL(asked); } catch { return false; }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
  return registered.some((uri) => {
    try {
      const known = new URL(uri);
      return known.protocol === "http:" && known.hostname === url.hostname && known.pathname === url.pathname && known.search === url.search;
    } catch { return false; }
  });
}

export type Client = { id: string; name: string; uri: string | null; redirectUris: string[]; createdAt: number };

/** RFC 7591 registration. Every client is public; whatever it asks for, it is told it holds no secret. */
export function registerClient(db: DatabaseSync, body: unknown, now = Date.now()) {
  if (!body || typeof body !== "object") throw new OAuthProblem("invalid_client_metadata", "Send the client's metadata as JSON.");
  const input = body as Record<string, unknown>;
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10) throw new OAuthProblem("invalid_redirect_uri", "Send between one and ten redirect_uris.");
  for (const uri of uris) if (!validRedirectUri(uri)) throw new OAuthProblem("invalid_redirect_uri", `That redirect URI isn't allowed: ${String(uri).slice(0, 200)}`);
  const grantTypes = input.grant_types === undefined ? ["authorization_code", "refresh_token"] : input.grant_types;
  if (!Array.isArray(grantTypes) || !grantTypes.includes("authorization_code") || grantTypes.some((type) => type !== "authorization_code" && type !== "refresh_token")) {
    throw new OAuthProblem("invalid_client_metadata", "Only authorization_code and refresh_token grants are offered.");
  }
  if (input.response_types !== undefined && (!Array.isArray(input.response_types) || input.response_types.some((type) => type !== "code"))) {
    throw new OAuthProblem("invalid_client_metadata", "Only the code response type is offered.");
  }
  const name = clean(input.client_name, 100) || "An app";
  const uri = typeof input.client_uri === "string" && /^https:\/\/[^\s]+$/.test(input.client_uri) && input.client_uri.length <= 500 ? input.client_uri : null;
  pruneClients(db, now);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM clients").get() as { n: number }).n;
  if (count >= maxClients) throw new OAuthProblem("temporarily_unavailable", "Too many apps are registered. Try again later.", 429);
  const id = `kn_client_${randomBytes(16).toString("base64url")}`;
  db.prepare("INSERT INTO clients (id, name, uri, redirect_uris, created_at) VALUES (?, ?, ?, ?, ?)").run(id, name, uri, JSON.stringify(uris), now);
  return {
    client_id: id,
    client_id_issued_at: Math.floor(now / 1000),
    client_name: name,
    ...(uri ? { client_uri: uri } : {}),
    redirect_uris: uris as string[],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: notesScope,
  };
}

/* Names come from whoever registers: plain text, one line, short. */
function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
  return [...text].slice(0, max).join("");
}

/* Registration is open, so a client that never got a grant doesn't stay forever. */
function pruneClients(db: DatabaseSync, now: number) {
  db.prepare(`DELETE FROM clients WHERE created_at < ? AND id NOT IN (SELECT client_id FROM grants WHERE revoked_at IS NULL)
    AND id NOT IN (SELECT client_id FROM codes)`).run(now - unusedClientTtl);
}

export function clientFor(db: DatabaseSync, id: unknown): Client | null {
  if (typeof id !== "string" || !id) return null;
  const row = db.prepare("SELECT id, name, uri, redirect_uris, created_at FROM clients WHERE id = ?").get(id) as { id: string; name: string; uri: string | null; redirect_uris: string; created_at: number } | undefined;
  return row ? { id: row.id, name: row.name, uri: row.uri, redirectUris: JSON.parse(row.redirect_uris) as string[], createdAt: row.created_at } : null;
}

/** The scope a request may have: Notes, or nothing asked (which means Notes). */
export function scopeFrom(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return notesScope;
  if (typeof raw !== "string") return null;
  const asked = raw.split(" ").filter(Boolean);
  /* Clients often add the OpenID scopes they ask every server for; they get Notes alone. */
  return asked.every((scope) => scope === notesScope || ["openid", "profile", "email", "offline_access"].includes(scope)) ? notesScope : null;
}

export type CodeRequest = { clientId: string; username: string; redirectUri: string; challenge: string; resource: string };

/** A one-minute code for the client to redeem with its verifier. */
export function issueCode(db: DatabaseSync, request: CodeRequest, now = Date.now()): string {
  db.prepare("DELETE FROM codes WHERE expires_at < ?").run(now);
  const code = secret("kn_code_");
  db.prepare("INSERT INTO codes (hash, client_id, username, redirect_uri, challenge, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(hashOf(code), request.clientId, request.username.toLowerCase(), request.redirectUri, request.challenge, request.resource, now + codeTtl);
  return code;
}

export type Tokens = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

function mint(db: DatabaseSync, grantId: string, now: number): Tokens {
  const access = secret("kn_at_"), refresh = secret("kn_rt_");
  const insert = db.prepare("INSERT INTO tokens (hash, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)");
  insert.run(hashOf(access), grantId, "access", now + accessTtl);
  insert.run(hashOf(refresh), grantId, "refresh", now + refreshTtl);
  db.prepare("DELETE FROM tokens WHERE grant_id = ? AND expires_at < ?").run(grantId, now);
  return { access_token: access, token_type: "Bearer", expires_in: accessTtl / 1000, refresh_token: refresh, scope: notesScope };
}

function revokeGrant(db: DatabaseSync, grantId: string, now: number) {
  db.prepare("UPDATE grants SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(now, grantId);
  db.prepare("DELETE FROM tokens WHERE grant_id = ?").run(grantId);
}

/* A resource sent with a token request must be the one the grant is for (RFC 8707). */
function resourceFits(asked: unknown, resource: string) {
  return asked === undefined || asked === null || asked === "" || asked === resource;
}

/** authorization_code: the code, from the client it was issued to, with the verifier and the same redirect URI. */
export function redeemCode(db: DatabaseSync, input: { code?: unknown; clientId?: unknown; redirectUri?: unknown; verifier?: unknown; resource?: unknown }, now = Date.now()): Tokens {
  if (typeof input.code !== "string" || typeof input.verifier !== "string") throw new OAuthProblem("invalid_request", "Send the code and its code_verifier.");
  const hash = hashOf(input.code);
  const row = db.prepare("SELECT * FROM codes WHERE hash = ?").get(hash) as { client_id: string; username: string; redirect_uri: string; challenge: string; resource: string; expires_at: number; grant_id: string | null } | undefined;
  if (!row) throw new OAuthProblem("invalid_grant", "That code isn't valid.");
  if (row.grant_id) {
    /* Used before: whoever has it now, the grant it made can't be trusted. */
    revokeGrant(db, row.grant_id, now);
    throw new OAuthProblem("invalid_grant", "That code was already used.");
  }
  if (row.expires_at < now) { db.prepare("DELETE FROM codes WHERE hash = ?").run(hash); throw new OAuthProblem("invalid_grant", "That code has expired."); }
  if (row.client_id !== input.clientId) throw new OAuthProblem("invalid_grant", "That code was issued to another app.");
  if (row.redirect_uri !== input.redirectUri) throw new OAuthProblem("invalid_grant", "The redirect_uri doesn't match the one the code was issued for.");
  if (!pkceMatches(input.verifier, row.challenge)) throw new OAuthProblem("invalid_grant", "The code_verifier doesn't match.");
  if (!resourceFits(input.resource, row.resource)) throw new OAuthProblem("invalid_target", "That code is for another resource.");
  const grantId = `kn_grant_${randomBytes(12).toString("base64url")}`;
  db.prepare("INSERT INTO grants (id, client_id, username, resource, scope, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(grantId, row.client_id, row.username, row.resource, notesScope, now, now);
  /* Kept until it would have expired, marked used, so a second try is seen as one. */
  db.prepare("UPDATE codes SET grant_id = ? WHERE hash = ?").run(grantId, hash);
  return mint(db, grantId, now);
}

type GrantRow = { id: string; client_id: string; username: string; resource: string; scope: string; created_at: number; last_used_at: number; revoked_at: number | null };

/** refresh_token: used once, for a new pair. A second use revokes the grant. */
export function refreshTokens(db: DatabaseSync, input: { refreshToken?: unknown; clientId?: unknown; resource?: unknown }, now = Date.now()): Tokens {
  if (typeof input.refreshToken !== "string") throw new OAuthProblem("invalid_request", "Send the refresh_token.");
  const hash = hashOf(input.refreshToken);
  const token = db.prepare("SELECT grant_id, kind, expires_at, used_at FROM tokens WHERE hash = ?").get(hash) as { grant_id: string; kind: string; expires_at: number; used_at: number | null } | undefined;
  if (!token || token.kind !== "refresh") throw new OAuthProblem("invalid_grant", "That refresh token isn't valid.");
  const grant = db.prepare("SELECT * FROM grants WHERE id = ?").get(token.grant_id) as GrantRow | undefined;
  if (!grant || grant.revoked_at) throw new OAuthProblem("invalid_grant", "That access was revoked.");
  if (grant.client_id !== input.clientId) throw new OAuthProblem("invalid_grant", "That refresh token was issued to another app.");
  if (token.used_at) { revokeGrant(db, grant.id, now); throw new OAuthProblem("invalid_grant", "That refresh token was already used."); }
  if (token.expires_at < now) throw new OAuthProblem("invalid_grant", "That refresh token has expired.");
  if (!resourceFits(input.resource, grant.resource)) throw new OAuthProblem("invalid_target", "That refresh token is for another resource.");
  /* The old one stays, marked used, until it would have lapsed: that is how a replay is recognised. */
  db.prepare("UPDATE tokens SET used_at = ? WHERE hash = ?").run(now, hash);
  db.prepare("UPDATE grants SET last_used_at = ? WHERE id = ?").run(now, grant.id);
  return mint(db, grant.id, now);
}

export type Access = { username: string; grantId: string; clientId: string; grantedAt: number };

/** Who an access token speaks for, if it is live and was issued for this resource. */
export function verifyAccess(db: DatabaseSync, token: string, resource: string, now = Date.now()): Access | null {
  if (!token.startsWith("kn_at_")) return null;
  const row = db.prepare(`SELECT g.id, g.client_id, g.username, g.resource, g.created_at, g.revoked_at, t.expires_at FROM tokens t JOIN grants g ON g.id = t.grant_id
    WHERE t.hash = ? AND t.kind = 'access'`).get(hashOf(token)) as { id: string; client_id: string; username: string; resource: string; created_at: number; revoked_at: number | null; expires_at: number } | undefined;
  if (!row || row.revoked_at || row.expires_at < now || row.resource !== resource) return null;
  return { username: row.username, grantId: row.id, clientId: row.client_id, grantedAt: row.created_at };
}

/** RFC 7009: either token ends the whole grant. Unknown tokens are not an error. */
export function revokeToken(db: DatabaseSync, token: unknown, clientId: unknown, now = Date.now()) {
  if (typeof token !== "string") throw new OAuthProblem("invalid_request", "Send the token to revoke.");
  const row = db.prepare("SELECT g.id, g.client_id FROM tokens t JOIN grants g ON g.id = t.grant_id WHERE t.hash = ?").get(hashOf(token)) as { id: string; client_id: string } | undefined;
  if (!row) return;
  if (typeof clientId === "string" && clientId && clientId !== row.client_id) throw new OAuthProblem("invalid_client", "That token belongs to another app.", 401);
  revokeGrant(db, row.id, now);
}

/** The apps a person has let into their notes. */
export function grantsOf(db: DatabaseSync, username: string) {
  return (db.prepare(`SELECT g.id, g.created_at, g.last_used_at, c.name FROM grants g LEFT JOIN clients c ON c.id = g.client_id
    WHERE g.username = ? AND g.revoked_at IS NULL ORDER BY g.last_used_at DESC`).all(username.toLowerCase()) as { id: string; created_at: number; last_used_at: number; name: string | null }[])
    .map((row) => ({ id: row.id, app: row.name || "An app", grantedAt: row.created_at, lastUsedAt: row.last_used_at }));
}

/** Ends one of the person's grants, or (no id) all of them. */
export function revokeGrantsOf(db: DatabaseSync, username: string, grantId?: string, now = Date.now()) {
  const ids = (db.prepare("SELECT id FROM grants WHERE username = ? AND revoked_at IS NULL").all(username.toLowerCase()) as { id: string }[]).map((row) => row.id);
  for (const id of ids) if (!grantId || id === grantId) revokeGrant(db, id, now);
}

/** RFC 9728: what the MCP endpoint is, and who signs clients in for it. */
export function resourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [notesScope],
    bearer_methods_supported: ["header"],
    resource_name: "Kimono Notes",
  };
}

/** RFC 8414. The issuer is the Notes address; people allow apps on the Portal, where they are signed in. */
export function serverMetadata(origin: string, portal: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${portal}/mcp/authorize`,
    token_endpoint: `${origin}/mcp/token`,
    registration_endpoint: `${origin}/mcp/register`,
    revocation_endpoint: `${origin}/mcp/revoke`,
    scopes_supported: [notesScope],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  };
}

/** Where the client is sent back, with the code or the error, its state, and who issued it (RFC 9207). */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}
