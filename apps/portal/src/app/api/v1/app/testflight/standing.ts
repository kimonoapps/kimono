import { isStuck } from "@/lib/testflight-plan";

export type Standing = "tester" | "stuck" | "invited" | "waiting" | "problem" | "none" | "idle";

/** A person's TestFlight status, as the website explains it. */
export function standing(status: string | undefined): Standing {
  if (!status || status === "not requested") return "idle";
  if (status === "invite expired" || status === "tester (not accepted)") return "stuck";
  if (status === "tester" || status === "added") return "tester";
  if (isStuck(status)) return "invited";
  if (status.startsWith("error")) return "problem";
  if (status === "no email") return "none";
  return "waiting";
}
