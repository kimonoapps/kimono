import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { portalOrigin } from "@/lib/account";
import { code, db } from "@/lib/code";
import { connectLink, ConnectionProblem, connections, proApps } from "@/lib/code/composio";

/**
 * The apps this person has connected, whether connections are set up here at
 * all, and the apps that work as Pro Tools with nothing to connect (one they
 * connected uses their own account instead).
 */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return code(user, async (config) => {
    if (!config.composioKey) return apiJson({ available: false, connections: [], pro: [] });
    try {
      const [mine, pro] = await Promise.all([
        connections(db(), config.composioKey, user.username, portalOrigin()),
        proApps(config.composioKey),
      ]);
      const own = new Set(mine.filter((c) => c.status === "ACTIVE").map((c) => c.app));
      return apiJson({ available: true, connections: mine, pro: pro.filter((a) => !own.has(a.app)) });
    }
    catch (error) { if (error instanceof ConnectionProblem) return apiError(error.status, error.message); throw error; }
  }, false);
}

/** A link to connect an app: { app } → { url }. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return code(user, async (config) => {
    try { return apiJson({ url: await connectLink(db(), config.composioKey, user.username, portalOrigin(), String((read.body as { app?: unknown }).app ?? "")) }); }
    catch (error) { if (error instanceof ConnectionProblem) return apiError(error.status, error.message); throw error; }
  }, false);
}
