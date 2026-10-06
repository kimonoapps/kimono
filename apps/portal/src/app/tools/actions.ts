"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getAppDefinition } from "@/lib/definitions";
import { getPlatformSettings, saveToolApiCallerKey } from "@/lib/settings";
import { apiField } from "@/lib/tool-apis/catalog";

export type KeyResult = { key?: string; error?: string; revoked?: boolean };

export async function manageApiKey(apiId: string, intent: "create" | "rotate" | "revoke"): Promise<KeyResult> {
  const session = await auth();
  if (!session?.user || !["owner", "admin"].includes(session.user.role)) return { error: "Only administrators can manage API keys." };
  if (!["create", "rotate", "revoke"].includes(intent)) return { error: "Unknown key action." };
  try {
    const definition = await getAppDefinition("kimono-tools");
    const settings = await getPlatformSettings();
    if (!definition || !settings.apps["kimono-tools"]?.enabled || !definition.spec.apiCollection?.some(api => api.id === apiId)) return { error: "This API is unavailable." };
    const configured = !!settings.apps["kimono-tools"].environment[apiField(apiId, "caller_key")]?.value;
    if (intent === "create" && configured) return { error: "This API already has a key. Choose Replace key to rotate it." };
    const key = intent === "revoke" ? null : randomBytes(32).toString("base64url");
    await saveToolApiCallerKey(definition, apiId, key);
    revalidatePath("/tools");
    revalidatePath(`/tools/${apiId}`);
    revalidatePath("/admin/apps/kimono-tools");
    return key ? { key } : { revoked: true };
  } catch { return { error: "The key could not be saved. Please try again." }; }
}
