export type MobileAppStep = {
  id: string;
  title: string;
  description: string;
  kind: "download" | "server" | "open" | "instruction";
  /** For `open`: the link the phone opens. `{{server}}` becomes this app's address. */
  href?: string;
  /** For `open`: the button's wording. */
  label?: string;
};

export type MobileApp = {
  name: string;
  /** A setup guide, linked under every step. */
  guideUrl?: string;
  iosUrl?: string;
  androidUrl?: string;
  /**
   * The Android app's package (app.kimono.photos), so the Kimono phone app can
   * tell whether it's installed, and which version. Taken from a Play Store
   * link when there is one.
   */
  androidPackage?: string;
  /** The SHA-256 (hex) of an `.apk` androidUrl. The Kimono phone app installs only a package that matches it. */
  androidSha256?: string;
  steps: (MobileAppStep | string)[];
};

/** The Android package an app's phone app installs as, if known. */
export function androidPackageOf(app: MobileApp): string | null {
  if (app.androidPackage) return app.androidPackage;
  try { return app.androidUrl ? new URL(app.androidUrl).searchParams.get("id") : null; } catch { return null; }
}

/**
 * When Kimono hands out the Android app itself (a package link, not a store):
 * the package and its version, from the release's file name
 * (kimono-photos-3.1.0-kimono.1.apk). The Kimono phone app offers it as an
 * update to anyone on an older version. Only with the package's hash, which
 * it checks the download against.
 */
export function androidRelease(app: MobileApp): { url: string; version: string; sha256: string } | null {
  const url = app.androidUrl;
  const sha256 = app.androidSha256?.toLowerCase();
  if (!url || !/\.apk(\?|$)/.test(url) || !sha256) return null;
  const file = decodeURIComponent(url.split("?")[0].split("/").pop() ?? "");
  const version = /-(\d+\.\d+(?:\.\d+)?(?:[-+.][\w.]+)?)\.apk$/.exec(file)?.[1];
  return version ? { url, version, sha256 } : null;
}

export type MobileOS = "ios" | "android" | null;

/** Called on a launcher click, so server rendering never needs browser globals. */
export function detectMobileOS(device: { userAgent: string; platform: string; maxTouchPoints: number }): MobileOS {
  if (/Android/i.test(device.userAgent)) return "android";
  if (/iPad|iPhone|iPod/i.test(device.userAgent)) return "ios";
  // iPadOS can request desktop websites and identify itself as a Mac.
  if ((device.platform === "MacIntel" || /Macintosh/i.test(device.userAgent)) && device.maxTouchPoints > 1) return "ios";
  return null;
}

export function mobileAppSteps(app: MobileApp): MobileAppStep[] {
  return app.steps.map((step, index) => typeof step === "string" ? {
    id: `step-${index + 1}`,
    title: index === 0 ? "Download the app" : index === 1 ? "Connect to your server" : "Sign in",
    description: step,
    kind: index === 0 && (app.iosUrl || app.androidUrl) ? "download" : index === 1 ? "server" : "instruction",
  } : step);
}

/** An `open` step's link, with `{{server}}` filled in with the app's address (its origin). */
export function openLink(step: MobileAppStep, serverUrl: string): string {
  let origin = serverUrl;
  try { origin = new URL(serverUrl).origin; } catch { /* keep as given */ }
  return (step.href ?? "").replaceAll("{{server}}", encodeURIComponent(origin));
}

/** A download link is HTTPS, or a path on the Portal (such as its TestFlight guide). */
export function isPortalPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}

export function validateMobileApp(value: unknown): asserts value is MobileApp {
  const app = value as MobileApp | null;
  const text = (value: unknown) => typeof value === "string" && Boolean(value.trim());
  const https = (value: unknown) => {
    if (typeof value !== "string") return false;
    try { return new URL(value).protocol === "https:"; } catch { return false; }
  };
  if (!app || !text(app.name) || (app.guideUrl !== undefined && !https(app.guideUrl)) || !Array.isArray(app.steps) || !app.steps.length) throw new Error("spec.mobileApp requires a name and tutorial steps, and its guide URL must be HTTPS");
  if (app.androidPackage !== undefined && !/^[a-z][\w]*(\.[a-z][\w]*)+$/i.test(app.androidPackage)) throw new Error("spec.mobileApp.androidPackage must be an Android package name such as app.kimono.photos");
  if (app.androidSha256 !== undefined && !(typeof app.androidSha256 === "string" && /^[0-9a-f]{64}$/i.test(app.androidSha256))) throw new Error("spec.mobileApp.androidSha256 must be the package's SHA-256 in hex");
  for (const link of [app.iosUrl, app.androidUrl]) {
    if (link !== undefined && !https(link) && !(typeof link === "string" && isPortalPath(link))) throw new Error("mobile app download links must be HTTPS URLs or Portal paths");
  }
  /* An app's own scheme: never a web page, and never script. */
  const appLink = (value: unknown) => {
    if (typeof value !== "string") return false;
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
    return Boolean(scheme) && !["http", "https", "javascript", "data", "vbscript", "file", "blob"].includes(scheme!);
  };
  const ids = new Set<string>();
  for (const step of mobileAppSteps(app)) {
    if (!step || !text(step.id) || ids.has(step.id) || !text(step.title) || !text(step.description) || !["download", "server", "open", "instruction"].includes(step.kind)) throw new Error("mobile app steps require unique IDs, titles, descriptions, and a supported kind");
    if (step.kind === "download" && !app.iosUrl && !app.androidUrl) throw new Error("download steps require a store URL");
    if (step.kind === "open" && (!text(step.label) || !appLink(step.href))) throw new Error("open steps require a label and an app link such as myapp://connect?server={{server}}");
    ids.add(step.id);
  }
}
