import type { AppIdentity, GlyphName } from "@kimono/ui";

/**
 * 内 Uchi — the apps Kimono writes itself.
 *
 * A first-party app is one entry here plus one page. The entry is its whole
 * identity: an id, a name, the word that follows the Kimono wordmark, the one
 * colour it owns, and the glyph at the heart of its bloom. Everything visible —
 * the launcher tile, the header lockup, the accent on its own name — is derived
 * from those five fields, so two apps cannot end up looking unrelated and
 * nobody has to draw anything.
 *
 * To add one:
 *   1. Add an entry below.
 *   2. Create `app/<path>/page.tsx` and render
 *      `<AppShell app={identityOf(app)}>` around the content.
 *   3. If it is not for everyone, give it an `available` check.
 *
 * There is deliberately no second way to do this.
 */
export type KimonoOwnApp = {
  id: string;
  /** Full name, used in prose and on the launcher tile. */
  name: string;
  /** The word after the Kimono wordmark: "VPN", "Photos". */
  shortName: string;
  /** One sentence: what this place is for. */
  description: string;
  /** Where it lives inside the Portal. */
  path: string;
  /**
   * The one colour it owns. Deliberately not Kimono's own sakura — an app that
   * borrows the house colour never reads as its own place.
   */
  accent: string;
  glyph: GlyphName;
  /** The mesh uses the existing appliance configuration. */
  configuration: "mesh";
  managementPath: string;
  /**
   * Whether this person may see it. Omit for an app everyone gets. The Portal
   * resolves these before building the launcher.
   */
  requires?: "mesh";
};

export const kimonoApps: readonly KimonoOwnApp[] = [
  {
    id: "kimono-vpn",
    name: "Kimono VPN",
    shortName: "VPN",
    description: "Your private mesh: the devices you have joined, and the people you let reach them.",
    path: "/vpn",
    accent: "#2f6b7a",
    glyph: "mesh",
    configuration: "mesh",
    managementPath: "/admin/vpn",
    requires: "mesh",
  },
];

export function ownApp(id: string): KimonoOwnApp {
  const app = kimonoApps.find((item) => item.id === id);
  if (!app) throw new Error(`${id} is not a Kimono app`);
  return app;
}

/** What the app shows of itself: its bloom, its lockup, its header. */
export function identityOf(app: KimonoOwnApp): AppIdentity {
  return { id: app.id, name: app.shortName, accent: app.accent, glyph: app.glyph };
}
