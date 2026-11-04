import "server-only";

import { portalOrigin } from "./account";
import { readReleases } from "./app-releases";
import { testflightSettings } from "./testflight";

/** What a phone is offered: the Android package, whether iPhones can join TestFlight, and this Kimono's address when the app needs telling. */
export type AppOffer = {
  android: { version: string; build: number; size: number | null } | null;
  ios: boolean;
  address: string | null;
};

/** Where the Kimono app looks unless told otherwise. */
const appDefault = ["www.kimonolabs.dev", "kimonolabs.dev"];

export async function appOffer(): Promise<AppOffer> {
  const [{ releases }, testflight] = await Promise.all([readReleases(), testflightSettings().catch(() => null)]);
  const newest = (platform: "android" | "ios") => releases.filter((r) => r.platform === platform).sort((a, b) => b.build - a.build)[0];
  const android = newest("android");
  const host = new URL(portalOrigin()).host;
  return {
    android: android ? { version: android.version, build: android.build, size: android.size ?? null } : null,
    /* Every iPhone is offered it once TestFlight is set up, so anyone can ask for their invite. */
    ios: Boolean(testflight || newest("ios")),
    address: appDefault.includes(host) ? null : host,
  };
}
