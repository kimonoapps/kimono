// Builds drive.html: the authored mockup (src.html) with the real Kata CSS,
// the portal's shell rules and fonts inlined, so the sheet is self-contained.
import { readFileSync, writeFileSync } from "node:fs";
import { accentRamp } from "../../../packages/ui/src/accent.ts";

const root = new URL("../../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const kata = ["tokens", "kumi", "seal", "rows", "form", "page", "app-identity", "joint"]
  .map((n) => read(`packages/ui/src/styles/${n}.css`)).join("\n");
const globals = read("apps/portal/src/app/globals.css");
const shell = globals.slice(globals.indexOf(".app-frame {"), globals.indexOf(".scan-errors {"));
const font = (file, family, weight) => `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${readFileSync(new URL(`apps/portal/public/fonts/${file}`, root)).toString("base64")}) format("woff2")}`;
const fonts = [
  font("zen-maru-gothic-latin-400-normal.woff2", "Zen Maru Gothic Kimono", 400),
  font("zen-maru-gothic-latin-500-normal.woff2", "Zen Maru Gothic Kimono", 500),
  font("zen-maru-gothic-latin-700-normal.woff2", "Zen Maru Gothic Kimono", 700),
  font("shippori-mincho-600-latin.woff2", "Shippori Mincho Kimono", 600),
].join("\n");
const accent = "#5f5596";
// node build.mjs [sheet]: "drive" (default) or another folder beside this one that
// borrows Drive's product CSS and helpers through /*@drive-css*/ and /*@drive-js*/.
const sheet = process.argv[2] || "drive";
const driveSrc = readFileSync(new URL("src.html", import.meta.url), "utf8");
const between = (a, b) => driveSrc.slice(driveSrc.indexOf(a), driveSrc.indexOf(b));
const src = readFileSync(new URL(`../${sheet}/src.html`, import.meta.url), "utf8")
  .replace("/*@drive-css*/", () => between("/* ═══════════════════════════════════════════════════════════════\n   The sheet around", "</style>"))
  .replace("/*@drive-js*/", () => between("/* ───────── icons", "/* ═══════════════════════ VERSION A"))
  .replace("/*@fonts*/", fonts)
  .replace("/*@kata*/", kata)
  .replace("/*@shell*/", shell)
  .replace("/*@ramp*/", `const RAMP = ${JSON.stringify(accentRamp(accent))};`)
  // The Portal's home launcher (the ema plaques), for sheets that draw it.
  .replace("/*@launcher*/", () => globals.slice(globals.indexOf("/* Registered applications hang"), globals.indexOf("/* ═══════════════════════════════════════════════════════════════\n   Admin")))
  // /*@ramps:#aaa,#bbb*/ → a ramp per accent, for sheets that draw several apps.
  .replace(/\/\*@ramps:([^*]*)\*\//, (_, list) => `const RAMPS = ${JSON.stringify(Object.fromEntries(list.split(",").map((a) => [a.trim(), accentRamp(a.trim())])))};`);
// The Artifact host supplies the document skeleton, so publish only the page.
const page = src.replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*/i, "")
  .replace(/<\/head>\s*<body>/i, "").replace(/<\/body>\s*<\/html>\s*$/i, "");
writeFileSync(new URL(`../${sheet}.html`, import.meta.url), `<meta charset="utf-8">\n${page}`);
console.log(`wrote design/mockups/${sheet}.html`, (src.length / 1024).toFixed(0) + "KB");
