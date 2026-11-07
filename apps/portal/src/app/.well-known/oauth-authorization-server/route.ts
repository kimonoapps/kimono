import { portalOrigin } from "@/lib/account";
import { serverMetadata } from "@/lib/notes/mcp-oauth";
import { notesOn, originOf } from "@/lib/notes/mcp-server";

/** Authorization server metadata (RFC 8414) for signing MCP clients in to Notes. */
export async function GET(request: Request) {
  if (!await notesOn()) return new Response(null, { status: 404 });
  return Response.json(serverMetadata(await originOf(request), portalOrigin()), { headers: { "Cache-Control": "public, max-age=300" } });
}
