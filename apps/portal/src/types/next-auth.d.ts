import type { DefaultSession } from "next-auth";
import type { KimonoRole } from "@kimono/app-sdk";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: KimonoRole;
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
