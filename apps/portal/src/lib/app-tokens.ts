import "server-only";

import { createPublicKey, verify, type JsonWebKey, type KeyObject } from "node:crypto";

/**
 * 携 The phone app's sign-in.
 *
 * The app signs in through the identity provider as its own public client and
 * sends the access token it gets as `Authorization: Bearer`. These are checked
 * here against the provider's published keys, with no call out per request:
 * the signature, the issuer, the audience and the expiry. Whether the account
 * is still active, and its role, are the caller's to check, as for a session.
 */

export const appClientId = "kimono-app";

export type AppToken = {
  username: string;
  name: string | null;
  email: string | null;
  groups: string[];
  /**
   * When the person signed in, in milliseconds. A refreshed token keeps this,
   * so signing out everywhere refuses every token the old sign-in can mint.
   */
  signedInAt: number;
};

/** The app's provider sits beside the Portal's: same host, its own slug. */
export function appIssuer(): string | null {
  if (process.env.KIMONO_APP_OIDC_ISSUER) return process.env.KIMONO_APP_OIDC_ISSUER.replace(/\/*$/, "/");
  const portal = process.env.AUTHENTIK_ISSUER;
  if (!portal) return null;
  try {
    return new URL(`../${appClientId}/`, portal.replace(/\/*$/, "/")).toString();
  } catch {
    return null;
  }
}

const keyTtl = 10 * 60 * 1000;
/** Unknown key IDs refetch at most this often, so junk tokens can't hammer the provider. */
const refetchFloor = 30 * 1000;
let keys: { at: number; byId: Map<string, KeyObject> } | null = null;
let lastFetch = 0;

/* Everyone who needs the keys while they're being fetched waits for that one fetch. */
let fetchingKeys: Promise<Map<string, KeyObject>> | null = null;
function fetchKeys(issuer: string): Promise<Map<string, KeyObject>> {
  return fetchingKeys ??= readKeys(issuer).finally(() => { fetchingKeys = null; });
}

async function readKeys(issuer: string): Promise<Map<string, KeyObject>> {
  lastFetch = Date.now();
  const response = await fetch(`${issuer}jwks/`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`The sign-in keys could not be read (${response.status}).`);
  const { keys: list } = await response.json() as { keys?: (JsonWebKey & { kid?: string })[] };
  const byId = new Map<string, KeyObject>();
  for (const jwk of list || []) {
    if (!jwk.kid || jwk.kty !== "RSA") continue;
    try { byId.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" })); } catch { /* a key we can't use is skipped */ }
  }
  keys = { at: Date.now(), byId };
  return byId;
}

async function keyFor(issuer: string, kid: string): Promise<KeyObject | null> {
  const fresh = keys && Date.now() - keys.at < keyTtl;
  if (fresh && keys!.byId.has(kid)) return keys!.byId.get(kid)!;
  /* Keys rotate: an unknown ID is worth one refetch, but not one per request. */
  if (fresh && Date.now() - lastFetch < refetchFloor) return null;
  return (await fetchKeys(issuer)).get(kid) ?? null;
}

const part = (value: string) => JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;

/** The account a bearer token speaks for, or null if it isn't a valid app token. */
export async function verifyAppToken(token: string): Promise<AppToken | null> {
  const issuer = appIssuer();
  if (!issuer) return null;
  const pieces = token.split(".");
  if (pieces.length !== 3) return null;
  let header: Record<string, unknown>, claims: Record<string, unknown>;
  try {
    header = part(pieces[0]);
    claims = part(pieces[1]);
  } catch {
    return null;
  }
  /* Only the algorithm the provider signs with. "none" and HMAC never pass. */
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
  let key: KeyObject | null;
  try {
    key = await keyFor(issuer, header.kid);
  } catch (error) {
    console.warn("App sign-in keys unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
  if (!key) return null;
  const signed = verify("RSA-SHA256", Buffer.from(`${pieces[0]}.${pieces[1]}`), key, Buffer.from(pieces[2], "base64url"));
  if (!signed) return null;
  if (claims.iss !== issuer) return null;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(appClientId)) return null;
  /* An ID token is signed the same way but says who signed in, not what the
     app may do. Only access tokens name the party they were issued to. */
  if (claims.azp !== appClientId || typeof claims.scope !== "string") return null;
  const now = Date.now() / 1000;
  if (typeof claims.exp !== "number" || claims.exp < now - 30) return null;
  if (typeof claims.iat !== "number" || claims.iat > now + 60) return null;
  if (typeof claims.preferred_username !== "string" || !claims.preferred_username) return null;
  return {
    username: claims.preferred_username,
    name: typeof claims.name === "string" ? claims.name : null,
    email: typeof claims.email === "string" ? claims.email : null,
    groups: Array.isArray(claims.groups) ? claims.groups.filter((group): group is string => typeof group === "string") : [],
    signedInAt: (typeof claims.auth_time === "number" ? claims.auth_time : claims.iat) * 1000,
  };
}
