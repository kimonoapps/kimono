import { revokeToken } from "@/lib/notes/mcp-oauth";
import { noStore, notesOn, oauthDb, oauthError, readForm } from "@/lib/notes/mcp-server";

/** Token revocation (RFC 7009): either token ends the app's access. */
export async function POST(request: Request) {
  if (!await notesOn()) return new Response(null, { status: 404 });
  try {
    const form = await readForm(request);
    revokeToken(oauthDb(), form.get("token") ?? undefined, form.get("client_id") ?? undefined);
    return new Response(null, { status: 200, headers: noStore });
  } catch (error) {
    return oauthError(error);
  }
}
