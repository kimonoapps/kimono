import NextAuth from "next-auth";
import Authentik from "next-auth/providers/authentik";
import { randomUUID } from "node:crypto";
import { honouredSince, isRevoked } from "@/lib/session-epochs";
import { readIdentityProfile, readStanding } from "@/lib/directory";
import { roleFromGroups } from "@/lib/roles";

const authentikIssuer = process.env.AUTHENTIK_ISSUER?.replace(/\/*$/, "/");

export { roleFromGroups };

export const { auth, handlers, signIn, signOut, unstable_update: updateSession } = NextAuth({
  providers: [
    Authentik({
      issuer: authentikIssuer,
      // Authentik's provider-specific discovery document reports an issuer with
      // a trailing slash. Supplying the document explicitly avoids Auth.js
      // producing a double slash while preserving exact issuer validation.
      wellKnown: authentikIssuer
        ? `${authentikIssuer}.well-known/openid-configuration`
        : undefined,
      clientId: process.env.AUTHENTIK_CLIENT_ID,
      clientSecret: process.env.AUTHENTIK_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, profile, trigger, session }) {
      if (profile) {
        token.signedInAt = Date.now();
        /* An ID for this one session, so signing out can refuse it by name. */
        token.sessionId = randomUUID();
        token.identityId = profile.sub;
        token.username = profile.preferred_username;
        token.role = roleFromGroups(profile.groups);
      }
      /* Signed out everywhere after this session began: it is no longer honoured. */
      if (typeof token.sessionId === "string" && await isRevoked(token.sessionId)) return null;
      const username = typeof token.username === "string" ? token.username : "";
      if (username && !await honouredSince(username, typeof token.signedInAt === "number" ? token.signedInAt : 0, typeof token.sessionId === "string" ? token.sessionId : undefined)) return null;
      /* An account edit refreshes the name and email the session carries, so
         the header changes at once rather than at the next sign-in. They are
         read again from the directory: what the browser sends is never used,
         since anyone holding the cookie can ask for an update. */
      if (trigger === "update" && username) {
        try {
          const fresh = await readIdentityProfile(username);
          token.name = fresh.name || token.name;
          token.email = fresh.email || token.email;
        } catch { /* the directory is down: keep what the session had */ }
      }
      /* The role and the account itself are re-read from the directory (cached
         for a minute): a deactivated account is signed out, and a role change
         lands without waiting for the cookie to expire. If the directory can't
         be reached the session keeps the role it signed in with, so an outage
         there never locks the owner out of Kimono. */
      if (username) {
        const standing = await readStanding(username);
        if (standing && !standing.active) return null;
        if (standing) token.role = roleFromGroups(standing.groups);
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.identityId ?? token.sub ?? "");
        session.user.username = String(token.username ?? "");
        session.user.role = String(token.role ?? "member") as typeof session.user.role;
        session.user.sessionId = typeof token.sessionId === "string" ? token.sessionId : undefined;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
  trustHost: true,
});
