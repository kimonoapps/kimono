import { accentRamp } from "./accent";
import { inkFilters, inkRandom, mixHex, ringPath, washGradient } from "./ink";

/*
 * 家紋 Kamon — each Drive space's crest: one flower cut from paper in a ring,
 * in a colour its owner picks. Drawn here once, as SVG, for the website and
 * for the Portal to hand the phone apps, so a space looks the same wherever
 * it appears.
 */

export type CrestName = "sakura" | "ume" | "kikyo" | "kiku" | "hanabishi" | "nadeshiko" | "aoi";

type Shape = { d: string; turns: number[] };
const ring = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => offset + i * 360 / n);
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const once = (d: string): Shape => ({ d, turns: [0] });

export const crestKinds: Record<CrestName, { jp: string; name: string; ink: Shape[]; paper: Shape[] }> = {
  sakura: {
    jp: "桜", name: "Sakura",
    ink: [{ d: "M50 51 C41 45 36 35 38 26 C39 20 44 16 47 15 L50 21 L53 15 C56 16 61 20 62 26 C64 35 59 45 50 51Z", turns: ring(5) }],
    paper: [once(circle(50, 50, 4)), { d: circle(50, 41, 1.6), turns: ring(5, 36) }],
  },
  ume: {
    jp: "梅", name: "Ume",
    ink: [{ d: circle(50, 30, 12.5), turns: ring(5) }, once(circle(50, 50, 10))],
    paper: [once(circle(50, 50, 6))],
  },
  kikyo: {
    jp: "桔梗", name: "Kikyō",
    ink: [{ d: "M50 50 C40 41 35 29 39 21 L50 12 L61 21 C65 29 60 41 50 50Z", turns: ring(5) }],
    paper: [{ d: "M49.2 46 L49.2 22 L50.8 22 L50.8 46Z", turns: ring(5) }, once(circle(50, 50, 3.5))],
  },
  kiku: {
    jp: "菊", name: "Kiku",
    ink: [{ d: "M50 46 C46.5 37 46.5 22 50 13 C53.5 22 53.5 37 50 46Z", turns: ring(16) }, once(circle(50, 50, 9))],
    paper: [once(circle(50, 50, 6))],
  },
  hanabishi: {
    jp: "花菱", name: "Hanabishi",
    ink: [{ d: "M50 49 C42 42 38 31 42 22 L50 14 L58 22 C62 31 58 42 50 49Z", turns: ring(4, 45) }],
    paper: [{ d: "M50 23 L54 29 L50 35 L46 29Z", turns: ring(4, 45) }],
  },
  nadeshiko: {
    jp: "撫子", name: "Nadeshiko",
    ink: [{ d: "M50 50 L39 22 L42 17 L45 20.5 L47.5 15 L50 19 L52.5 15 L55 20.5 L58 17 L61 22Z", turns: ring(5) }],
    paper: [once(circle(50, 50, 4.5))],
  },
  aoi: {
    jp: "葵", name: "Aoi",
    ink: [{ d: "M50 49 C42 44 34 37 35 27 C36 18 45 16 50 23 C55 16 64 18 65 27 C66 37 58 44 50 49Z", turns: ring(3) }],
    paper: [{ d: "M49.3 44 L49.3 26 L50.7 26 L50.7 44Z", turns: ring(3) }],
  },
};

export const crestNames = Object.keys(crestKinds) as CrestName[];

/** The colours a crest can be: Kimono's plum first, then traditional dyes. */
export const crestColours = {
  plum: { jp: "葡萄", name: "Plum", hex: "#4e2b37" },
  suo: { jp: "蘇芳", name: "Sappanwood", hex: "#a84d63" },
  sakura: { jp: "桜", name: "Cherry", hex: "#c75f78" },
  fuji: { jp: "藤", name: "Wisteria", hex: "#7464a8" },
  ai: { jp: "藍", name: "Indigo", hex: "#2f4f80" },
  asagi: { jp: "浅葱", name: "Teal", hex: "#2c7783" },
  koke: { jp: "苔", name: "Moss", hex: "#5c7150" },
  kincha: { jp: "金茶", name: "Gold", hex: "#a8741f" },
} as const;

export type CrestColour = keyof typeof crestColours;
export const crestColourNames = Object.keys(crestColours) as CrestColour[];

/* Seeds from a string (FNV-1a), so a crest is brushed the same way everywhere. */
function seedOf(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

/**
 * A crest as SVG, painted in ink and wash (ink.ts): a disc washed in the
 * colour's pale, the flower laid on in the colour's ink with a slight
 * brushed wobble, and an open brush ring round it where the compass circle
 * was. Self-contained, so it draws the same in a page or on a phone; ids are
 * keyed by crest and colour, so the same crest twice on a page shares them.
 */
export function crestSvg(name: string, colour: string): string {
  const crestName = (name in crestKinds ? name : "sakura") as CrestName;
  const colourName = (colour in crestColours ? colour : "plum") as CrestColour;
  const kind = crestKinds[crestName];
  const ink = crestColours[colourName].hex;
  const paper = accentRamp(ink).tint;
  const unique = `crest-${crestName}-${colourName}`;
  const random = inkRandom(seedOf(unique));
  const draw = (shapes: Shape[]) => shapes.flatMap((shape) => shape.turns.map((turn) =>
    `<path d="${shape.d}"${turn ? ` transform="rotate(${turn} 50 50)"` : ""}></path>`)).join("");
  const ring = ringPath(random, 46.5, .18 + random() * .25);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" style="overflow:visible"><defs>${inkFilters(unique, 1 + seedOf(unique) % 60)}`
    + washGradient(`cw-${unique}`, mixHex(paper, "#ffffff", .55), paper, mixHex(paper, ink, .18), "62%")
    + `<radialGradient id="cf-${unique}" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="44"><stop offset="0" stop-color="${mixHex(ink, "#ffffff", .28)}"></stop><stop offset=".7" stop-color="${ink}"></stop><stop offset="1" stop-color="${mixHex(ink, "#000000", .12)}"></stop></radialGradient></defs>`
    + `<circle cx="50" cy="50" r="46" fill="url(#cw-${unique})" filter="url(#ink-wash-${unique})"></circle>`
    + `<g fill="url(#cf-${unique})" opacity=".96" filter="url(#ink-fine-${unique})">${draw(kind.ink)}</g>`
    + `<g fill="${paper}">${draw(kind.paper)}</g>`
    + `<path d="${ring}" fill="none" stroke="${ink}" stroke-width="3.6" stroke-linecap="round" stroke-dasharray="${(120 + random() * 60).toFixed(0)} ${(5 + random() * 5).toFixed(0)}" opacity=".88" filter="url(#ink-brush-${unique})"></path></svg>`;
}
