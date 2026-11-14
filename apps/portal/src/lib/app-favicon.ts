import { glyphMarkup, type AppIdentity } from "@kimono/ui";
import { accentRamp } from "@kimono/ui/accent";
import { createBloomIdentity, petalPath } from "@kimono/ui/bloom-identity";
import { INK, mixHex } from "@kimono/ui/ink";
import type { Metadata } from "next";

/*
 * An app's tab icon: its bloom as the launcher draws it — pale petals in the
 * app's colours, outlined in plum, around a dark heart with the glyph in
 * paper — without the wash and brush texture, which at 16px is only blur.
 * Same seed, so the same flower turned the same way. Smaller sizes get a
 * bigger heart and heavier lines; 180px sits on paper for the home screen,
 * where iOS rounds the corners itself.
 */

export type FaviconSize = "tiny" | "small" | "large";

/* heart radius, outline, glyph scale, glyph stroke */
const drawn: Record<FaviconSize, [number, number, number, number]> = {
  tiny: [31, 5, 1.1, 5.5],
  small: [25, 4.5, .98, 6],
  large: [22, 3.2, .82, 5],
};

const HEART = "#3a2128";
const PAPER = "#fffaf2";

export function appFaviconSvg(app: Pick<AppIdentity, "id" | "accent" | "glyph">, size: FaviconSize): string {
  const [heart, outline, scale, stroke] = drawn[size];
  const bloom = createBloomIdentity(app);
  const ramp = accentRamp(app.accent);
  /* The wash, flattened: tips near the tint, alternate petals a shade deeper. */
  const fills = [mixHex(ramp.tint, ramp.soft, .25), mixHex(ramp.tint, ramp.soft, .55)];
  /* Petals reach the edge of the square; the outline stays inside it. */
  const reach = (100 - (size === "tiny" ? 2 : 1) * outline) / 94;
  const petal = (index: number, paint: string) => {
    const { rotation } = bloom.petals[index];
    return `<path transform="rotate(${rotation.toFixed(2)} 50 50) translate(50 50) scale(${reach.toFixed(3)}) translate(-50 -50)" d="${petalPath}" ${paint}/>`;
  };
  const each = [0, 1, 2, 3, 4];
  /* At 16px a line between every petal is a grid of grey: there the plum only
     traces the flower's silhouette, and the petals are one colour, a shade
     deeper so the app's colour still reads. */
  const petals = size === "tiny"
    ? each.map((i) => petal(i, `fill="${INK}" stroke="${INK}" stroke-width="${outline * 2}" stroke-linejoin="round"`)).join("")
      + each.map((i) => petal(i, `fill="${fills[1]}"`)).join("")
    : each.map((i) => petal(i, `fill="${fills[i % 2]}" stroke="${INK}" stroke-width="${outline}" stroke-linejoin="round" paint-order="stroke"`)).join("");
  const ring = size === "tiny" ? "" : ` stroke="${INK}" stroke-width="${outline * .6}"`;
  const flower = `<g transform="rotate(${bloom.rotation.toFixed(2)} 50 50)">${petals}</g><circle cx="50" cy="50" r="${heart}" fill="${HEART}"${ring}/>`;
  /* The glyphs set their own 4.5 stroke for the launcher; here the size decides. */
  const glyph = (glyphMarkup[app.glyph ?? "bloom"] ?? glyphMarkup.bloom).replaceAll(' stroke-width="4.5"', "");
  const mark = `<g fill="none" stroke="${PAPER}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" transform="translate(50 50) scale(${scale}) translate(-50 -50)">${glyph}</g>`;
  const body = size === "large"
    ? `<rect width="100" height="100" fill="#f7f1e8"/><g transform="translate(50 50) scale(.8) translate(-50 -50)">${flower}${mark}</g>`
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
