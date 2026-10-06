import { createHash, timingSafeEqual } from "node:crypto";
import { apiField, type ToolApi } from "./catalog";
import type { AppInstance } from "../settings";
import { ApiError } from "./mawaqit";

export function apiAccess(instance: AppInstance | undefined, api: ToolApi, operation: string): "disabled" | "public" | "api-key" {
  const value = instance?.environment[apiField(api.id, `${operation}_access`)]?.value;
  return value === "public" || value === "api-key" ? value : "disabled";
}

export function authorizeApi(instance: AppInstance | undefined, api: ToolApi, operation: string, authorization: string | null) {
  if (!instance?.enabled || instance.environment[apiField(api.id, "enabled")]?.value !== "on") throw new ApiError(404, "api_disabled", "API is disabled.");
  const access = apiAccess(instance, api, operation);
  if (access === "disabled") throw new ApiError(404, "endpoint_disabled", "Endpoint is disabled.");
  if (access === "api-key") {
    const expected = instance.environment[apiField(api.id, "caller_key")]?.value;
    if (!expected || expected.length < 32) throw new ApiError(503, "api_not_configured", "API key access is not configured.");
    const provided = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1] || "";
    const hash = (value: string) => createHash("sha256").update(value).digest();
    if (!provided || provided.length > 4096 || !timingSafeEqual(hash(provided), hash(expected))) throw new ApiError(401, "invalid_api_key", "A valid bearer API key is required.");
  }
  const upstreamKey = instance.environment[apiField(api.id, "upstream_key")]?.value;
  if (api.upstreamAuth === "api-key" && !upstreamKey) throw new ApiError(503, "api_not_configured", "Upstream authentication is not configured.");
  return { upstreamKey };
}
