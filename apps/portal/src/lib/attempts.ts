import "server-only";

/**
 * A ceiling on guessing someone's current password through Kimono.
 *
 * Every check reaches the identity provider from the Portal's own address, so
 * the provider's per-address limits would lump all of Kimono together and
 * still let one stolen session guess freely. This counts wrong guesses per
 * account instead. It lives in memory: a restart clears it, which is fine for
 * a limit measured in minutes.
 */
const limit = 5;
const windowMs = 15 * 60 * 1000;
const failures = new Map<string, number[]>();

function recent(username: string, now: number) {
  const kept = (failures.get(username) || []).filter((at) => now - at < windowMs);
  if (kept.length) failures.set(username, kept); else failures.delete(username);
  return kept;
}

export const tooManyGuesses = "Too many wrong passwords. Try again in 15 minutes.";

export function assertGuessesLeft(username: string) {
  if (recent(username.toLowerCase(), Date.now()).length >= limit) throw new Error(tooManyGuesses);
}

export function recordWrongGuess(username: string) {
  const key = username.toLowerCase();
  failures.set(key, [...recent(key, Date.now()), Date.now()]);
}

export function clearGuesses(username: string) {
  failures.delete(username.toLowerCase());
}
