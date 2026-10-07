import "server-only";

import { createHash } from "node:crypto";
import {
  endAllIdentitySessions,
  emailUsedByOther,
  endIdentitySession,
  listIdentitySessions,
  readIdentityProfile,
  setIdentityPassword,
  updateIdentityProfile,
  verifyIdentityPassword,
  type IdentitySessionSummary,
} from "./directory";
import { parsePasswordChange, parseProfileInput } from "./account-input";
import { picturePathFor, removePicture, storePicture } from "./pictures";
import { assertGuessesLeft, clearGuesses, recordWrongGuess } from "./attempts";
import { signOutEverywhere } from "./session-epochs";

/**
 * 己 The signed-in person's own account.
 *
 * The account pages and /api/v1/me are two doors onto these functions, so the
 * website and the phone app cannot disagree about what an account is or what
 * may change. The identity provider stays the record for names, emails and
 * sign-ins; Kimono keeps the pictures, because they are its to show.
 */

/** The shape /api/v1/me returns. The phone app reads exactly this. */
export type AccountProfile = {
  username: string;
  name: string;
  email: string;
  role: string;
  /** Absolute address of the picture, or null to show the initial instead. */
  picture: string | null;
};

export type AccountSession = IdentitySessionSummary;

type SessionUser = { username: string; name?: string | null; email?: string | null; role: string };

export function portalOrigin(): string {
  return (process.env.KIMONO_PORTAL_URL || process.env.AUTH_URL?.replace(/\/api\/auth\/?$/, "") || "http://localhost:3000").replace(/\/+$/, "");
}

const absolute = (path: string | null) => path ? `${portalOrigin()}${path}` : null;

export async function readAccount(user: SessionUser): Promise<AccountProfile> {
  const picture = absolute(await picturePathFor(user.username));
  try {
    const identity = await readIdentityProfile(user.username);
    return { username: identity.username, name: identity.name || user.username, email: identity.email, role: user.role, picture };
  } catch {
    /* The directory being unreachable should not blank the account page. */
    return { username: user.username, name: user.name?.trim() || user.username, email: user.email?.trim() || "", role: user.role, picture };
  }
}

/** The message a person sees when the account directory is down or refuses
 *  Kimono. The real cause goes to the log, where whoever runs Kimono looks. */
export const unreachable = "Your account can't be reached right now. Try again in a moment.";

async function reach<T>(what: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    console.warn(`Account ${what} failed:`, error instanceof Error ? error.message : error);
    throw new Error(unreachable);
  }
}

/**
 * Checks the person's current password, with a ceiling on wrong guesses so a
 * stolen session can't be used to find it.
 */
async function confirmPassword(user: SessionUser, password: unknown) {
  if (typeof password !== "string" || !password) throw new Error("Enter your current password.");
  assertGuessesLeft(user.username);
  const correct = await reach("password check", () => verifyIdentityPassword(user.username, password));
  if (!correct) {
    recordWrongGuess(user.username);
    throw new Error("Your current password isn't right.");
  }
  clearGuesses(user.username);
}

/**
 * Changes name or email. A new email needs the current password: the email is
 * where password resets go, so changing it is as sensitive as the password.
 */
export async function changeProfile(user: SessionUser, raw: unknown) {
  const change = parseProfileInput(raw);
  if (change.email !== undefined) {
    const current = await reach("read", () => readIdentityProfile(user.username));
    if (change.email === current.email.trim().toLowerCase()) delete change.email;
    else {
      await confirmPassword(user, (raw as { currentPassword?: unknown }).currentPassword);
      if (await reach("email check", () => emailUsedByOther(change.email as string, user.username))) throw new Error("Another account already uses that email.");
    }
  }
  if (change.name === undefined && change.email === undefined) return change;
  await reach("update", () => updateIdentityProfile(user.username, change));
  return change;
}

/* Kimono's own copy is the record. Telling the identity provider is a courtesy
   to the apps that read pictures from it, so a failure there is logged, not
   shown as a failed upload. */
async function shareWithIdentity(username: string, avatar: string | null) {
  try {
    await updateIdentityProfile(username, { avatar });
  } catch (error) {
    console.warn(`Could not copy ${username}'s picture to the identity provider:`, error instanceof Error ? error.message : error);
  }
}

export async function changePicture(user: SessionUser, upload: Uint8Array): Promise<string> {
  const url = absolute(await storePicture(user.username, upload)) as string;
  await shareWithIdentity(user.username, url);
  return url;
}

export async function clearPicture(user: SessionUser) {
  await removePicture(user.username);
  await shareWithIdentity(user.username, null);
}

export const listSessions = (user: SessionUser) => reach("session list", () => listIdentitySessions(user.username));
export const endSession = (user: SessionUser, id: string) => reach("sign-out", () => endIdentitySession(user.username, id));
/** Ends every sign-in, and refuses every Kimono session but the one asking. */
export async function endAllSessions(user: SessionUser) {
  await signOutEverywhere(user.username);
  return reach("sign-out", () => endAllIdentitySessions(user.username));
}

/**
 * Whether a password appears in known breaches, asked of Have I Been Pwned's
 * range API: only the first five characters of its SHA-1 leave the server.
 * If the service can't be reached the check is skipped, never failed.
 */
async function breached(password: string): Promise<boolean> {
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, { headers: { "Add-Padding": "true" }, cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
    const suffix = hash.slice(5);
    return (await response.text()).split("\n").some((line) => {
      const [candidate, count] = line.trim().split(":");
      return candidate === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}

/** Changes the signed-in person's password. Returns how many other sign-ins were ended. */
export async function changePassword(user: SessionUser, raw: unknown): Promise<{ ended: number; signedOutOthers: boolean }> {
  const change = parsePasswordChange(raw, { username: user.username, name: user.name });
  await confirmPassword(user, change.current);
  if (await breached(change.next)) throw new Error("That password has appeared in a data leak. Choose another.");
  await reach("password change", () => setIdentityPassword(user.username, change.next));
  const ended = change.signOutOthers ? await endAllSessions(user) : 0;
  return { ended, signedOutOthers: change.signOutOthers };
}
