/*
 * Runs Books' PDF → EPUB converter over the torture set
 * (scripts/books-torture/make.py) and measures each case: time, memory,
 * Claude's tokens and cost, whether the word check held, how much of the
 * ground truth survived and in what order, the odd words that must survive
 * verbatim, and the pictures (count, pixel size, captions).
 *
 *   node --experimental-transform-types --import ./scripts/ts-resolve.mjs \
 *     scripts/books-torture-run.mjs <corpus dir> <out dir> [case …]
 *
 * Claude: KIMONO_CLAUDE_TOKEN, or ANTHROPIC_API_KEY with ANTHROPIC_BASE_URL
 * (a Kimono sandbox's model gateway). Without either, the base conversion
 * alone. Writes <out>/<case>.epub, <out>/results.json and <out>/results.md.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { convertPdf } = await import('../src/lib/books/convert/pipeline.ts');
const { words, blockText, overlap } = await import('../src/lib/books/convert/blocks.ts');
const { claudeRestructurer } = await import('../src/lib/books/convert/restructure.ts');

const [corpus, out, ...only] = process.argv.slice(2);
if (!corpus || !out) { console.error('usage: books-torture-run.mjs <corpus dir> <out dir> [case …]'); process.exit(2); }
mkdirSync(out, { recursive: true });
const token = process.env.KIMONO_CLAUDE_TOKEN || process.env.ANTHROPIC_API_KEY || '';
const baseURL = process.env.KIMONO_CLAUDE_TOKEN ? undefined : process.env.ANTHROPIC_BASE_URL;

const index = JSON.parse(readFileSync(join(corpus, 'index.json'), 'utf8'));
const cases = (Array.isArray(index) ? index : index.cases).map((c) => typeof c === 'string' ? c : c.case ?? c.name).filter((c) => !only.length || only.includes(c));

/** Pixel size of a PNG or JPEG. */
function size(bytes) {
  if (bytes[0] === 0x89) return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  for (let i = 2; i < bytes.length - 9;) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1], len = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return { w: 0, h: 0 };
}

/** Word 5-grams of the truth found in the output: reading order, roughly. */
function order(truth, got) {
  const grams = (ws) => { const s = new Set(); for (let i = 0; i + 5 <= ws.length; i++) s.add(ws.slice(i, i + 5).join(' ')); return s; };
  const t = grams(truth), g = grams(got);
  if (!t.size) return 1;
  let n = 0;
  for (const x of t) if (g.has(x)) n++;
  return n / t.size;
}

