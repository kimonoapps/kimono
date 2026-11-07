import { auth } from "@/auth";
import { crossSite, readLimited } from "@/lib/api-v1";
import { issueCode, redirectWith } from "@/lib/notes/mcp-oauth";
import { authorizationRequest, noStore, oauthDb } from "@/lib/notes/mcp-server";

/** The person's answer on the authorize page: the app goes back with a code, or with access_denied. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const session = await auth();
  if (!session?.user?.username) return new Response("Sign in to Kimono first.", { status: 401, headers: noStore });
  const bytes = await readLimited(request, 16 * 1024);
  if (!bytes || request.headers.get("content-type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded") return new Response("That request isn't right.", { status: 400, headers: noStore });
  const params = new URLSearchParams(new TextDecoder().decode(bytes));
  const asked = await authorizationRequest(params);
  if ("show" in asked) return new Response(asked.show, { status: 400, headers: noStore });
  const to = "back" in asked
    ? redirectWith(asked.back, { error: asked.error, error_description: asked.description, state: asked.state, iss: asked.issuer })
    : params.get("decision") !== "allow"
      ? redirectWith(asked.redirectUri, { error: "access_denied", error_description: "The request was declined.", state: asked.state, iss: asked.issuer })
      : redirectWith(asked.redirectUri, {
        code: issueCode(oauthDb(), { clientId: asked.client.id, username: session.user.username, redirectUri: asked.redirectUri, challenge: asked.challenge, resource: asked.resource }),
        state: asked.state, iss: asked.issuer,
      });
  return new Response(null, { status: 303, headers: { Location: to, ...noStore } });
}
