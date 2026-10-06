import { apiAccess } from "./access";
import { apiField, type ToolApi } from "./catalog";
import type { AppInstance } from "../settings";

export function openApiDocument(apis: ToolApi[], instance: AppInstance) {
  return { openapi: "3.1.0", info: { title: "Kimono Tools", version: "0.1.0" },
    components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "The caller key configured for this API." } } },
    paths: Object.fromEntries(apis.filter(api => instance.enabled && instance.environment[apiField(api.id, "enabled")]?.value === "on").flatMap(api => api.operations.filter(op => apiAccess(instance, api, op.id) !== "disabled").map(op => [`/api/tools/${api.id}/${op.id}`, { get: {
      operationId: `${api.id}_${op.id}`, tags: [api.name], summary: op.name, description: op.description,
      "x-kimono-access": apiAccess(instance, api, op.id), "x-kimono-enabled": instance.enabled && instance.environment[apiField(api.id, "enabled")]?.value === "on",
      security: apiAccess(instance, api, op.id) === "public" ? [] : [{ apiKey: [] }],
      parameters: op.parameters.map(p => ({ name: p.name, in: "query", required: !!p.required, description: p.description, example: p.example, schema: { type: "string" } })),
      responses: { "200": { description: op.response, content: { "application/json": { schema: { type: "object" } } } }, "400": { description: "Invalid parameters" }, "401": { description: "Missing or invalid caller key" }, "404": { description: "API or endpoint disabled, unknown endpoint, or mosque not found" }, "502": { description: "Upstream unavailable or invalid response" }, "503": { description: "API configuration incomplete" } },
    } }]))),
  };
}
