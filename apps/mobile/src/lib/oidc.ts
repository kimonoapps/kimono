/**
 * The three token calls the app makes, as plain form posts. expo-auth-session
 * opens the sign-in page well, but it trims the trailing slash off endpoint
 * addresses, and the identity provider answers those trimmed ones with 405.
 */

export type Endpoints = { authorizationEndpoint: string; tokenEndpoint: string; revocationEndpoint?: string };
export type Tokens = { accessToken: string; refreshToken: string | null; expiresIn: number };

/** The provider said no: the grant is spent, expired or revoked. Not a network problem. */
export class TokenRefused extends Error {}

export async function discover(issuer: string): Promise<Endpoints> {
  const response = await fetch(`${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`discovery ${response.status}`);
  const document = await response.json() as { authorization_endpoint: string; token_endpoint: string; revocation_endpoint?: string };
  return { authorizationEndpoint: document.authorization_endpoint, tokenEndpoint: document.token_endpoint, revocationEndpoint: document.revocation_endpoint };
}

async function post(url: string, form: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: Object.entries(form).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&"),
  });
}

export async function requestTokens(endpoints: Endpoints, form: Record<string, string>): Promise<Tokens> {
  const response = await post(endpoints.tokenEndpoint, form);
  const body = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !body.access_token) {
    if (body.error === "invalid_grant" || body.error === "invalid_client" || response.status === 400 || response.status === 401) throw new TokenRefused(body.error || `token ${response.status}`);
    throw new Error(`token ${response.status}`);
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null, expiresIn: body.expires_in ?? 600 };
}

export async function revoke(endpoints: Endpoints, clientId: string, refreshToken: string) {
  if (!endpoints.revocationEndpoint) return;
  await post(endpoints.revocationEndpoint, { token: refreshToken, token_type_hint: "refresh_token", client_id: clientId });
}
