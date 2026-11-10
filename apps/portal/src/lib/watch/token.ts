/**
 * A stream's address as the apps see it: /api/v1/watch/stream/<token>.
 *
 * The token is the upstream address (a debrid link, or nzbdav on the private
 * network) sealed with AES-256-GCM, with who asked and until when. Players
 * can't always send a sign-in header, so the token is the permission; it is
 * unreadable and unforgeable, and lasts a few hours. Upstream addresses never
 * leave the server, so a source can change or be revoked without the apps
 * knowing.
 *
 * Pure, tested in scripts/test-watch.mjs.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type StreamGrant = { url: string; username: string; expiresAt: number };

const b64 = (buffer: Buffer) => buffer.toString("base64url");

export function sealStream(key: Buffer, grant: StreamGrant): string {
  if (key.length !== 32) throw new Error("A stream key is 32 bytes.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ u: grant.url, n: grant.username, e: grant.expiresAt }), "utf8"), cipher.final()]);
  return `${b64(iv)}.${b64(body)}.${b64(cipher.getAuthTag())}`;
}

/** The grant, or null when the token was altered, made with another key, or has run out. */
export function openStream(key: Buffer, token: string, now = Date.now()): StreamGrant | null {
  const [iv, body, tag] = token.split(".");
  if (!iv || !body || !tag || token.length > 8192) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const raw = JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8")) as { u?: unknown; n?: unknown; e?: unknown };
    if (typeof raw.u !== "string" || typeof raw.n !== "string" || typeof raw.e !== "number" || raw.e < now) return null;
    return { url: raw.u, username: raw.n, expiresAt: raw.e };
  } catch {
    return null;
  }
}
