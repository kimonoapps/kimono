/*
 * Reading a PDF with poppler: its text as positioned lines and where its
 * raster images sit (pdftohtml -xml), each page drawn small in grey for
 * finding drawings (pdftoppm, figures.ts), the figures themselves cut out at
 * a size an e-paper reader can hold, and its own title and author (pdfinfo).
 *
 * Why poppler: it runs in the Portal's own image (Dockerfile.portal adds
 * poppler-utils, 11 MB beside ffmpeg, whose libraries it shares), it's fast,
 * and its XML keeps what structure needs: every line's place on the page and
 * its font size. That's enough to find columns, running heads, page numbers,
 * headings, footnotes, verse and paragraphs (structure.ts), and the LLM pass
 * (restructure.ts) fixes what those rules miss. Calibre's ebook-convert is
 * better out of the box but is hundreds of megabytes and a Qt stack; marker
 * needs PyTorch and gigabytes of models; PyMuPDF would bring a Python wheel
 * for the same positioned text poppler gives.
 *
 * Scans (pages that are only pictures) aren't read with OCR: they become a
 * book of page pictures. Tesseract would add tens of megabytes per language
 * and still misread old type; that's a later step if households need it.
 */
import { execFile } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Box, Ink } from "./figures";
import type { Item, Page } from "./structure";

const run = promisify(execFile);
const MINUTE = 60_000;
/** Ink maps are drawn at this many dots per inch: one pixel is two points. */
export const INK_DPI = 36;
/** A figure's longest side, in pixels: sharp on a phone, light enough for Kimono Read's ESP32. */
export const FIGURE_PX = 1200;

export class PdfProblem extends Error {}

export async function hasPoppler(): Promise<boolean> {
  try { await run("pdftohtml", ["-v"], { timeout: 5000 }); return true; } catch (error) {
    /* pdftohtml -v exits 0 on some versions and 99 on others; only a missing binary is "no". */
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

async function poppler(cmd: string, args: string[], timeout: number) {
  try {
    return await run(cmd, args, { timeout, maxBuffer: 64 << 20 });
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? "");
    if (/password/i.test(stderr)) throw new PdfProblem("This PDF needs a password to open.");
    if ((error as { killed?: boolean }).killed) throw new PdfProblem("Reading this PDF took too long.");
    throw new PdfProblem(`This PDF couldn't be read${stderr.trim() ? `: ${stderr.trim().split("\n").at(-1)}` : "."}`);
  }
}

/** The PDF's text and raster images, page by page, in points from each page's top left. */
export async function readPages(pdf: string, work: string): Promise<{ pages: Page[]; rasters: Map<number, Box[]> }> {
  const out = join(work, "text");
  await poppler("pdftohtml", ["-xml", "-zoom", "1", "-q", "-nodrm", "-enc", "UTF-8", "-fmt", "png", pdf, out], 30 * MINUTE);
  const parsed = parsePopplerXml(await readFile(`${out}.xml`, "utf8"));
  /* The image files themselves aren't needed: figures are cut from the page, at a size of our choosing. */
  for (const f of await readdir(work)) if (/^text-\d+_\d+\.(png|jpg)$/.test(f)) await rm(join(work, f), { force: true });
  return parsed;
}

/** Each page drawn in grey at INK_DPI, a few pages at a time; null when poppler can't draw one. */
export async function* inkMaps(pdf: string, work: string, pages: number): AsyncGenerator<{ page: number; ink: Ink | null }> {
  const batch = 20;
  for (let first = 1; first <= pages; first += batch) {
    const last = Math.min(pages, first + batch - 1);
    const prefix = join(work, `ink-${first}`);
    let ok = true;
    try { await run("pdftoppm", ["-f", String(first), "-l", String(last), "-r", String(INK_DPI), "-gray", pdf, prefix], { timeout: 10 * MINUTE, maxBuffer: 16 << 20 }); } catch { ok = false; }
    const files = ok ? (await readdir(work)).filter((f) => f.startsWith(`ink-${first}-`) && f.endsWith(".pgm")) : [];
    for (let p = first; p <= last; p++) {
      const file = files.find((f) => Number(/-(\d+)\.pgm$/.exec(f)?.[1]) === p);
      yield { page: p, ink: file ? parsePgm(await readFile(join(work, file))) : null };
    }
    for (const f of files) await rm(join(work, f), { force: true });
  }
}

export function parsePgm(bytes: Uint8Array): Ink | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 64));
  const m = /^P5\s+(?:#[^\n]*\n\s*)*(\d+)\s+(\d+)\s+(\d+)\s/.exec(head);
  if (!m) return null;
  const w = Number(m[1]), h = Number(m[2]);
  return { w, h, data: bytes.subarray(m[0].length, m[0].length + w * h) };
}

/**
 * One figure cut from its page: JPEG when it holds a photo, PNG for a
 * drawing or an equation, its longest side at most FIGURE_PX.
 */
