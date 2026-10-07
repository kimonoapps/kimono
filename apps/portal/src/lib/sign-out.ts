import "server-only";

import { headers } from "next/headers";
import { getToken } from "next-auth/jwt";
import { signOut } from "@/auth";
import { portalOrigin } from "./account";
import { endIdentitySessionsOfBrowser } from "./directory";
import { revokeSession } from "./session-epochs";

/**
 * Signing out of Kimono, properly: this Portal session is refused from now on
 * (a copy of its cookie included), its cookie is cleared, and the identity
 * provider's sign-in in this browser is ended, so "Continue to Kimono" asks
 * for a password again instead of walking straight back in.
 */
export async function signOutCompletely() {
  const request = await headers();
  const token = await getToken({ req: { headers: request }, secret: process.env.AUTH_SECRET, secureCookie: portalOrigin().startsWith("https://") }).catch(() => null);
  if (token && typeof token.sessionId === "string") {
    const expiresAt = typeof token.exp === "number" ? token.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;
    await revokeSession(token.sessionId, expiresAt);
  }
  if (token && typeof token.username === "string") {
    const ip = request.get("x-forwarded-for")?.split(",")[0].trim() || request.get("x-real-ip") || null;
    try {
      await endIdentitySessionsOfBrowser(token.username, { userAgent: request.get("user-agent") || "", ip });
    } catch (error) {
      console.warn("Signing out of the identity provider failed:", error instanceof Error ? error.message : error);
    }
  }
  await signOut({ redirect: false });
}
