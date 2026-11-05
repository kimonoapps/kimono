import { apiError, apiJson, apiUser, readJson, unauthorized } from "@/lib/api-v1";
import { portalOrigin } from "@/lib/account";
import { code, db } from "@/lib/code";
import { connectLink, ConnectionProblem, connections } from "@/lib/code/composio";

/** The apps this person has connected, and whether connections are set up here at all. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async (config) => {
    if (!config.composioKey) return apiJson({ available: false, connections: [] });
    try { return apiJson({ available: true, connections: await connections(db(), config.composioKey, user.username, portalOrigin()) }); }
    catch (error) { if (error instanceof ConnectionProblem) return apiError(error.status, error.message); throw error; }
  }, false);
}

/** A link to connect an app: { app } → { url }. */
export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return code(user, async (config) => {
    try { return apiJson({ url: await connectLink(db(), config.composioKey, user.username, portalOrigin(), String((read.body as { app?: unknown }).app ?? "")) }); }
    catch (error) { if (error instanceof ConnectionProblem) return apiError(error.status, error.message); throw error; }
  }, false);
}
