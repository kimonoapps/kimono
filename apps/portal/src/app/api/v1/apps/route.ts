import { portalOrigin } from "@/lib/account";
import { androidPackageOf, androidRelease, mobileAppSteps, openLink } from "@/lib/mobile-app";
import { bloomSvg } from "@kimono/ui/bloom-svg";
import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { appRegistry, launcherApps } from "@/lib/apps";
import { driveConfig, driveIdentity } from "@/lib/drive/config";
import { scanAppDefinitions } from "@/lib/definitions";
import { holdsMeshAccess } from "@/lib/directory";
import { getPlatformSettings } from "@/lib/settings";
import { categorize } from "@/lib/app-categories";
import { withReleasedPhoneApp } from "@/lib/app-releases";
import { myApps } from "@/lib/my-apps";

/* Built into the Kimono apps themselves, or not wanted on a phone. */
const notListed = new Set(["kimono-tools", "kimono-drive"]);

/**
 * The person's other Kimono apps, for the Kimono apps' "More Kimono apps":
 * each with its bloom drawn by the website's own renderer, and Drive's too.
 * where each lives on the web, and its own phone app when it has one. The
 * same list as the Portal's launcher.
 */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  const [settings, catalog] = await Promise.all([getPlatformSettings(), scanAppDefinitions()]);
  /* The Portal's public address: behind the proxy, the request's own is the container's. */
  const origin = portalOrigin();
  /* Phone apps built with Kimono's release (Kimono Watch) take this release's package. */
  const opened = await Promise.all(launcherApps(appRegistry(settings, catalog.definitions), { mesh: await holdsMeshAccess(user.username) }).map(withReleasedPhoneApp));
  const apps = opened
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
  /* Every app this person can open, as the website's rail and Apps grid list them (railApps), for the phone's Apps tab. */
  const launcher = opened.map((app) => ({
    id: app.id,
    name: app.shortName,
    fullName: app.name,
    description: app.description,
    accent: app.accent,
    glyph: app.glyph ?? null,
    icon: app.iconUrl ? new URL(app.iconUrl, origin).toString() : null,
    /* Kimono's own apps live inside Kimono; the phone opens the ones it has natively. */
    own: !app.external,
    web: new URL(app.href, origin).toString(),
    ios: app.mobileApp?.iosUrl ? new URL(app.mobileApp.iosUrl, origin).toString() : null,
    android: app.mobileApp?.androidUrl ? new URL(app.mobileApp.androidUrl, origin).toString() : null,
    /* An app with a phone app of its own: how to get it and set it up, as the website's tutorial shows it. */
    phoneApp: app.mobileApp ? {
      name: app.mobileApp.name,
      guide: app.mobileApp.guideUrl ?? "",
      androidPackage: androidPackageOf(app.mobileApp),
      /* Kimono hands out this one itself: the version to be on, and where to get it. */
      release: androidRelease(app.mobileApp),
      steps: mobileAppSteps(app.mobileApp).map((step) => ({
        title: step.title, description: step.description, kind: step.kind,
        href: step.kind === "open" ? openLink(step, new URL(app.href, origin).toString()) : null, label: step.label ?? null,
      })),
    } : null,
  }));
  /* The phone apps have Drive themselves; this is its bloom for them, while it is switched on. */
  const driveOn = driveConfig(settings).enabled;
  const drive = driveOn ? await driveIdentity(settings) : null;
  return apiJson({
    apps,
    launcher,
    /* My apps, as on the website's rail (the phone skips any it can't open, and keeps them when it saves), and Home's groups. */
    myApps: await myApps(user.username),
    categories: categorize(opened).map((group) => ({ id: group.id, label: group.label, apps: group.apps.map((app) => app.id) })),
    driveOn,
    drive: drive ? { ...drive, bloom: bloomSvg(drive, { glyph: drive.glyph, standalone: true, unique: drive.id }) } : null,
  });
}
