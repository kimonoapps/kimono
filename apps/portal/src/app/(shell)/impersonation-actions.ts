"use server";

import { auth, signOut } from "@/auth";
import { railApps } from "@/components/app-shell";
import { dismissImpersonations, recordImpersonatedVisit } from "@/lib/impersonation";
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

const houseRooms: Record<string, string> = { admin: "Admin", account: "Account", "get-app": "Get the app" };

/** While signed in as someone, each place in Kimono that's opened is written down for them to see. */
export async function noteImpersonatedVisit(pathname: string) {
  const session = await auth();
  const user = session?.user;
  if (!user?.username || !user.impersonatedBy || typeof pathname !== "string" || !pathname.startsWith("/")) return;
  const path = pathname.split(/[?#]/)[0];
  const under = (base: string) => path === base || path.startsWith(`${base}/`);
  const app = (await railApps(user.username))
    .filter((item) => !item.external && item.href.startsWith("/") && item.href !== "/" && under(item.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const first = path.split("/")[1] || "";
  const place = app?.name || (first ? houseRooms[first] : "Home");
  if (!place) return;
  await recordImpersonatedVisit(user.username, user.impersonatedBy.username, place);
}
