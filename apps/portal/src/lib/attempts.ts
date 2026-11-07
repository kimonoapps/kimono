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

/**
 * Counts a guess the moment it's made, before the answer comes back: guesses
 * sent all at once each see the ones before them, so they can't all slip under
 * the limit together. Returns how to take it back when the check never ran.
 */
export function takeGuess(username: string): () => void {
  const key = username.toLowerCase();
  const now = Date.now();
  const kept = recent(key, now);
  if (kept.length >= limit) throw new Error(tooManyGuesses);
  failures.set(key, [...kept, now]);
  return () => {
    const list = failures.get(key);
    const at = list?.indexOf(now) ?? -1;
    if (list && at >= 0) list.splice(at, 1);
    if (list && !list.length) failures.delete(key);
  };
}

export function clearGuesses(username: string) {
  failures.delete(username.toLowerCase());
}
