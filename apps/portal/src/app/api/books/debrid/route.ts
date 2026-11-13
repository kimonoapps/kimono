import { timingSafeEqual } from "node:crypto";
import { getPlatformSettings } from "@/lib/settings";
import { watchConfig } from "@/lib/watch/config";

export const dynamic = "force-dynamic";

/**
 * The Books indexer pulls Anna's Archive's metadata torrents through Watch's
 * Real-Debrid account. It asks for the key here, on the server's own network,
 * with the key the two share; nothing else can read it.
 */
export async function GET(request: Request) {
  const shared = process.env.KIMONO_BOOKS_KEY?.trim() || "";
  const given = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1] || "";
  if (!shared || given.length !== shared.length || !timingSafeEqual(Buffer.from(given), Buffer.from(shared))) {
    return new Response(null, { status: 401 });
  }
  const { debrid } = watchConfig(await getPlatformSettings());
  if (debrid.service !== "realdebrid" || !debrid.key) return Response.json({ error: "Watch has no Real-Debrid account" }, { status: 404 });
  return Response.json({ service: debrid.service, key: debrid.key }, { headers: { "cache-control": "no-store" } });
}
