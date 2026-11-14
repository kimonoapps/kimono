import { glyphMarkup, type AppIdentity } from "@kimono/ui";
import type { Metadata } from "next";

/*
 * An app's tab icon: its blossom, flat in its own colour, with its glyph cut
 * out in paper. Not the launcher's ink bloom — at 16px that is pale petals
 * and a grey smudge — but the same flower and the same glyph, drawn heavier
 * the smaller it gets. 180px sits on paper with room around it, for the home
 * screen, where iOS rounds the corners itself.
 */

export type FaviconSize = "tiny" | "small" | "large";

const petal = "M50 48 C36 39 31 21 41 9 C45 4 50 2 50 2 C55 4 59 7 62 11 C69 22 63 39 50 48Z";
const petals = [0, 72, 144, 216, 288].map((turn) => `<path transform="rotate(${turn} 50 50)" d="${petal}"/>`).join("");
/* The glyph's scale and stroke at each size: bigger and bolder as the icon shrinks. */
const glyphAt: Record<FaviconSize, [number, number]> = { tiny: [1.18, 7.5], small: [0.95, 7], large: [0.8, 5.5] };

export function appFaviconSvg(app: Pick<AppIdentity, "accent" | "glyph">, size: FaviconSize): string {
  const [scale, stroke] = glyphAt[size];
  /* The glyphs set their own 4.5 stroke for the launcher; here the size decides. */
  const glyph = (glyphMarkup[app.glyph ?? "bloom"] ?? glyphMarkup.bloom).replaceAll(' stroke-width="4.5"', "");
  const flower = `<g transform="translate(50 53) scale(1.02) translate(-50 -50)" fill="${app.accent}">${petals}<circle cx="50" cy="50" r="24"/></g>`;
  const mark = `<g transform="translate(0 3)"><g fill="none" stroke="#fffaf2" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" transform="translate(50 50) scale(${scale}) translate(-50 -50)">${glyph}</g></g>`;
  const body = size === "large"
    ? `<rect width="100" height="100" fill="#f6f0e6"/><g transform="translate(50 50) scale(.78) translate(-50 -50)">${flower}${mark}</g>`
    : flower + mark;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
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
