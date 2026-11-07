import { resourceMetadata } from "@/lib/notes/mcp-oauth";
import { notesOn, originOf } from "@/lib/notes/mcp-server";

/** Protected resource metadata (RFC 9728) for the MCP server at /mcp. */
export async function GET(request: Request) {
  if (!await notesOn()) return new Response(null, { status: 404 });
  return Response.json(resourceMetadata(await originOf(request)), { headers: { "Cache-Control": "public, max-age=300" } });
}
