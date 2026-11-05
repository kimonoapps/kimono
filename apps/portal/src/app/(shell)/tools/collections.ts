import type { getAppDefinition } from "@/lib/definitions";
import type { PlatformSettings } from "@/lib/settings";
import { apiAccess } from "@/lib/tool-apis/access";
import { apiField } from "@/lib/tool-apis/catalog";

type Definition = NonNullable<Awaited<ReturnType<typeof getAppDefinition>>>;

/** The collections Tools shows: turned on, with at least one operation left open. */
export function toolCollections(settings: PlatformSettings, definition: Definition) {
  const instance = settings.apps["kimono-tools"];
  return (definition.spec.apiCollection || []).map(api => ({
    api, enabled: instance?.environment[apiField(api.id, "enabled")]?.value === "on",
    hasKey: !!instance?.environment[apiField(api.id, "caller_key")]?.value,
    access: Object.fromEntries(api.operations.map(op => [op.id, apiAccess(instance, api, op.id)])),
  })).filter(item => item.enabled).map(item => ({ ...item, api: { ...item.api, operations: item.api.operations.filter(op => item.access[op.id] !== "disabled") } })).filter(item => item.api.operations.length > 0);
}
