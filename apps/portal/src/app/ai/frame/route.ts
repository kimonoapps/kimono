import { frameHeaders, frameHtml } from "@kimono/artifacts/frame";
import { portalOrigin } from "@/lib/account";

/* The frame an artifact is shown in: packages/artifacts/src/frame.ts. */

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const origin = portalOrigin() || new URL(request.url).origin;
  return new Response(frameHtml(origin), { headers: frameHeaders(origin) });
}
