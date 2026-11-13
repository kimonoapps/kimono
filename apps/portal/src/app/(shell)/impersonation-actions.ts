"use server";

import { auth, signOut } from "@/auth";
import { dismissImpersonations } from "@/lib/impersonation";
import { revokeSession } from "@/lib/session-epochs";

/** Ends this session as someone else. The identity provider's side is ended by the browser, which holds it. */
export async function stopImpersonating() {
  const session = await auth();
  if (!session?.user?.impersonatedBy) return;
  if (session.user.sessionId) await revokeSession(session.user.sessionId, Date.parse(session.expires) || Date.now() + 30 * 24 * 60 * 60 * 1000);
  await signOut({ redirect: false });
}

/** The person has read who signed in as them. */
export async function closeImpersonationNotice() {
  const session = await auth();
  const user = session?.user;
  if (!user?.username || user.impersonatedBy) return;
  await dismissImpersonations(user.username);
}
