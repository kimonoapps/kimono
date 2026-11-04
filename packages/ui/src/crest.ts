import { accentRamp } from "./accent";

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

/**
 * A crest as SVG: the flower in the colour's ink on a wash of the same
 * colour, ringed in ink. Self-contained, so it draws the same in a page or
 * on a phone.
 */
export function crestSvg(name: string, colour: string): string {
  const kind = crestKinds[name as CrestName] ?? crestKinds.sakura;
  const ink = (crestColours[colour as CrestColour] ?? crestColours.plum).hex;
  const paper = accentRamp(ink).tint;
  const draw = (shapes: Shape[]) => shapes.flatMap((shape) => shape.turns.map((turn) =>
    `<path d="${shape.d}"${turn ? ` transform="rotate(${turn} 50 50)"` : ""}></path>`)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" fill="${paper}" stroke="${ink}" stroke-width="3.5"></circle><g fill="${ink}">${draw(kind.ink)}</g><g fill="${paper}">${draw(kind.paper)}</g></svg>`;
}
