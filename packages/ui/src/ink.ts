/*
 * 墨 Ink and wash — how Kimono draws its art and marks (design/specimens/13).
 *
 * A plum brush line that wobbles and breaks, over a watercolour wash that pools
 * at the rim. Ink is for marks only: blooms, crests, portraits, petals, rings
 * and blots. Controls, cards and text stay clean.
 *
 * Everything here is plain SVG markup, so the website and the SVG the Portal
 * hands the phone draw the same strokes. Filters are written as attributes on
 * the shapes inside an <svg>, never as CSS on the <svg> itself: Safari draws
 * an <svg> blank when CSS gives it an SVG filter.
 */

export const INK = "#4e2b37";

/** A small, seedable random source, so a mark is hand-drawn but stable between server and browser. */
export function inkRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}
export type InkRandom = () => number;
const between = (random: InkRandom, low: number, high: number) => low + random() * (high - low);

/** Mixes two #rrggbb colours. */
export function mixHex(a: string, b: string, t: number) {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const x = parse(a), y = parse(b);
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/**
 * The filters, with ids made unique per drawing: `brush` wobbles a line,
 * `fine` wobbles it less, `wash` bleeds a fill. Seeds vary per drawing.
 */
export function inkFilters(unique: string, seed = 4) {
  return `<filter id="ink-brush-${unique}" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="3" seed="${seed}" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="5"></feDisplacementMap></filter>`
    + `<filter id="ink-fine-${unique}" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".08" numOctaves="2" seed="${seed + 7}" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4"></feDisplacementMap></filter>`
    + `<filter id="ink-wash-${unique}" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".02 .06" numOctaves="3" seed="${seed + 5}" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="7" result="d"></feDisplacementMap><feGaussianBlur in="d" stdDeviation=".6"></feGaussianBlur></filter>`;
}

/** A wash: paper at the heart, the colour gathering towards the rim. */
export function washGradient(id: string, light: string, mid: string, deep: string, cy = "75%") {
  return `<radialGradient id="${id}" cx="50%" cy="${cy}" r="75%"><stop offset="0" stop-color="#fff8f4"></stop><stop offset=".5" stop-color="${light}"></stop><stop offset=".9" stop-color="${mid}"></stop><stop offset="1" stop-color="${deep}"></stop></radialGradient>`;
}

/** Attributes for a brush line: a little heavier or lighter each time, lifting off now and then. */
export function brushAttributes(random: InkRandom, unique: string, weight = 1, colour = INK) {
  return `fill="none" stroke="${colour}" stroke-width="${(between(random, 2.2, 3.2) * weight).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${between(random, 70, 120).toFixed(0)} ${between(random, 4, 9).toFixed(0)}" opacity=".85" filter="url(#ink-brush-${unique})"`;
}

/** An open brush ring round (50, 50): an ensō with a gap where the brush lifted. */
export function ringPath(random: InkRandom, radius: number, gap: number) {
  const a0 = between(random, 0, Math.PI * 2), a1 = a0 + Math.PI * 2 - gap;
  let d = "";
  for (let k = 0; k <= 40; k++) {
    const t = a0 + (a1 - a0) * k / 40, r = radius * between(random, .985, 1.015);
    d += (k ? "L" : "M") + (50 + r * Math.cos(t)).toFixed(1) + " " + (50 + r * Math.sin(t)).toFixed(1);
  }
  return d;
}

/** A watercolour puddle round (cx, cy): nine soft lobes, never a circle. */
export function blotPath(random: InkRandom, cx: number, cy: number, radius: number) {
  const n = 9, phase = between(random, 0, Math.PI * 2);
  const points = Array.from({ length: n }, (_, i) => {
    const t = i / n * Math.PI * 2 + phase, r = radius * between(random, .8, 1.08);
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  });
  const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let d = "M" + mid(points[n - 1], points[0]).map((v) => v.toFixed(1)).join(" ");
  for (let i = 0; i < n; i++) {
    const p = points[i], m = mid(p, points[(i + 1) % n]);
    d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  }
  return d + "Z";
}

/** A sakura petal, never the same twice: notched tip, narrow base, every point nudged. */
export function petalPathInk(random: InkRandom) {
  const w = between(random, .86, 1.08), notch = between(random, 7, 15), lean = between(random, -6, 6), curl = between(random, -5, 5);
  const P = (x: number, y: number) => (x + between(random, -1.8, 1.8)).toFixed(1) + " " + (y + between(random, -1.8, 1.8)).toFixed(1);
  return "M" + P(50, 94)
    + " C" + P(50 - 20 * w, 86) + " " + P(50 - 38 * w + curl, 62) + " " + P(50 - 34 * w + lean, 34)
    + " C" + P(50 - 30 * w + lean, 16) + " " + P(50 - 16 * w + lean, 7) + " " + P(43 + lean, 9)
    + " C" + P(46 + lean, 10) + " " + P(48 + lean, 8 + notch * .6) + " " + P(50 + lean * .6, 8 + notch)
    + " C" + P(52 + lean, 8 + notch * .6) + " " + P(54 + lean, 10) + " " + P(57 + lean, 9)
    + " C" + P(50 + 16 * w + lean, 7) + " " + P(50 + 30 * w + lean, 16) + " " + P(50 + 34 * w + lean, 34)
    + " C" + P(50 + 38 * w - curl, 62) + " " + P(50 + 20 * w, 86) + " " + P(50, 94) + "Z";
}

/** One whole inked petal as an <svg>, washed in `colour`. */
export function petalSvg(seed: number, colour = "#c75f78") {
  const random = inkRandom(seed), unique = `p${seed.toString(36)}`, d = petalPathInk(random);
  return `<svg viewBox="0 0 100 100" aria-hidden="true" style="overflow:visible"><defs>${inkFilters(unique, 3 + seed % 40)}${washGradient(`g-${unique}`, mixHex(colour, "#ffffff", .78), mixHex(colour, "#ffffff", .5), mixHex(colour, "#ffffff", .15), "80%")}</defs>`
    + `<path d="${d}" fill="url(#g-${unique})" filter="url(#ink-wash-${unique})" opacity=".95"></path><path d="${d}" ${brushAttributes(random, unique)}></path></svg>`;
}
