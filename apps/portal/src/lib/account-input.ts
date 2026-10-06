/**
 * What a person may change about themselves, checked the same way whether it
 * arrives from the account page or from the phone app's API call.
 */

export type ProfileInput = { name?: string; email?: string };

const control = /[\u0000-\u001f\u007f]/;
/* Deliberately loose: the address is confirmed by mail working, not by a pattern. */
const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseProfileInput(raw: unknown): ProfileInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Send a name or an email to change.");
  const input = raw as Record<string, unknown>;
  const result: ProfileInput = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string") throw new Error("Your name must be text.");
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!name) throw new Error("Your name can't be empty.");
    if (name.length > 80) throw new Error("Keep your name under 80 characters.");
    if (control.test(name)) throw new Error("Your name has a character Kimono can't show.");
    result.name = name;
  }
  if (input.email !== undefined) {
    if (typeof input.email !== "string") throw new Error("Your email must be text.");
    const email = input.email.trim().toLowerCase();
    if (email.length > 254 || !emailShape.test(email)) throw new Error("That doesn't look like an email address.");
    result.email = email;
  }
  if (result.name === undefined && result.email === undefined) throw new Error("Send a name or an email to change.");
  return result;
}

/** The letter shown when someone has no picture. */
export function initialOf(name: string | null | undefined, username?: string | null): string {
  const source = (name?.trim() || username?.trim() || "?");
  return Array.from(source)[0].toLocaleUpperCase();
}

export type PasswordChange = { current: string; next: string; signOutOthers: boolean };

export const passwordMinLength = 12;

/** The rules a new password must meet, as the form shows them while typing. */
export function passwordRules(next: string, person: { username: string; name?: string | null }) {
  const lower = next.toLowerCase();
  const names = [person.username, ...(person.name || "").split(/\s+/)].map((part) => part.trim().toLowerCase()).filter((part) => part.length >= 3);
  return {
    long: Array.from(next).length >= passwordMinLength,
    notName: !names.some((part) => lower.includes(part)),
  };
}

export function parsePasswordChange(raw: unknown, person: { username: string; name?: string | null }): PasswordChange {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Send your current and new password.");
  const input = raw as Record<string, unknown>;
  const current = typeof input.current === "string" ? input.current : "";
  const next = typeof input.next === "string" ? input.next : "";
  if (!current) throw new Error("Enter your current password.");
  if (!next) throw new Error("Enter a new password.");
  if (input.confirm !== undefined && input.confirm !== next) throw new Error("The new passwords don't match.");
  if (Array.from(next).length > 256) throw new Error("Keep your new password under 256 characters.");
  const rules = passwordRules(next, person);
  if (!rules.long) throw new Error(`Use at least ${passwordMinLength} characters.`);
  if (!rules.notName) throw new Error("Don't use your name or username in your password.");
  if (next === current) throw new Error("Choose a password you haven't been using.");
  return { current, next, signOutOthers: input.signOutOthers !== false };
}
