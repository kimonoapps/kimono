/**
 * 色 Iro — one colour per app, everything else derived.
 *
 * An app declares a single accent. Its bloom, its lockup and its highlights all
 * come from that one value, so adding an app is choosing a colour rather than
 * assembling a palette — and no two apps can drift into looking alike by
 * picking overlapping triples.
 */

export type Accent = `#${string}`;

export type AccentRamp = {
  /** The declared colour. Used for the app's name and anything it marks. */
  accent: string;
  /** Petal tip — the lightest wash of the accent. */
  tint: string;
  /** Petal body: the accent itself, so the flower reads as the app's colour. */
  soft: string;
  /** Petal base and the heart. Also the app's name, so type matches petal. */
  deep: string;
  /** Legible against the accent, for a knocked-out mark. */
  contrast: string;
};

type Hsl = { h: number; s: number; l: number };

function toHsl(hex: string): Hsl {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > .5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r
    ? ((g - b) / d + (g < b ? 6 : 0))
    : max === g
      ? (b - r) / d + 2
      : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function toHex({ h, s, l }: Hsl): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - chroma / 2;
  const [r, g, b] = h < 60 ? [chroma, x, 0]
    : h < 120 ? [x, chroma, 0]
    : h < 180 ? [0, chroma, x]
    : h < 240 ? [0, x, chroma]
    : h < 300 ? [x, 0, chroma]
    : [chroma, 0, x];
  const channel = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function clamp(value: number, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Builds the ramp an app's artwork is drawn from. Lightness is pinned rather
 * than scaled, so a pale accent and a dark one still produce a bloom with the
 * same read — the hue changes, the structure does not.
 */
export function accentRamp(accent: string): AccentRamp {
  const base = toHsl(accent);
  const saturation = clamp(base.s, .18, .82);
  return {
    accent,
    tint: toHex({ h: base.h, s: clamp(saturation * .7, .16, .55), l: .9 }),
    /* Pinned at .62 so warm hues keep their chroma instead of reading tan. */
    soft: toHex({ h: base.h, s: clamp(saturation * .95, .3, .7), l: .62 }),
    deep: toHex({ h: (base.h + 6) % 360, s: clamp(saturation * 1.2, .42, .8), l: .32 }),
    contrast: base.l > .62 ? "#24221f" : "#fffdf8",
  };
}
