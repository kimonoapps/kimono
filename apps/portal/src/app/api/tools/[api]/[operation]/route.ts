import { getAppDefinition } from "@/lib/definitions";
import { getPlatformSettings } from "@/lib/settings";
import { authorizeApi } from "@/lib/tool-apis/access";
import { apiAdapters } from "@/lib/tool-apis/adapters";
import { ApiError } from "@/lib/tool-apis/mawaqit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ api: string; operation: string }> }) {
  try {
    const { api: id, operation } = await params;
    const [definition, settings] = await Promise.all([getAppDefinition("kimono-tools"), getPlatformSettings()]);
    const api = definition?.spec.apiCollection?.find((api) => api.id === id);
    const endpoint = api?.operations.find((item) => item.id === operation);
    if (!api || !endpoint || definition?.spec.setupReady === false) throw new ApiError(404, "unknown_endpoint", "Endpoint not found.");
    const credentials = authorizeApi(settings.apps["kimono-tools"], api, operation, request.headers.get("authorization"));
    const query = new URL(request.url).searchParams;
    for (const [key] of query) {
      if (!endpoint.parameters.some((parameter) => parameter.name === key) || query.getAll(key).length !== 1) throw new ApiError(400, "invalid_parameter", `Unknown or repeated parameter: ${key}`);
    }
    for (const parameter of endpoint.parameters) if (parameter.required && !query.get(parameter.name)?.trim()) throw new ApiError(400, "missing_parameter", `Missing parameter: ${parameter.name}`);
    const handler = apiAdapters[id]?.[operation];
    if (!handler) throw new ApiError(503, "api_not_configured", "Endpoint implementation is unavailable.");
    return Response.json(await handler(query, credentials), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof ApiError;
    return Response.json({ error: { code: known ? error.code : "internal_error", message: known ? error.message : "The API could not complete this request." } }, {
      status: known ? error.status : 500,
      headers: { "Cache-Control": "no-store", ...(known && error.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) },
    });
  }
}
