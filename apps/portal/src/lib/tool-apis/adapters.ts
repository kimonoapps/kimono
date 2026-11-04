import { executeMawaqit } from "./mawaqit";
import { executeRmp } from "./rmp";
import type { ToolApi } from "./catalog";

export type ApiHandler = (query: URLSearchParams, credentials: { upstreamKey?: string }) => Promise<unknown>;
export const apiAdapters: Record<string, Record<string, ApiHandler>> = {
  mawaqit: Object.fromEntries(["search", "calendar", "prayer-times"].map((operation) => [operation, (query: URLSearchParams) => executeMawaqit(operation, query)])),
  rmp: Object.fromEntries(["schools", "professor"].map((operation) => [operation, (query: URLSearchParams) => executeRmp(operation, query)])),
};

export function validateApiAdapters(apis: ToolApi[]) {
  for (const api of apis) for (const operation of api.operations) {
    if (!apiAdapters[api.id]?.[operation.id]) throw new Error(`API ${api.id}/${operation.id} has no registered implementation`);
  }
}
