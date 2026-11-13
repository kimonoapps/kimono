/*
 * 本 Pictures on a page. poppler says where raster images are, but a
 * drawing (a diagram, a map, a comic's panels) is only lines and fills. So
 * the page is drawn small in grey (pdf.ts), every patch of ink the text
 * doesn't explain is found, nearby patches are joined, and what's big
 * enough is a figure: its text (a diagram's labels, a balloon's words)
 * stays in the picture. Pure, so the tests can feed it a page of their own.
 */

export type Box = { x: number; y: number; w: number; h: number };
export type Ink = { w: number; h: number; data: Uint8Array };
export type Figure = Box & { raster: boolean };

/** Darker than this is ink; pale tints behind a sidebar aren't. */
const INK = 200;
/** Points: how close two patches must be to be one figure, and how big a figure must be. */
const REACH = 4, MIN_W = 36, MIN_H = 28;

const area = (b: Box) => b.w * b.h;
const overlaps = (a: Box, b: Box, pad = 0) => a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;
const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const intersection = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

export function figuresOf(ink: Ink | null, page: { width: number; height: number }, text: Box[], rasters: Box[]): Figure[] {
  const found: Figure[] = [];
  if (ink) {
    const s = ink.w / page.width; // pixels per point
    const W = ink.w, H = ink.h;
    /* Ink no text explains. */
    const explained = new Uint8Array(W * H);
    for (const t of text) {
      const x0 = Math.max(0, Math.floor((t.x - 1) * s)), x1 = Math.min(W - 1, Math.ceil((t.x + t.w + 1) * s));
      const y0 = Math.max(0, Math.floor((t.y - 1) * s)), y1 = Math.min(H - 1, Math.ceil((t.y + t.h + 1) * s));
      for (let y = y0; y <= y1; y++) explained.fill(1, y * W + x0, y * W + x1 + 1);
    }
    const loose = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (ink.data[i] < INK && !explained[i]) loose[i] = 1;
    /* Patches within REACH of each other are one: grow, then find connected parts. */
    const r = Math.max(1, Math.round(REACH * s));
    const grown = new Uint8Array(W * H);
    const rowRun = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      let last = -Infinity;
      for (let x = 0; x < W; x++) { if (loose[y * W + x]) last = x; if (x - last <= r) rowRun[y * W + x] = 1; }
      last = Infinity;
      for (let x = W - 1; x >= 0; x--) { if (loose[y * W + x]) last = x; if (last - x <= r) rowRun[y * W + x] = 1; }
    }
    for (let x = 0; x < W; x++) {
      let last = -Infinity;
      for (let y = 0; y < H; y++) { if (rowRun[y * W + x]) last = y; if (y - last <= r) grown[y * W + x] = 1; }
      last = Infinity;
      for (let y = H - 1; y >= 0; y--) { if (rowRun[y * W + x]) last = y; if (last - y <= r) grown[y * W + x] = 1; }
    }
    const seen = new Uint8Array(W * H);
    const stack: number[] = [];
    for (let i = 0; i < W * H; i++) {
      if (!grown[i] || seen[i]) continue;
      let x0 = W, y0 = H, x1 = 0, y1 = 0, inked = 0;
      const rows = new Set<number>(), cols = new Set<number>();
      stack.push(i); seen[i] = 1;
      while (stack.length) {
        const j = stack.pop()!;
        const x = j % W, y = (j - x) / W;
        if (loose[j]) { inked++; rows.add(y); cols.add(x); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x > 0 && grown[j - 1] && !seen[j - 1]) { seen[j - 1] = 1; stack.push(j - 1); }
        if (x < W - 1 && grown[j + 1] && !seen[j + 1]) { seen[j + 1] = 1; stack.push(j + 1); }
        if (y > 0 && grown[j - W] && !seen[j - W]) { seen[j - W] = 1; stack.push(j - W); }
        if (y < H - 1 && grown[j + W] && !seen[j + W]) { seen[j + W] = 1; stack.push(j + W); }
      }
      if (!inked) continue;
      const box = { x: x0 / s, y: y0 / s, w: (x1 - x0 + 1) / s, h: (y1 - y0 + 1) / s };
      if (box.w < MIN_W || box.h < MIN_H) continue; // rules, underlines, a bullet
      /* A ruled table: thin lines, ink on few of its rows or few of its columns. */
      if (rows.size < (y1 - y0 + 1) * 0.35 || cols.size < (x1 - x0 + 1) * 0.35) continue;
      /* A ruled table or a boxed text: mostly text inside thin lines. */
      const covered = text.reduce((n, t) => n + intersection(t, box), 0);
      const fill = inked / ((x1 - x0 + 1) * (y1 - y0 + 1));
      if (covered > area(box) * 0.3 && fill < 0.12) continue;
      found.push({ ...box, raster: false });
    }
  }
  /* Ink that is several raster images side by side (a comic's panels, a photo grid) is those images, not one. */
  const real = rasters.filter((r) => r.w >= 5 && r.h >= 5);
  for (let k = found.length - 1; k >= 0; k--) {
    const within = real.filter((r) => intersection(r, found[k]) >= area(r) * 0.8);
    if (within.length >= 2 && within.reduce((n, r) => n + area(r), 0) >= area(found[k]) * 0.6) found.splice(k, 1);
  }
  for (const r of real) found.push({ ...r, raster: true });
  /* Join what overlaps: a photo and its frame, a diagram's parts. */
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < found.length; i++) for (let j = i + 1; j < found.length; j++) {
      if (overlaps(found[i], found[j], 2)) {
        found[i] = { ...union(found[i], found[j]), raster: found[i].raster || found[j].raster };
        found.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  /* Clip to the page and drop slivers. */
  return found
    .map((f) => {
      const x = Math.max(0, f.x), y = Math.max(0, f.y);
      return { ...f, x, y, w: Math.min(page.width, f.x + f.w) - x, h: Math.min(page.height, f.y + f.h) - y };
    })
    .filter((f) => (f.raster && f.w >= 5 && f.h >= 5) || (f.w >= 12 && f.h >= 12))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Whether a text box sits inside a figure, so it's part of the picture. */
export const inside = (t: Box, f: Box) => intersection(t, f) >= area(t) * 0.6;
