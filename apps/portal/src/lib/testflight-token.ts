import { createPrivateKey, sign } from "node:crypto";

/*
 * The token App Store Connect's API takes: a JWT signed with the team's API
 * key (ES256), good for fifteen minutes. Kept apart from lib/testflight.ts so
 * it can be tested without the network.
 */

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export function appStoreToken(issuerId: string, keyId: string, privateKey: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iss: issuerId, iat, exp: iat + 15 * 60, aud: "appstoreconnect-v1" }));
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key: createPrivateKey(privateKey), dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${base64url(signature)}`;
}

/** Whether text looks like the .p8 file App Store Connect hands out (a PKCS #8 EC key that Node can read). */
export function isApiKey(text: string): boolean {
  if (!/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(text)) return false;
  try { return createPrivateKey(text).asymmetricKeyType === "ec"; } catch { return false; }
}
