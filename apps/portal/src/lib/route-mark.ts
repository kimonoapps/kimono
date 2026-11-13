/**
 * The proxy (proxy.ts) tells /api/v1 routes which route a bearer request is
 * for, so lib/api-v1.ts can limit what a Kimono Read device token reaches.
 * The key is made once per server process and never leaves it, so a client
 * can't send these headers itself.
 */
export const ROUTE_HEADER = "x-kimono-route";
export const ROUTE_KEY_HEADER = "x-kimono-route-key";

const g = globalThis as unknown as { kimonoRouteKey?: string };

export function routeKey(): string {
  return (g.kimonoRouteKey ??= crypto.randomUUID());
}
