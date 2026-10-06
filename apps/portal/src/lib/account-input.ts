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
