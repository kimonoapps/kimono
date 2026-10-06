import type { EnvironmentOverride } from "../settings";
import type { ConfigurationField } from "../definitions";

export type ApiParameter = { name: string; description: string; required?: boolean; example: string };
export type ToolApi = {
  id: string;
  name: string;
  description: string;
  source: string;
  upstreamAuth: "none" | "api-key";
  operations: Array<{
    id: string;
    name: string;
    description: string;
    parameters: ApiParameter[];
    response: string;
    example: Record<string, string>;
  }>;
};

export function apiField(api: string, suffix: string) {
  return `API_${api.replaceAll("-", "_").toUpperCase()}_${suffix.replaceAll("-", "_").toUpperCase()}`;
}

/** Registration produces configuration and documentation from the same contract. */
export function apiConfiguration(apis: ToolApi[]): ConfigurationField[] {
  return apis.flatMap((api) => [
    { key: apiField(api.id, "enabled"), label: `Enable ${api.name}`, kind: "toggle" as const, group: api.name, default: "off", description: "Allow calls to this API when Kimono Tools is enabled." },
    { key: apiField(api.id, "caller_key"), label: `${api.name} caller API key`, kind: "secret" as const, group: api.name, description: "At least 32 characters. Required for endpoints set to API key. Callers send Authorization: Bearer <key>. Leave blank to keep the saved key." },
    ...api.operations.map((operation): ConfigurationField => ({
      key: apiField(api.id, `${operation.id}_access`), label: `${operation.name} access`, kind: "select", group: api.name,
      options: ["disabled", "public", "api-key"], default: "disabled",
      description: "Disabled rejects calls. Public permits anonymous calls. API key requires this API's caller key.",
    })),
    ...(api.upstreamAuth === "api-key" ? [{ key: apiField(api.id, "upstream_key"), label: `${api.name} upstream API key`, kind: "secret" as const, group: api.name, description: "Credential sent to the upstream service, never returned to callers." }] : []),
  ]);
}

export function validateApiCollection(value: unknown): asserts value is ToolApi[] {
  if (!Array.isArray(value)) throw new Error("spec.apiCollection must be an array");
  const ids = new Set<string>();
  for (const api of value as ToolApi[]) {
    if (!api || !/^[a-z][a-z0-9-]*$/.test(api.id) || ids.has(api.id) || !api.name || !api.description || !api.source || !["none", "api-key"].includes(api.upstreamAuth) || !Array.isArray(api.operations) || !api.operations.length) throw new Error("Invalid or duplicate API registration");
    ids.add(api.id);
    const operations = new Set<string>();
    for (const operation of api.operations) {
      if (!operation || !/^[a-z][a-z0-9-]*$/.test(operation.id) || operations.has(operation.id) || !operation.name || !operation.description || !operation.response || !Array.isArray(operation.parameters) || !operation.example || typeof operation.example !== "object") throw new Error(`Invalid endpoint registration for ${api.id}`);
      operations.add(operation.id);
      const parameters = new Set<string>();
      for (const parameter of operation.parameters) {
        if (!parameter || !/^[a-z][a-z0-9_]*$/.test(parameter.name) || parameters.has(parameter.name) || !parameter.description || typeof parameter.example !== "string") throw new Error(`Invalid parameter registration for ${api.id}/${operation.id}`);
        parameters.add(parameter.name);
      }
    }
  }
}

export function validateApiSettings(apis: ToolApi[], environment: Record<string, { value: string }>) {
  for (const api of apis) {
    const key = environment[apiField(api.id, "caller_key")]?.value;
    if (key && (key.length < 32 || /\s/.test(key))) throw new Error(`${api.name}: caller keys must contain at least 32 characters without spaces`);
    if (environment[apiField(api.id, "enabled")]?.value !== "on") continue;
    if (api.operations.some((op) => environment[apiField(api.id, `${op.id}_access`)]?.value === "api-key") && !key) throw new Error(`${api.name}: configure a caller key before enabling protected endpoints`);
    if (api.upstreamAuth === "api-key" && !environment[apiField(api.id, "upstream_key")]?.value) throw new Error(`${api.name}: configure an upstream key before enabling this API`);
  }
}

/** Rotation keeps access rules; revocation closes only protected endpoints. */
export function callerKeyConfiguration(api: ToolApi, current: Record<string, EnvironmentOverride>, key: string | null) {
  const environment = { ...current };
  if (key) environment[apiField(api.id, "caller_key")] = { value: key, secret: true };
  else {
    delete environment[apiField(api.id, "caller_key")];
    for (const op of api.operations) if (environment[apiField(api.id, `${op.id}_access`)]?.value === "api-key") delete environment[apiField(api.id, `${op.id}_access`)];
  }
  return environment;
}
