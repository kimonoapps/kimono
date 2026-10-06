import { getAppDefinition } from "@/lib/definitions";
import { getPlatformSettings } from "@/lib/settings";
import { openApiDocument } from "@/lib/tool-apis/openapi";
export const dynamic = "force-dynamic";
export async function GET() {
  const [definition, settings] = await Promise.all([getAppDefinition("kimono-tools"), getPlatformSettings()]);
  const instance = settings.apps["kimono-tools"];
  if (!instance?.enabled || !definition || definition.spec.setupReady === false) return Response.json({ error: { code: "api_disabled", message: "Kimono Tools is disabled." } }, { status: 404 });
  return Response.json(openApiDocument(definition.spec.apiCollection || [], instance), { headers: { "Cache-Control": "no-store" } });
}
