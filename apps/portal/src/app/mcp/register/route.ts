import { readLimited } from "@/lib/api-v1";
import { OAuthProblem, registerClient } from "@/lib/notes/mcp-oauth";
import { noStore, notesOn, oauthDb, oauthError } from "@/lib/notes/mcp-server";

/** Dynamic client registration (RFC 7591): any MCP client may register; a person still has to allow it. */
export async function POST(request: Request) {
  if (!await notesOn()) return new Response(null, { status: 404 });
  try {
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new OAuthProblem("invalid_client_metadata", "Send the client's metadata as JSON.");
    const bytes = await readLimited(request, 16 * 1024);
    if (!bytes) throw new OAuthProblem("invalid_client_metadata", "That request is too large.", 413);
    let body: unknown;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new OAuthProblem("invalid_client_metadata", "Send the client's metadata as JSON."); }
    return Response.json(registerClient(oauthDb(), body), { status: 201, headers: noStore });
  } catch (error) {
    return oauthError(error);
  }
}
