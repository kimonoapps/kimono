import { createBloomIdentity, petalPath, veinPath, type BloomIdentityInput } from "./bloom-identity";
import { glyphSvg, type GlyphName } from "./glyphs";

/*
 * The bloom as a string of SVG: the same markup <BloomMark> renders, for
 * places React doesn't reach — the Portal's API hands it to the phone apps,
 * which draw it as it is rather than redrawing the flower themselves.
 * scripts/test-marks.mjs renders both and fails if they ever differ.
 */

export type BloomSvgOptions = {
  /** Radius of the heart. Larger leaves room for a glyph. */
  centre?: number;
  glyph?: GlyphName;
  /** The glyph's size in the heart: .72 in a launcher tile, .5 in a lockup. */
  glyphScale?: number;
  /** Makes the ids inside unique when several blooms share a page. */
  unique?: string;
  /**
   * Self-contained, for drawing outside a web page: the website's stylesheet
   * rules (app-identity.css) become attributes, and the plum is spelled out.
   */
  standalone?: boolean;
};

export function bloomSvg(input: BloomIdentityInput, options: BloomSvgOptions = {}): string {
  const { centre = 20, glyph, glyphScale = .72, unique = "b", standalone = false } = options;
  const identity = createBloomIdentity(input);
  const textureId = `bloom-texture-${unique}`;
  const centreClipId = `bloom-centre-clip-${unique}`;
  const gradients = identity.petals.map((petal, index) => `<linearGradient id="bloom-gradient-${unique}-${index}" x1="20" y1="12" x2="78" y2="90" gradientUnits="userSpaceOnUse"><stop stop-color="${petal.start}"></stop><stop offset=".5" stop-color="${petal.middle}"></stop><stop offset="1" stop-color="${petal.end}"></stop></linearGradient>`).join("");
  const petals = identity.petals.map((petal, index) => `<path d="${petalPath}" transform="rotate(${petal.rotation} 50 50) translate(50 50) scale(${petal.scale}) translate(-50 -50)" fill="url(#bloom-gradient-${unique}-${index})" opacity="${petal.opacity}"></path>`).join("");
  const veins = identity.petals.map((petal) => `<path class="app-bloom-vein" d="${veinPath}" transform="rotate(${petal.rotation} 50 50)"></path>`).join("");
  const markup = `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>${gradients}<filter id="${textureId}" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency=".03 .075" numOctaves="2" seed="${identity.textureSeed}" result="noise"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="noise" scale="${identity.textureScale}"></feDisplacementMap></filter><clipPath id="${centreClipId}"><circle cx="50" cy="50" r="${centre - 1}"></circle></clipPath></defs><g filter="url(#${textureId})" class="app-bloom-petals" transform="rotate(${identity.rotation} 50 50)">${petals}${veins}</g><circle class="app-bloom-centre-shadow" cx="50" cy="50" r="${centre + 3}" style="fill:${identity.centreShadow}"></circle><circle class="app-bloom-centre" cx="50" cy="50" r="${centre}" style="fill:${identity.centre}"></circle><g class="app-bloom-glyph" clip-path="url(#${centreClipId})">${glyph ? glyphSvg(glyph, glyphScale, "#fffdf8") : ""}</g></svg>`;
  return standalone ? selfContained(markup) : markup;
}

/* app-identity.css, as attributes: what a page's stylesheet does for the bloom. */
const plum = "#4e2b37";
const rules: Record<string, string> = {
  "app-bloom-petals": "",
  "app-bloom-vein": `fill="none" stroke="#ffffff" stroke-opacity=".32" stroke-width="1" stroke-linecap="round"`,
  "app-bloom-centre-shadow": `opacity=".9" transform="translate(0 2)"`,
  "app-bloom-centre": `stroke="#ffffff" stroke-opacity=".38" stroke-width="1.4"`,
  "app-bloom-glyph": `fill="#fffaf2" stroke="#fffaf2" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`,
};

function selfContained(markup: string): string {
  return markup
    .replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" `)
    .replace(/ aria-hidden="true"/, "")
    .replace(/class="([a-z-]+)"/g, (_, name: string) => rules[name] ?? "")
    .replace(/style="fill:([^"]+)"/g, (_, fill: string) => `fill="${fill.replace(/var\(--k-plum, ?(#[0-9a-f]{6})\)/i, "$1") || plum}"`)
    .replace(/ {2,}/g, " ");
}
