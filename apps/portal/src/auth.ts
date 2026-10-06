import NextAuth from "next-auth";
import Authentik from "next-auth/providers/authentik";

const authentikIssuer = process.env.AUTHENTIK_ISSUER?.replace(/\/*$/, "/");

function roleFromGroups(groups: unknown) {
  if (!Array.isArray(groups)) return "member";
  if (groups.includes("authentik Admins")) return "owner";
  if (groups.includes("kimono-owner")) return "owner";
  if (groups.includes("kimono-admin")) return "admin";
  if (groups.includes("kimono-guest")) return "guest";
  return "member";
}

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
    jwt({ token, profile, trigger, session }) {
      /* An account edit refreshes the name and email the session carries, so
         the header changes at once rather than at the next sign-in. */
      if (trigger === "update" && session?.user) {
        if (typeof session.user.name === "string") token.name = session.user.name;
        if (typeof session.user.email === "string") token.email = session.user.email;
      }
      if (profile) {
        token.identityId = profile.sub;
        token.username = profile.preferred_username;
        token.role = roleFromGroups(profile.groups);
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.identityId ?? token.sub ?? "");
        session.user.username = String(token.username ?? "");
        session.user.role = String(token.role ?? "member") as typeof session.user.role;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
  trustHost: true,
});
