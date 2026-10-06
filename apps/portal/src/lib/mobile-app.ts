export type MobileAppStep = {
  id: string;
  title: string;
  description: string;
  kind: "download" | "server" | "instruction";
};

export type MobileApp = {
  name: string;
  guideUrl: string;
  iosUrl?: string;
  androidUrl?: string;
  steps: (MobileAppStep | string)[];
};

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

export function validateMobileApp(value: unknown): asserts value is MobileApp {
  const app = value as MobileApp | null;
  const text = (value: unknown) => typeof value === "string" && Boolean(value.trim());
  const https = (value: unknown) => {
    if (typeof value !== "string") return false;
    try { return new URL(value).protocol === "https:"; } catch { return false; }
  };
  if (!app || !text(app.name) || !https(app.guideUrl) || !Array.isArray(app.steps) || !app.steps.length) throw new Error("spec.mobileApp requires a name, HTTPS guide URL, and tutorial steps");
  for (const link of [app.iosUrl, app.androidUrl]) {
    if (link !== undefined && !https(link)) throw new Error("mobile app download links must be HTTPS URLs");
  }
  const ids = new Set<string>();
  for (const step of mobileAppSteps(app)) {
    if (!step || !text(step.id) || ids.has(step.id) || !text(step.title) || !text(step.description) || !["download", "server", "instruction"].includes(step.kind)) throw new Error("mobile app steps require unique IDs, titles, descriptions, and a supported kind");
    if (step.kind === "download" && !app.iosUrl && !app.androidUrl) throw new Error("download steps require a store URL");
    ids.add(step.id);
  }
}
