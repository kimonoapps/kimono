/*
 * One PDF into one EPUB, start to end: poppler reads it, figures.ts finds
 * its pictures, structure.ts makes its blocks, Claude (restructure.ts)
 * edits their structure when there's a token, pdf.ts cuts the pictures out,
 * epub.ts writes the book. No caching or jobs here (index.ts does those), so
 * the torture runner (scripts/books-torture) can time it case by case.
 */
import { blockWords, type Block } from "./blocks";
import { buildEpub, type Built, type Picture } from "./epub";
import { figuresOf, type Figure } from "./figures";
import { firstPage, inkMaps, PdfProblem, pdfInfo, readPages, renderRegion } from "./pdf";
import { claudeRestructurer, restructure, type PassReport, type Restructurer } from "./restructure";
import { structure } from "./structure";

export type Meta = { id?: string; title?: string; authors?: string[]; isbn?: string | null; language?: string; publisher?: string; year?: number | null };

export type PipelineReport = {
  pages: number; words: number; headings: number; notes: number; figures: number; verse: number; tables: number;
  chapters: string[]; images: number; imageBytes: number; llm: PassReport | null; seconds: number;
  stages: Record<string, number>;
};

export async function convertPdf(pdf: string, work: string, options: {
  meta?: Meta; token?: string; restructurer?: (token: string) => Restructurer; progress?: (fraction: number) => void;
} = {}): Promise<{ epub: Built; blocks: Block[]; report: PipelineReport }> {
  const began = Date.now();
  const stages: Record<string, number> = {};
  const lap = (name: string, from: number) => { stages[name] = Math.round((Date.now() - from) / 100) / 10; return Date.now(); };
  let t = Date.now();

  const info = await pdfInfo(pdf);
  const { pages, rasters } = await readPages(pdf, work);
  if (!pages.length) throw new PdfProblem("This PDF has no pages.");
  t = lap("text", t);
  options.progress?.(0.04);

  /* Pictures: from what poppler says of raster images, and from ink no text explains. */
  const figures = new Map<number, Figure[]>();
  const byNumber = new Map(pages.map((p) => [p.number, p]));
  for await (const { page, ink } of inkMaps(pdf, work, pages.length)) {
    const p = byNumber.get(page);
    if (!p) continue;
    const text = p.items.map((i) => ({ x: i.left, y: i.top, w: i.width, h: i.height }));
    const found = figuresOf(ink, p, text, rasters.get(page) ?? []);
    if (found.length) figures.set(page, found);
  }
  t = lap("figures", t);
  options.progress?.(0.08);

  const base = structure(pages, figures);
  if (base.words < 20 && !base.figures) throw new PdfProblem("This PDF has no text or pictures to read.");
  t = lap("structure", t);
  options.progress?.(0.1);

  const meta = { title: options.meta?.title || info.title || "Untitled", authors: options.meta?.authors?.length ? options.meta.authors : info.author ? [info.author] : [] };
  let blocks = base.blocks;
  let llm: PassReport | null = null;
  if (options.token) {
    const model = (options.restructurer ?? claudeRestructurer)(options.token);
    const done = await restructure(blocks, model, meta, (n, total) => options.progress?.(0.1 + 0.8 * (n / total)));
    blocks = done.blocks;
    llm = done.report;
    t = lap("llm", t);
  }

  /* The pictures that are still in the book, cut out of their pages. */
  const used = new Set(blocks.flatMap((b) => b.kind === "figure" ? [b.image] : "text" in b ? [...b.text.matchAll(/\{\{img:(\d+)\}\}/g)].map((m) => Number(m[1])) : []));
  const pictures = new Map<number, Picture>();
  for (const r of base.regions) {
    if (!used.has(r.id)) continue;
    try { pictures.set(r.id, await renderRegion(pdf, work, r)); } catch { /* left out; its caption stays as text */ }
  }
  t = lap("pictures", t);
  options.progress?.(0.95);

  const cover = await firstPage(pdf, work);
  const isbn = options.meta?.isbn ?? null;
  const epub = buildEpub(blocks, {
    id: options.meta?.id ?? (isbn ? `urn:isbn:${isbn}` : `urn:kimono:${Date.now()}`), title: meta.title, authors: meta.authors, isbn,
    language: options.meta?.language || "en", publisher: options.meta?.publisher, year: options.meta?.year,
  }, cover, pictures);
  lap("epub", t);
  return {
    epub, blocks,
    report: {
      pages: pages.length, words: blockWords(blocks).length, headings: blocks.filter((b) => b.kind === "h").length,
      notes: base.notes, figures: base.figures, verse: blocks.filter((b) => b.kind === "verse").length, tables: blocks.filter((b) => b.kind === "table").length,
      chapters: epub.chapters, images: epub.images, imageBytes: [...pictures.values()].reduce((n, p) => n + p.bytes.length, 0),
      llm, seconds: Math.round((Date.now() - began) / 100) / 10, stages,
    },
  };
}
