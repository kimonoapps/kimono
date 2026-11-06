/**
 * A person's role in Kimono, from their groups in the identity provider. The
 * one place this is decided: sign-in (auth.ts) and the mesh policy
 * (directory.ts) both read it here.
 */
export function roleFromGroups(groups: unknown) {
  if (!Array.isArray(groups)) return "member";
  if (groups.includes("authentik Admins")) return "owner";
  if (groups.includes("kimono-owner")) return "owner";
  if (groups.includes("kimono-admin")) return "admin";
  if (groups.includes("kimono-guest")) return "guest";
  return "member";
}

export const isAdministrator = (groups: unknown) => ["owner", "admin"].includes(roleFromGroups(groups));
