import type { DefaultSession } from "next-auth";
import type { KimonoRole } from "@kimono/app-sdk";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: KimonoRole;
      /** This one session, so signing everyone else out can keep it. */
      sessionId?: string;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    identityId?: string;
    username?: string;
    role?: KimonoRole;
    /** When this session signed in, in ms; older than the person's sign-out-everywhere time means refused. */
    signedInAt?: number;
    /** Identifies this one session so signing out can refuse it. */
    sessionId?: string;
  }
}
