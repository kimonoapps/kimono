/**
 * Copies that just failed. Some sources answer a play with a short clip
 * saying they're unavailable instead of the file (a resolver's "provider is
 * currently unavailable" video). The relay spots those (./streams.ts) and
 * marks the copy here for a few hours, so the next press of play picks
 * another and nobody sees the same failure twice.
 *
 * In memory: a restart forgets, which only means one more retry.
 */
const dead = new Map<string, number>();
const ttl = 6 * 60 * 60 * 1000;

export function markDead(url: string, now = Date.now()) {
  dead.set(url, now + ttl);
  if (dead.size > 5000) for (const [key, until] of dead) if (until < now) dead.delete(key);
}

export function isDead(url: string, now = Date.now()): boolean {
  const until = dead.get(url);
  if (until === undefined) return false;
  if (until < now) { dead.delete(url); return false; }
  return true;
}

export const forgetDead = () => dead.clear();

/**
 * Whether an answer is a stand-in clip, not the release: far smaller than the
 * release says it is (its whole size, from Content-Range or Content-Length),
 * or a resolver's well-known error video.
 */
export function isStandIn(finalUrl: string, totalBytes: number | null, expectedBytes: number | null): boolean {
  if (/\/(videos?|static|assets)\/[^/?#]*(fail|error|unavailable|limit|denied|invalid|not[-_]?found|blocked)[^/?#]*\.(mp4|mkv|webm)(?:$|[?#])/i.test(finalUrl)) return true;
  if (totalBytes === null) return false;
  if (totalBytes < 25 * 1024 * 1024 && (expectedBytes === null || expectedBytes > 200 * 1024 * 1024)) return true;
  return false;
}
