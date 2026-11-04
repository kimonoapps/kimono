import "server-only";

import { listAccounts } from "../directory";
import { DriveProblem, type Role } from "./model";

/** People added to a space must have a Kimono account. */
export async function knownMembers(raw: unknown): Promise<{ username: string; role: Role }[]> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 200) throw new DriveProblem("Send members as a list.");
  const accounts = new Set((await listAccounts()).map((a) => a.username.toLowerCase()));
  return raw.map((m) => {
    const member = m as { username?: unknown; role?: unknown };
    if (typeof member.username !== "string" || !accounts.has(member.username.toLowerCase())) throw new DriveProblem(`There's no Kimono account called ${String(member.username)}.`);
    if (member.role !== "owner" && member.role !== "editor" && member.role !== "viewer") throw new DriveProblem("A member is an owner, an editor or a viewer.");
    return { username: member.username, role: member.role };
  });
}
