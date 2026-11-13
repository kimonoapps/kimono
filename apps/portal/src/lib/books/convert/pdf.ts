/*
 * Reading a PDF with poppler: its text as positioned lines (pdftohtml -xml),
 * its first page as a picture for the cover (pdftoppm), its own title and
 * author (pdfinfo).
 *
 * Why poppler: it runs in the Portal's own image (Dockerfile.portal adds
 * poppler-utils, 11 MB beside ffmpeg, whose libraries it shares), it's fast, and its XML keeps what structure needs: every line's
 * place on the page and its font size. That's enough to find running heads,
 * page numbers, headings, footnotes and paragraphs (structure.ts), and the
 * LLM pass (restructure.ts) fixes what those rules miss. Calibre's
 * ebook-convert is better out of the box but is hundreds of megabytes and a
 * Qt stack; marker needs PyTorch and gigabytes of models; PyMuPDF would bring
 * a Python wheel for the same positioned text poppler gives.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Page, Item } from "./structure";

const run = promisify(execFile);
const MINUTE = 60_000;

export async function hasPoppler(): Promise<boolean> {
  try { await run("pdftohtml", ["-v"], { timeout: 5000 }); return true; } catch (error) {
    /* pdftohtml -v exits 0 on some versions and 99 on others; only a missing binary is "no". */
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

/** The PDF's text, page by page, as poppler places it. */
export async function readPages(pdf: string, work: string): Promise<Page[]> {
  const out = join(work, "text");
  await run("pdftohtml", ["-xml", "-i", "-q", "-nodrm", "-enc", "UTF-8", pdf, out], { timeout: 10 * MINUTE, maxBuffer: 16 << 20 });
  return parsePopplerXml(await readFile(`${out}.xml`, "utf8"));
}

/** The first page as a JPEG, for the cover; null when poppler can't draw it. */
export async function firstPage(pdf: string, work: string): Promise<Uint8Array | null> {
  const out = join(work, "cover");
  try {
    await run("pdftoppm", ["-f", "1", "-l", "1", "-singlefile", "-jpeg", "-jpegopt", "quality=85", "-scale-to", "1400", pdf, out], { timeout: 2 * MINUTE });
    return new Uint8Array(await readFile(`${out}.jpg`));
  } catch { return null; }
}

/** The PDF's own Title and Author, for when Books has no record. */
export async function pdfInfo(pdf: string): Promise<{ title: string; author: string; pages: number }> {
  try {
    const { stdout } = await run("pdfinfo", ["-enc", "UTF-8", pdf], { timeout: MINUTE });
    const field = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, "m").exec(stdout)?.[1]?.trim() ?? "";
    return { title: field("Title"), author: field("Author"), pages: Number(field("Pages")) || 0 };
  } catch { return { title: "", author: "", pages: 0 }; }
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : entities[e.toLowerCase()] ?? m);

/**
 * pdftohtml's XML into pages of text items. Italic and bold become *…* and
 * **…**, and a literal asterisk is escaped, so the text format structure.ts
 * and the LLM share can carry them.
 */
export function parsePopplerXml(xml: string): Page[] {
  const fonts = new Map<string, { size: number; family: string }>();
  for (const m of xml.matchAll(/<fontspec\b([^>]*)\/>/g)) {
    const a = attrs(m[1]);
    fonts.set(a.id, { size: Number(a.size) || 0, family: a.family ?? "" });
  }
  const pages: Page[] = [];
  for (const m of xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)) {
    const a = attrs(m[1]);
    const items: Item[] = [];
    for (const t of m[2].matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
      const ta = attrs(t[1]);
      const font = fonts.get(ta.font) ?? { size: Number(ta.height) || 0, family: "" };
      const family = font.family.toLowerCase();
      let text = t[2]
        .split(/(<[^>]+>)/)
        .map((part) => part.startsWith("<") ? part : decode(part).replace(/([*\\])/g, "\\$1"))
        .join("")
        .replace(/<\/?i>/g, "*").replace(/<\/?b>/g, "**").replace(/<[^>]+>/g, "");
      /* A whole item in an italic or bold face, which poppler doesn't always tag. */
      if (!/\*/.test(text.replace(/\\\*/g, "")) && text.trim()) {
        const lead = /^\s*/.exec(text)![0], tail = /\s*$/.exec(text)![0], core = text.trim();
        if (/bold|black|heavy/.test(family)) text = `${lead}**${core}**${tail}`;
        else if (/italic|oblique/.test(family)) text = `${lead}*${core}*${tail}`;
      }
      if (!text.trim()) continue;
      items.push({ top: Number(ta.top), left: Number(ta.left), width: Number(ta.width), height: Number(ta.height), size: font.size, text });
    }
    pages.push({ number: Number(a.number) || pages.length + 1, width: Number(a.width) || 0, height: Number(a.height) || 0, items });
  }
  return pages;
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([a-z-]+)="([^"]*)"/gi)) out[m[1]] = decode(m[2]);
  return out;
}
