import type { AppIdentity } from "@kimono/ui";
import { bloomSvg } from "@kimono/ui/bloom-svg";
import type { Metadata } from "next";

/*
 * An app's tab icon is its bloom from the one renderer — the drawing the
 * launcher shows and the phone apps get from /api/v1/apps — so a tab can't
 * drift from the tile. Smaller sizes only widen the heart so the glyph stays
 * legible; 180px sits on paper for the home screen, where iOS rounds the
 * corners itself.
 */

export type FaviconSize = "tiny" | "small" | "large";

/* heart radius, glyph scale */
const heartAt: Record<FaviconSize, [number, number]> = { tiny: [28, 1], small: [23, .82], large: [20, .72] };

export function appFaviconSvg(app: Pick<AppIdentity, "id" | "accent" | "glyph">, size: FaviconSize): string {
  const [centre, glyphScale] = heartAt[size];
  const bloom = bloomSvg(app, { centre, glyph: app.glyph ?? "bloom", glyphScale, standalone: true, unique: `${app.id}-${size}` })
    .replace(' width="100" height="100"', ' viewBox="0 0 100 100"').replace(' viewBox="0 0 100 100" viewBox="0 0 100 100"', ' viewBox="0 0 100 100"');
  if (size !== "large") return bloom;
  const inner = bloom.slice(bloom.indexOf(">") + 1, bloom.lastIndexOf("</svg>"));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f7f1e8"/><g transform="translate(50 50) scale(.8) translate(-50 -50)">${inner}</g></svg>`;
}

/** The apps with a tab icon of their own, by the name in /app-icon/<name>/. */
export const faviconApps = ["drive", "notes", "books", "ai", "watch", "vpn", "tools"] as const;
export type FaviconApp = (typeof faviconApps)[number];

/** A page's `icons`, pointing at its app's icon (app/app-icon/[app]/[file]/route.ts). */
export function appIcons(app: FaviconApp): Metadata["icons"] {
  const base = `/app-icon/${app}`;
  return {
    icon: [
      { url: `${base}/icon.svg`, type: "image/svg+xml" },
      { url: `${base}/48.png`, sizes: "48x48", type: "image/png" },
      { url: `${base}/32.png`, sizes: "32x32", type: "image/png" },
      { url: `${base}/16.png`, sizes: "16x16", type: "image/png" },
    ],
    apple: { url: `${base}/180.png`, sizes: "180x180" },
  };
}
