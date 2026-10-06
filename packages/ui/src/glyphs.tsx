import { type ReactNode } from "react";

/**
 * 紋 Mon — the glyph at the centre of an app's bloom.
 *
 * Drawn on the bloom's own 100×100 field, centred on (50, 50), so the same
 * glyph works in a launcher tile and in a header lockup with only a scale
 * between them. Strokes are round and even: these are read at 20px, where a
 * thin line and a sharp corner both disappear.
 */
export type GlyphName = "mesh" | "notes" | "play" | "image" | "shield" | "bloom" | "git" | "server" | "tools";

const glyphs: Record<GlyphName, ReactNode> = {
  git: <>
    <path d="M40 40v20M60 40v3c0 10-20 5-20 14" />
    <circle cx="40" cy="36" r="4" /><circle cx="60" cy="36" r="4" /><circle cx="40" cy="64" r="4" />
  </>,
  server: <>
    <rect x="35" y="35" width="30" height="12" rx="2" />
    <rect x="35" y="53" width="30" height="12" rx="2" />
    <path d="M41 41h1M49 41h10M41 59h1M49 59h10" />
  </>,
  tools: <>
    <path d="m38 62 15-15M52 35a10 10 0 0 0-9 14l8 8a10 10 0 0 0 14-9l-7 4-9-9Z" />
    <path d="m38 54-5 5 8 8 5-5" />
  </>,
  /* Three devices, each reaching the others directly — the mesh itself. */
  mesh: <>
    <path d="M50 38 L38 60 M50 38 L62 60 M38 60 L62 60" fill="none" strokeWidth="4.5" strokeLinecap="round" />
    <circle cx="50" cy="37" r="6" />
    <circle cx="37" cy="61" r="6" />
    <circle cx="63" cy="61" r="6" />
  </>,
  notes: <>
    <path d="M38 36 H62 V64 H38 Z" fill="none" strokeWidth="4.5" strokeLinejoin="round" />
    <path d="M45 45 H55 M45 53 H55" fill="none" strokeWidth="4.5" strokeLinecap="round" />
  </>,
  play: <path d="M43 36 L66 50 L43 64 Z" strokeWidth="4.5" strokeLinejoin="round" />,
  image: <>
    <path d="M36 38 H64 V62 H36 Z" fill="none" strokeWidth="4.5" strokeLinejoin="round" />
    <path d="M36 56 L46 46 L58 58" fill="none" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="57" cy="45" r="3.5" />
  </>,
  shield: <path d="M50 34 L64 40 V52 C64 60 57 65 50 67 C43 65 36 60 36 52 V40 Z" fill="none" strokeWidth="4.5" strokeLinejoin="round" />,
  /* The fallback: a small blossom heart, for an app that names no glyph. */
  bloom: <circle cx="50" cy="50" r="6" />,
};

/**
 * Renders a glyph in the current colour. `scale` fits it to the centre it sits
 * in — a tile's dark disc is roomy, a lockup's heart is not.
 */
export function Glyph({ name = "bloom", scale = 1, color }: {
  name?: GlyphName;
  scale?: number;
  color: string;
}) {
  return <g
    fill="none"
    stroke={color}
    strokeWidth="4.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    transform={scale === 1 ? undefined : `translate(50 50) scale(${scale}) translate(-50 -50)`}
  >
    {glyphs[name] ?? glyphs.bloom}
  </g>;
}