export async function renderRegion(pdf: string, work: string, r: { id: number; page: number; x: number; y: number; w: number; h: number; raster: boolean; role: string }): Promise<{ bytes: Uint8Array; type: "jpg" | "png" }> {
  const longest = Math.max(r.w, r.h);
  const dpi = Math.max(60, Math.min(r.role === "math" ? 220 : 200, Math.floor((FIGURE_PX * 72) / longest)));
  const px = (pt: number) => Math.max(1, Math.round((pt * dpi) / 72));
  const type = r.raster || r.role === "page" ? "jpg" : "png";
  const out = join(work, `fig-${r.id}`);
  await poppler("pdftoppm", [
    "-f", String(r.page), "-l", String(r.page), "-r", String(dpi),
    "-x", String(px(r.x)), "-y", String(px(r.y)), "-W", String(px(r.w)), "-H", String(px(r.h)),
    "-singlefile", ...(type === "jpg" ? ["-jpeg", "-jpegopt", "quality=80"] : ["-png"]), pdf, out,
  ], 2 * MINUTE);
  const bytes = new Uint8Array(await readFile(`${out}.${type}`));
  await rm(`${out}.${type}`, { force: true });
  return { bytes, type };
}

/** The first page as a JPEG, for the cover; null when poppler can't draw it. */
export async function firstPage(pdf: string, work: string): Promise<Uint8Array | null> {
  const out = join(work, "cover");
  try {
    await run("pdftoppm", ["-f", "1", "-l", "1", "-singlefile", "-jpeg", "-jpegopt", "quality=80", "-scale-to", "1200", pdf, out], { timeout: 2 * MINUTE });
    return new Uint8Array(await readFile(`${out}.jpg`));
  } catch { return null; }
}

/** The PDF's own Title and Author, for when Books has no record. */
export async function pdfInfo(pdf: string): Promise<{ title: string; author: string; pages: number }> {
  const { stdout } = await poppler("pdfinfo", ["-enc", "UTF-8", pdf], MINUTE);
  const field = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, "m").exec(stdout)?.[1]?.trim() ?? "";
  return { title: field("Title"), author: field("Author"), pages: Number(field("Pages")) || 0 };
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : entities[e.toLowerCase()] ?? m);
/* ﬁ, ﬂ and their kin read as their letters. */
const unligature = (s: string) => s.replace(/[ﬀ-ﬆ]/g, (c) => c.normalize("NFKC"));

/**
 * pdftohtml's XML into pages of text items, and its images' boxes. Italic
 * and bold become *…* and **…**, and a literal asterisk is escaped, so the
 * blocks can carry them.
 */
export function parsePopplerXml(xml: string): { pages: Page[]; rasters: Map<number, Box[]> } {
  const fonts = new Map<string, { size: number; family: string }>();
  for (const m of xml.matchAll(/<fontspec\b([^>]*)\/>/g)) {
    const a = attrs(m[1]);
    fonts.set(a.id, { size: Number(a.size) || 0, family: a.family ?? "" });
  }
  const pages: Page[] = [];
  const rasters = new Map<number, Box[]>();
  for (const m of xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)) {
    const a = attrs(m[1]);
    const number = Number(a.number) || pages.length + 1;
    const items: Item[] = [];
    for (const t of m[2].matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
      const ta = attrs(t[1]);
      const font = fonts.get(ta.font) ?? { size: Number(ta.height) || 0, family: "" };
      const family = font.family.toLowerCase();
      let text = t[2]
        .split(/(<[^>]+>)/)
        .map((part) => part.startsWith("<") ? part : unligature(decode(part)).replace(/([*\\])/g, "\\$1"))
        .join("")
        .replace(/<\/?i>/g, "*").replace(/<\/?b>/g, "**").replace(/<[^>]+>/g, "");
      /* A whole item in an italic or bold face, which poppler doesn't always tag. */
      if (!/\*/.test(text.replace(/\\\*/g, "")) && text.trim()) {
        const lead = /^\s*/.exec(text)![0], tail = /\s*$/.exec(text)![0], core = text.trim();
        if (/bold|black|heavy/.test(family)) text = `${lead}**${core}**${tail}`;
        else if (/italic|oblique/.test(family)) text = `${lead}*${core}*${tail}`;
      }
      if (!text.trim()) continue;
      /* L E T T E R - S P A C E D type: single letters with single spaces, words apart by wider ones. */
      const groups = text.trim().split(/\s{2,}/);
      const spaced = (g: string) => { const t = g.replace(/\*/g, "").split(" "); return t.length === 1 ? t[0].length === 1 : t.filter((x) => x.length === 1).length >= t.length * 0.6; };
      if (groups.length && groups.filter(spaced).length >= groups.length * 0.7 && groups.some((g) => g.length >= 5 && spaced(g))) text = groups.map((g) => g.replace(/ (?=\S)/g, "")).join(" ");
      items.push({ top: Number(ta.top), left: Number(ta.left), width: Number(ta.width), height: Number(ta.height), size: font.size, text });
    }
    const images: Box[] = [];
    for (const im of m[2].matchAll(/<image\b([^>]*)\/?>/g)) {
      const ia = attrs(im[1]);
      images.push({ x: Number(ia.left), y: Number(ia.top), w: Number(ia.width), h: Number(ia.height) });
    }
    rasters.set(number, images);
    pages.push({ number, width: Number(a.width) || 0, height: Number(a.height) || 0, items });
  }
  return { pages, rasters };
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([a-z-]+)="([^"]*)"/gi)) out[m[1]] = decode(m[2]);
  return out;
}
