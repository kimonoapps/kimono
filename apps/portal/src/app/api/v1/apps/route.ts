import { bloomSvg } from "@kimono/ui/bloom-svg";
import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { appRegistry, launcherApps } from "@/lib/apps";
import { driveConfig, driveIdentity } from "@/lib/drive/config";
import { scanAppDefinitions } from "@/lib/definitions";
import { holdsMeshAccess } from "@/lib/directory";
import { getPlatformSettings } from "@/lib/settings";

/* Built into the Kimono apps themselves, or not wanted on a phone. */
const notListed = new Set(["kimono-tools", "kimono-drive"]);

/**
 * The person's other Kimono apps, for the Kimono apps' "More Kimono apps":
 * each with its bloom drawn by the website's own renderer, and Drive's too.
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
      /* The mark at the centre of the app's bloom, as the launcher draws it; the icon file is for apps without one. */
      glyph: app.glyph ?? null,
      icon: app.iconUrl ? new URL(app.iconUrl, origin).toString() : null,
      /* The launcher's bloom, in the app's colours as set now, ready to draw. An app without a glyph shows its icon over it. */
      bloom: bloomSvg({ id: app.id, accent: app.accent }, { glyph: app.glyph, standalone: true, unique: app.id }),
      web: new URL(app.href, origin).toString(),
      ios: app.mobileApp?.iosUrl ?? null,
      android: app.mobileApp?.androidUrl ?? null,
    }));
  /* The phone apps have Drive themselves; this is its bloom for them, while it is switched on. */
  const driveOn = driveConfig(settings).enabled;
  const drive = driveOn ? await driveIdentity(settings) : null;
  return apiJson({
    apps,
    driveOn,
    drive: drive ? { ...drive, bloom: bloomSvg(drive, { glyph: drive.glyph, standalone: true, unique: drive.id }) } : null,
  });
}
