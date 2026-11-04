/*
 * 試 Who should be testing the Kimono iPhone app, and what to change so
 * they are. No network here: lib/testflight.ts reads App Store Connect,
 * asks this for the steps, and carries them out, so the rules can be
 * tested on their own.
 *
 * Everyone with an active Kimono account and an email becomes an internal
 * tester: invited to the App Store Connect team (internal testers must be
 * on it), then added to the Kimono group once they've accepted. When their
 * Kimono access ends, only people this Portal invited are taken off again,
 * never anyone else on the team.
 */

export type PlanAccount = {
  username: string;
  name: string;
  email: string | null;
  /** null when the directory couldn't say: never a reason to remove someone. */
  active: boolean | null;
};
export type PlanUser = { id: string; email: string; roles: string[] };
export type PlanInvitation = { id: string; email: string };
export type PlanTester = { id: string; email: string };
export type Invited = Record<string, { at: number; userId?: string; invitationId?: string }>;

export type Step =
  | { kind: "invite"; email: string; firstName: string; lastName: string }
  | { kind: "add"; email: string; firstName: string; lastName: string }
  | { kind: "removeInvitation"; email: string; invitationId: string }
  | { kind: "removeUser"; email: string; userId: string }
  | { kind: "forget"; email: string };

export type TesterStatus = { username: string; name: string; email: string | null; status: string };

/** The role the Portal gives the people it invites: it sees the Kimono app's page, and nothing that matters. */
export const invitedRole = "CUSTOMER_SUPPORT";

const clean = (email: string) => email.trim().toLowerCase();

/** "Mina Sato" → Mina / Sato; one word → that, and the username for the family name Apple asks for. */
export function nameParts(name: string, username: string): { firstName: string; lastName: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return { firstName: words[0], lastName: words.slice(1).join(" ") };
  return { firstName: words[0] || username, lastName: words.length === 1 && words[0] !== username ? username : "Kimono" };
}

export function planSync(input: {
  accounts: PlanAccount[];
  users: PlanUser[];
  invitations: PlanInvitation[];
  testers: PlanTester[];
  invited: Invited;
}): { steps: Step[]; statuses: TesterStatus[] } {
  const users = new Map(input.users.map((u) => [clean(u.email), u]));
  const invitations = new Map(input.invitations.map((i) => [clean(i.email), i]));
  const testers = new Set(input.testers.map((t) => clean(t.email)));
  const steps: Step[] = [];
  const statuses: TesterStatus[] = [];
  const wanted = new Set<string>();

  for (const account of input.accounts) {
    const email = account.email ? clean(account.email) : "";
    const row = (status: string) => statuses.push({ username: account.username, name: account.name, email: account.email, status });
    if (!email) { row("no email"); continue; }
    if (account.active === false) { if (!input.invited[email]) row("no Kimono access"); continue; }
    wanted.add(email);
    const names = nameParts(account.name, account.username);
    if (testers.has(email)) row("tester");
    else if (users.has(email)) { steps.push({ kind: "add", email, ...names }); row("added"); }
    else if (invitations.has(email)) row("invited (waiting to accept)");
    else { steps.push({ kind: "invite", email, ...names }); row("invited (waiting to accept)"); }
  }

  /* Only people this Portal invited ever leave, and only with the role it gave them. */
  for (const email of Object.keys(input.invited)) {
    if (wanted.has(email)) continue;
    const account = input.accounts.find((a) => a.email && clean(a.email) === email);
    if (account && account.active === null) continue;
    const invitation = invitations.get(email);
    const user = users.get(email);
    if (invitation) steps.push({ kind: "removeInvitation", email, invitationId: invitation.id });
    else if (user && user.roles.length > 0 && user.roles.every((role) => role === invitedRole)) steps.push({ kind: "removeUser", email, userId: user.id });
    else steps.push({ kind: "forget", email });
    if (account) statuses.push({ username: account.username, name: account.name, email: account.email, status: "removed" });
  }

  return { steps, statuses };
}