const norm = (s) => s.normalize('NFKC').replace(/[­]/g, '').replace(/\s+/g, ' ').trim();
const results = [];
for (const name of cases) {
  const pdf = join(corpus, `${name}.pdf`);
  const meta = existsSync(join(corpus, `${name}.meta.json`)) ? JSON.parse(readFileSync(join(corpus, `${name}.meta.json`), 'utf8')) : {};
  const truth = existsSync(join(corpus, `${name}.truth.txt`)) ? readFileSync(join(corpus, `${name}.truth.txt`), 'utf8') : '';
  const work = mkdtempSync(join(tmpdir(), `torture-${name}-`));
  let peak = 0;
  const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 200);
  const began = Date.now();
  const row = { case: name, pages: meta.pages ?? null, about: meta.about ?? '' };
  try {
    const r = await convertPdf(pdf, work, {
      meta: { title: meta.title, authors: meta.author ? [meta.author] : [], language: meta.language },
      token, restructurer: token ? (t) => claudeRestructurer(t, { baseURL, claudeCode: Boolean(baseURL) }) : undefined,
    });
    writeFileSync(join(out, `${name}.epub`), r.epub.bytes);
    const got = words(r.blocks.map(blockText).join('\n'));
    const want = words(truth);
    /* Words inside pictures (labels, balloons) are kept as alt text: they count as kept, not as added. */
    const { kept } = overlap(want, got);
    const { faithful } = overlap(want, words(r.blocks.map((b) => b.kind === 'figure' ? b.caption ?? '' : blockText(b)).join('\n')));
    const text = norm(r.blocks.map(blockText).join('\n').replace(/\s*\{\{img:\d+\}\}\s*/g, ' ').replace(/\\\*/g, '\u0003').replace(/\*/g, '').replace(/\u0003/g, '*'));
    const mustKeep = meta.expect?.must_keep ?? [];
    const missing = mustKeep.filter((m) => !text.includes(norm(m)));
    const captions = meta.expect?.captions ?? [];
    const figCaptions = r.blocks.filter((b) => b.kind === 'figure' && b.caption).map((b) => norm(b.caption.replace(/\*/g, '')));
    const captioned = captions.filter((c) => figCaptions.some((f) => f.includes(norm(c)) || norm(c).includes(f)));
    const pics = [];
    const zipped = r.epub.bytes;
    /* Picture sizes, from the EPUB's own images. */
    for (const b of r.blocks) if (b.kind === 'figure') pics.push(b.image);
    const dims = [];
    {
      const buf = Buffer.from(zipped);
      let at = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      const count = buf.readUInt16LE(at + 10);
      let cd = buf.readUInt32LE(at + 16);
      for (let i = 0; i < count; i++) {
        const nameLen = buf.readUInt16LE(cd + 28), extra = buf.readUInt16LE(cd + 30), comment = buf.readUInt16LE(cd + 32), offset = buf.readUInt32LE(cd + 42), csize = buf.readUInt32LE(cd + 20);
        const fname = buf.subarray(cd + 46, cd + 46 + nameLen).toString();
        if (/images\/fig\d+\.(png|jpg)$/.test(fname)) {
          const dataAt = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
          dims.push(size(buf.subarray(dataAt, dataAt + csize)));
        }
        cd += 46 + nameLen + extra + comment;
      }
    }
    const llm = r.report.llm;
    Object.assign(row, {
      ok: true, seconds: r.report.seconds, stages: r.report.stages, peakMb: 0,
      words: got.length, truthWords: want.length, kept: +kept.toFixed(3), faithful: +faithful.toFixed(3), order: +order(want, got).toFixed(3),
      chapters: r.report.chapters.length, expectChapters: meta.expect?.chapters?.length ?? null,
      images: r.report.images, expectImages: meta.expect?.images ?? null, maxPx: Math.max(0, ...dims.map((d) => Math.max(d.w, d.h))),
      imageKb: Math.round(r.report.imageBytes / 1024), epubKb: Math.round(r.epub.bytes.length / 1024),
      captions: `${captioned.length}/${captions.length}`, notes: r.report.notes, expectNotes: meta.expect?.notes ?? null,
      verse: r.report.verse, expectVerse: meta.expect?.verse_blocks ?? null, tables: r.report.tables, expectTables: meta.expect?.tables ?? null,
      mustKeepMissing: missing,
      llm: llm && { parts: llm.parts, sent: llm.sent, accepted: llm.accepted, edits: llm.edits, refused: llm.refused, tokens: llm.usage, dollars: llm.dollars, rejected: llm.rejected },
    });
  } catch (error) {
    Object.assign(row, { ok: false, seconds: Math.round((Date.now() - began) / 100) / 10, error: error instanceof Error ? error.message : String(error) });
  } finally {
    clearInterval(sampler);
    peak = Math.max(peak, process.memoryUsage().rss);
    row.peakMb = Math.round(peak / 1048576);
    rmSync(work, { recursive: true, force: true });
  }
  results.push(row);
  const l = row.llm;
  console.log(row.ok
    ? `${name}: ${row.seconds}s, kept ${row.kept} faithful ${row.faithful} order ${row.order}, ${row.images}/${row.expectImages ?? '?'} pictures, captions ${row.captions}${row.mustKeepMissing.length ? `, MISSING ${row.mustKeepMissing.length}` : ''}${l ? `, Claude ${l.accepted}/${l.sent} parts, ${l.edits} edits (${l.refused} refused), $${l.dollars}` : ''}`
    : `${name}: FAILED in ${row.seconds}s: ${row.error}`);
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
}

const md = ['| case | pages | time | peak MB | Claude tokens in/out | cost | check held | kept | added | order | pictures | captions | must-keep lost | error |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const r of results) {
  const l = r.llm;
  const tokens = l ? `${l.tokens.input + l.tokens.cacheRead + l.tokens.cacheWrite} / ${l.tokens.output}` : '–';
  md.push(r.ok
    ? `| ${r.case} | ${r.pages ?? ''} | ${r.seconds}s | ${r.peakMb} | ${tokens} | ${l ? `$${l.dollars}` : '–'} | ${l ? `${l.accepted}/${l.sent} (${l.refused} refused)` : '–'} | ${r.kept} | ${(1 - r.faithful).toFixed(3)} | ${r.order} | ${r.images}/${r.expectImages ?? '?'} (≤${r.maxPx}px) | ${r.captions} | ${r.mustKeepMissing.length} | |`
    : `| ${r.case} | ${r.pages ?? ''} | ${r.seconds}s | ${r.peakMb} | | | | | | | | | | ${r.error} |`);
}
writeFileSync(join(out, 'results.md'), md.join('\n') + '\n');
console.log(`\n${md.join('\n')}`);
