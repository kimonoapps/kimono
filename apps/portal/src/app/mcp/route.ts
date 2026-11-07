import { readLimited } from "@/lib/api-v1";
import { answerAll, knownProtocolHeader } from "@/lib/notes/mcp-protocol";
import { mcpUser, noStore, notesOn, originOf, runnerFor } from "@/lib/notes/mcp-server";

/**
 * Kimono Notes' MCP server, Streamable HTTP: JSON-RPC in each POST, answered
 * in JSON. Stateless, so there's no stream to open (GET) or session to end (DELETE).
 */
const rpcError = (status: number, message: string) => Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message } }, { status, headers: noStore });

export async function POST(request: Request) {
  if (!await notesOn()) return rpcError(404, "Notes isn't switched on.");
  const user = await mcpUser(request, await originOf(request));
  if (user instanceof Response) return user;
  if (!knownProtocolHeader(request.headers.get("mcp-protocol-version"))) return rpcError(400, "That MCP protocol version isn't spoken here.");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return rpcError(415, "Send JSON-RPC as application/json.");
  /* A note is at most 2 MB of text; escaped in JSON it can grow. */
  const bytes = await readLimited(request, 6 * 1024 * 1024);
  if (!bytes) return rpcError(413, "That request is too large.");
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "That isn't JSON." } }, { status: 400, headers: noStore });
  }
  try {
    const reply = await answerAll(body, runnerFor(user.username));
    if (!reply) return new Response(null, { status: 202, headers: noStore });
    return Response.json(reply, { headers: noStore });
  } catch (error) {
    console.warn("Notes MCP failed:", error instanceof Error ? error.message : error);
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Notes couldn't do that. Try again in a moment." } }, { status: 500, headers: noStore });
  }
}

const notOffered = () => new Response(null, { status: 405, headers: { Allow: "POST", ...noStore } });
export const GET = notOffered;
export const DELETE = notOffered;
