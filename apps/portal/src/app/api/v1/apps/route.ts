import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { appRegistry, launcherApps } from "@/lib/apps";
import { scanAppDefinitions } from "@/lib/definitions";
import { holdsMeshAccess } from "@/lib/directory";
import { getPlatformSettings } from "@/lib/settings";

/* Built into the Kimono apps themselves, or not wanted on a phone. */
const notListed = new Set(["kimono-tools"]);

/**
 * The person's other Kimono apps, for the Kimono apps' "More Kimono apps":
 * where each lives on the web, and its own phone app when it has one. The
 * same list as the Portal's launcher.
 */
export async function GET(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const [settings, catalog] = await Promise.all([getPlatformSettings(), scanAppDefinitions()]);
  const origin = new URL(request.url).origin;
  const apps = launcherApps(appRegistry(settings, catalog.definitions), { mesh: await holdsMeshAccess(user.username) })
    .filter((app) => !notListed.has(app.id))
    .map((app) => ({
      id: app.id,
      name: app.name,
      shortName: app.shortName,
      description: app.description,
      accent: app.accent,
      icon: app.iconUrl ? new URL(app.iconUrl, origin).toString() : null,
      web: new URL(app.href, origin).toString(),
      ios: app.mobileApp?.iosUrl ?? null,
      android: app.mobileApp?.androidUrl ?? null,
    }));
  return apiJson({ apps });
}
