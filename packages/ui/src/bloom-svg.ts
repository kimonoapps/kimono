import { type BloomIdentityInput } from "./bloom-identity";
import { inkBloomMarkup } from "./ink-bloom";
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
  const markup = `<svg viewBox="0 0 100 100" aria-hidden="true"><g>${inkBloomMarkup(input, centre, unique)}</g><g class="app-bloom-glyph" clip-path="url(#bloom-centre-clip-${unique})">${glyph ? glyphSvg(glyph, glyphScale, "#fffdf8") : ""}</g></svg>`;
  return standalone ? selfContained(markup) : markup;
}

/* app-identity.css, as attributes: what a page's stylesheet does for the glyph. */
const rules: Record<string, string> = {
  "app-bloom-glyph": `fill="#fffaf2" stroke="#fffaf2" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`,
};

function selfContained(markup: string): string {
  return markup
    .replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" `)
    .replace(/ aria-hidden="true"/, "")
    .replace(/class="([a-z-]+)"/g, (_, name: string) => rules[name] ?? "")
    .replace(/ {2,}/g, " ");
}
