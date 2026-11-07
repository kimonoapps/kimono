import { clientFor, OAuthProblem, redeemCode, refreshTokens } from "@/lib/notes/mcp-oauth";
import { noStore, notesOn, oauthDb, oauthError, readForm } from "@/lib/notes/mcp-server";

/** The token endpoint: a code and its PKCE verifier, or a refresh token, for an access token and a new refresh token. */
export async function POST(request: Request) {
  if (!await notesOn()) return new Response(null, { status: 404 });
  try {
    const form = await readForm(request);
    const clientId = form.get("client_id");
    if (!clientFor(oauthDb(), clientId)) throw new OAuthProblem("invalid_client", "That app isn't known here. Register it again.", 401);
    const resource = form.get("resource") ?? undefined;
    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      return Response.json(redeemCode(oauthDb(), { code: form.get("code") ?? undefined, clientId, redirectUri: form.get("redirect_uri"), verifier: form.get("code_verifier") ?? undefined, resource }), { headers: noStore });
    }
    if (grant === "refresh_token") {
      return Response.json(refreshTokens(oauthDb(), { refreshToken: form.get("refresh_token") ?? undefined, clientId, resource }), { headers: noStore });
    }
    throw new OAuthProblem("unsupported_grant_type", "Use authorization_code or refresh_token.");
  } catch (error) {
    return oauthError(error);
  }
}
