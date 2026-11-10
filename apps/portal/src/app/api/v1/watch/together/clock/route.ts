export const dynamic = "force-dynamic";

/**
 * The server's clock, `{ now }` in ms, for Watch Together screens to measure
 * their offset NTP-style. Nothing else is done first (no sign-in check), so
 * the answer leaves as soon as it can and the round trip stays even.
 */
export function GET() {
  return Response.json({ now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
