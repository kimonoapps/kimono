import { mainApp, myTestflight } from "@/lib/testflight";
import { isStuck } from "@/lib/testflight-plan";

export type Standing = "tester" | "stuck" | "invited" | "waiting" | "requested" | "declined" | "problem" | "none" | "idle";

/** A person's TestFlight status for one app, as the website and the phone app explain it. */
export function standing(status: string | undefined): Standing {
  if (!status || status === "not requested") return "idle";
  if (status === "awaiting approval") return "requested";
  if (status === "declined") return "declined";
  if (status === "invite expired" || status === "tester (not accepted)") return "stuck";
  if (status === "tester" || status === "added") return "tester";
  if (isStuck(status)) return "invited";
  if (status.startsWith("error")) return "problem";
  if (status === "no email") return "none";
  return "waiting";
}

/**
 * Which of the website's steps someone is on: asking (until Apple's team
 * invite is out), accepting the App Store Connect invite, accepting
 * TestFlight's own invite, or in.
 */
export type Stage = "ask" | "team" | "testflight" | "in";
export function stage(status: string | undefined): Stage {
  if (status === "invited (waiting to accept)" || status === "invite expired") return "team";
  if (status === "added" || status === "tester (not accepted)") return "testflight";
  if (status === "tester") return "in";
  return "ask";
}

/** What the TestFlight endpoints answer: the Kimono app's standing first (as before), then every iPhone app's. */
export async function answer(username: string) {
  const mine = await myTestflight(username);
  const apps = (mine?.apps ?? []).map((app) => ({ bundleId: app.bundleId, name: app.name, status: standing(app.status), stage: stage(app.status) }));
  return { status: apps.find((app) => app.bundleId === mainApp)?.status ?? "idle", email: mine?.email ?? null, apps };
}
