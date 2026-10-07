import { appClientId, appIssuer } from "@/lib/app-tokens";
import { apiError, apiJson } from "@/lib/api-v1";

/**
 * Where the phone app signs in. It asks this first, after the person types
 * their Kimono's address, so the app never has the identity provider's own
 * address built in. Nothing here is secret: it is the same as the provider's
 * public discovery document, narrowed to what the app needs.
 */
export async function GET() {
  const issuer = appIssuer();
  if (!issuer) return apiError(503, "Signing in from the app isn't set up on this Kimono yet.");
  return apiJson({ issuer, clientId: appClientId, scopes: ["openid", "profile", "email", "offline_access"] });
}
