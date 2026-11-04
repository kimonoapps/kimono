// Draws the app's icons from Kimono's branch mark: plum ink on Kata's ground
// paper. Run after changing the mark: pnpm --filter @kimono/mobile icons
import sharp from "sharp";

const ground = "#f7f1e8", plum = "#4e2b37";
const petal = "M50 48 C36 39 31 21 41 9 C45 4 50 2 50 2 C55 4 59 7 62 11 C69 22 63 39 50 48Z";
const branch = `<path d="M2 108 C26 98 43 84 55 66 C62 55 71 47 79 43 L81 47 C73 51 66 60 59 72 C47 90 30 106 6 116Z"/><path d="M56 69 C55 61 52 54 47 47 L50 44 C56 51 59 59 59.5 66Z"/><path d="M27 97 C40 96 51 100 58 108 L55 111 C49 104 39 100 27 100Z"/><g transform="translate(83 41) scale(.55) translate(-50 -50)">${[0, 72, 144, 216, 288].map((r) => `<path d="${petal}" transform="rotate(${r} 50 50)"/>`).join("")}<circle cx="50" cy="50" r="13"/></g>`;

/* The mark occupies `share` of the canvas, centred on its own box. */
const svg = ({ size, share, background, ink }) => {
  const box = size * share, x = (size - box) / 2, y = (size - box * 106 / 111) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${background ? `<rect width="100%" height="100%" fill="${background}"/>` : ""}<svg x="${x}" y="${y}" width="${box}" height="${box * 106 / 111}" viewBox="1 12 111 106" fill="${ink}">${branch}</svg></svg>`);
};
const write = (name, options) => sharp(svg(options)).png().toFile(new URL(`../assets/${name}`, import.meta.url).pathname);

await Promise.all([
  write("icon.png", { size: 1024, share: 0.62, background: ground, ink: plum }),
  /* Android crops adaptive icons to a circle or squircle: keep the mark inside the middle 60%. */
  write("android-icon-foreground.png", { size: 1024, share: 0.5, ink: plum }),
  write("android-icon-monochrome.png", { size: 1024, share: 0.5, ink: "#000000" }),
  sharp({ create: { width: 1024, height: 1024, channels: 3, background: ground } }).png().toFile(new URL("../assets/android-icon-background.png", import.meta.url).pathname),
  write("splash-icon.png", { size: 1024, share: 0.5, ink: plum }),
  write("favicon.png", { size: 96, share: 0.8, background: ground, ink: plum }),
]);
console.log("wrote assets/");
