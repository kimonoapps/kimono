/*
 * Kimono's own tab icon: the plum branch on paper, as the phone app's icon,
 * drawn again for each size rather than shrunk — the blossom grows and the
 * stem thickens as the square gets smaller, and at 16px the two twigs go.
 * Writes public/brand/favicon.svg, favicon-16/32/48.png, favicon.ico and
 * apple-touch-icon.png. Run after changing the drawing:
 *
 *   node scripts/brand-favicons.mjs
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(import.meta.url)("sharp");
const out = join(here, "../public/brand");

const PLUM = "#4e2b37";
const GROUND = "#f7f1e8";
/* The branch as KimonoBranch draws it (packages/ui/src/bloom.tsx). */
const stem = "M2 108 C26 98 43 84 55 66 C62 55 71 47 79 43 L81 47 C73 51 66 60 59 72 C47 90 30 106 6 116Z";
const twigs = ["M56 69 C55 61 52 54 47 47 L50 44 C56 51 59 59 59.5 66Z", "M27 97 C40 96 51 100 58 108 L55 111 C49 104 39 100 27 100Z"];
const petal = "M50 48 C36 39 31 21 41 9 C45 4 50 2 50 2 C55 4 59 7 62 11 C69 22 63 39 50 48Z";
const flowerAt = [83, 41];

/* blossom scale, extra stem weight, twigs, margin inside the square, corner radius */
const drawings = {
  tiny: { bloom: .8, weight: 6, twigs: false, margin: 4, radius: 22 },
  small: { bloom: .68, weight: 3.5, twigs: true, margin: 6, radius: 22 },
  large: { bloom: .58, weight: 1, twigs: true, margin: 16, radius: 0 },
};

function svg({ bloom, weight, twigs: withTwigs, margin, radius }) {
  /* The drawing's extent: the stem's foot to the blossom's far petals. */
  const reach = 48 * bloom;
  const box = { x0: 1, y0: Math.min(12, flowerAt[1] - reach), x1: flowerAt[0] + reach, y1: 117 };
  const scale = (100 - 2 * margin) / Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const dx = (100 - (box.x1 - box.x0) * scale) / 2 - box.x0 * scale;
  const dy = (100 - (box.y1 - box.y0) * scale) / 2 - box.y0 * scale;
  const lines = `stroke="${PLUM}" stroke-width="${weight}" stroke-linejoin="round"`;
  const flower = [0, 72, 144, 216, 288].map((turn) => `<path transform="rotate(${turn} 50 50)" d="${petal}"/>`).join("") + `<circle cx="50" cy="50" r="13"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`
    + `<rect width="100" height="100" rx="${radius}" fill="${GROUND}"/>`
    + `<g fill="${PLUM}" transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${scale.toFixed(4)})">`
    + `<path d="${stem}" ${lines}/>${withTwigs ? twigs.map((d) => `<path d="${d}" stroke="${PLUM}" stroke-width="${weight / 2}" stroke-linejoin="round"/>`).join("") : ""}`
    + `<g transform="translate(${flowerAt[0]} ${flowerAt[1]}) scale(${bloom}) translate(-50 -50)">${flower}</g>`
    + `</g></svg>`;
}

const png = (drawing, size) => sharp(Buffer.from(svg(drawings[drawing])), { density: Math.ceil((size / 100) * 72 * 4) }).resize(size, size).png().toBuffer();

writeFileSync(join(out, "favicon.svg"), `<!-- Kimono's plum branch on paper, as the phone app's icon (scripts/brand-favicons.mjs). -->\n${svg(drawings.small)}\n`);
const icons = { 16: await png("tiny", 16), 32: await png("small", 32), 48: await png("small", 48) };
for (const [size, data] of Object.entries(icons)) writeFileSync(join(out, `favicon-${size}.png`), data);
writeFileSync(join(out, "apple-touch-icon.png"), await png("large", 180));

/* An .ico is a directory of PNGs. */
const entries = Object.entries(icons);
const header = Buffer.alloc(6 + 16 * entries.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach(([size, data], index) => {
  const at = 6 + 16 * index;
  header.writeUInt8(Number(size), at);
  header.writeUInt8(Number(size), at + 1);
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(data.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += data.length;
});
writeFileSync(join(out, "favicon.ico"), Buffer.concat([header, ...entries.map(([, data]) => data)]));
