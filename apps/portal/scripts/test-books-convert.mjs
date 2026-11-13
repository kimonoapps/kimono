import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/* Converted books go to a scratch state dir; set before Portal code reads it. */
const state = mkdtempSync(join(tmpdir(), 'kimono-books-convert-'));
process.env.KIMONO_STATE_DIR = state;
const files = await import('../src/lib/books/files.ts');
const blocks = await import('../src/lib/books/convert/blocks.ts');
const figures = await import('../src/lib/books/convert/figures.ts');
const structure = await import('../src/lib/books/convert/structure.ts');
const restructure = await import('../src/lib/books/convert/restructure.ts');
const epub = await import('../src/lib/books/convert/epub.ts');
const convert = await import('../src/lib/books/convert/index.ts');
test.after(() => rmSync(state, { recursive: true, force: true }));

let poppler = true;
try { execFileSync('pdftohtml', ['-v'], { stdio: 'ignore' }); } catch (e) { poppler = e.code !== 'ENOENT'; }

/* ── A small PDF of our own: a title page, then three pages with a running head, page numbers, words broken at line ends, and footnotes numbered per page. ── */

const HEAD = "THE LANTERN KEEPER'S ALMANAC";
const book = [
  { lines: [[200, 560, 26, 'F2', 'The Lantern Keeper'], [250, 520, 14, 'F1', 'A short test book']] },
  { folio: '2', lines: [
    [72, 690, 20, 'F2', 'Chapter One: The Harbour at Dusk'],
    [90, 650, 11, 'F1', 'Every evening the keeper climbed the ninety steps of the old'],
    [72, 636, 11, 'F1', 'tower and trimmed the wick before the fishing boats came home.'],
    [72, 622, 11, 'F1', 'She had done it for so long that she no longer remem-'],
    [72, 608, 11, 'F1', ['bered learning how, only the smell of oil on her sleeves.', '1']],
    [90, 594, 11, 'F1', 'The harbour below was quiet. Gulls argued over the nets, and'],
    [72, 580, 11, 'F1', 'a boy on the quay counted the masts twice to be sure none'],
    [72, 566, 11, 'F1', 'were missing. When the light finally caught, the whole bay'],
    [72, 552, 11, 'F1', 'seemed to lean toward it, as though'],
  ], notes: [[72, 100, 8, 'F1', '1 The tower was rebuilt twice after the winter storms of the'], [72, 90, 8, 'F1', 'previous century.']] },
  { folio: '3', lines: [
    [72, 700, 11, 'F1', 'listening for an answer from the dark water beyond the'],
    [72, 686, 11, 'F1', 'breakwater.'],
    [90, 672, 11, 'F1', 'Nobody in the village could say when the custom began. Some'],
    [72, 658, 11, 'F1', 'claimed it was older than the church; others insisted a mer-'],
    [72, 644, 11, 'F1', 'chant had paid for the first lamp out of gratitude.'],
    [72, 600, 20, 'F2', 'Chapter Two: Salt and Paper'],
    [90, 560, 11, 'F1', 'In the second winter the keeper started writing everything'],
    [72, 546, 11, 'F1', 'down: the weather, the boats, the price of herring, and the'],
    [72, 532, 11, 'F1', 'names of the children who brought her bread.'],
  ] },
  { folio: '4', lines: [
    [90, 700, 11, 'F1', ['Her notebooks filled a whole shelf by the spring.', '1', ' She kept']],
    [72, 686, 11, 'F1', 'them in a tin box so the damp would not reach the pages, and'],
    [72, 672, 11, 'F1', 'she never let anyone read them while she was alive.'],
  ], notes: [[72, 100, 8, 'F1', '1 Three of the notebooks survive in the village library.']] },
];
/* Every word a reader should get, in order: the body and the notes, without running heads or page numbers. */
const expectedWords = book.flatMap((p) => [...p.lines, ...(p.notes ?? [])].map((l) => [l[4]].flat().filter((s) => s !== '1').join(''))).join(' ')
  .replace(/remem- bered/, 'remembered').replace(/mer- chant/, 'merchant').replace(/^1 /gm, '');

function makePdf(pages) {
  const esc = (s) => s.replace(/[\\()]/g, '\\$&');
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null), tree = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const kids = [];
  for (const page of pages) {
    const ops = [];
    const draw = ([x, y, size, font, text]) => {
      const runs = [text].flat();
      /* A run of '1' alone is a note mark: smaller, raised. */
      ops.push(`BT /${font} ${size} Tf ${x} ${y} Td ` + runs.map((r, i) => r === '1' && i > 0 ? `/${font} ${size * 0.6} Tf ${size * 0.4} Ts (1) Tj /${font} ${size} Tf 0 Ts` : `(${esc(r)}) Tj`).join(' ') + ' ET');
    };
    if (page.folio) { draw([72, 750, 9, 'F1', HEAD]); draw([300, 40, 9, 'F1', page.folio]); }
    page.lines.forEach(draw);
    (page.notes ?? []).forEach(draw);
    const stream = ops.join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = Buffer.byteLength(out); out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

/* BOOKS_CONVERT_PDF=/path/book.pdf writes the test book out, for trying by hand. */
if (process.env.BOOKS_CONVERT_PDF) writeFileSync(process.env.BOOKS_CONVERT_PDF, makePdf(book));

function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (view.getUint32(end, true) !== 0x06054b50) end--;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true), nameLen = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true), offset = view.getUint32(at + 42, true);
    const name = Buffer.from(bytes.subarray(at + 46, at + 46 + nameLen)).toString();
    const dataAt = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const raw = bytes.subarray(dataAt, dataAt + size);
    entries.push({ name, method, offset, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    at += 46 + nameLen + extra + comment;
  }
  return entries;
}

/** A strict enough XML check: every tag closed in order, attributes quoted, no stray & or <. */
function wellFormed(xml, name) {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '').replace(/<!DOCTYPE[^>]*>/, '');
  const stack = [];
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi)) {
    if (!m[2]) assert.fail(`${name}: stray "${m[0]}" at ${m.index}: ${body.slice(m.index - 30, m.index + 30)}`);
    if (m[1]) assert.equal(stack.pop(), m[2], `${name}: </${m[2]}> closes the wrong tag`);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.deepEqual(stack, [], `${name}: unclosed ${stack}`);
}
const textOf = (xhtml) => xhtml.replace(/<head>[\s\S]*?<\/head>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/* ── Claude, stood in for: a local server speaking the Messages API's stream, answering with edits. ── */

function fakeClaude(answer = () => ({ edits: [] })) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const request = JSON.parse(body);
      seen.push({ request, headers: req.headers });
      const asked = request.messages[0].content;
      const text = JSON.stringify(answer(asked.slice(asked.indexOf('\n\n') + 2)));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      send('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model: request.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
      send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      for (let i = 0; i < text.length; i += 400) send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 400) } });
      send('content_block_stop', { index: 0 });
      send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 100 } });
      send('message_stop', {});
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() })));
}

const P = (text, page = 1) => ({ kind: 'p', text, page });
const H = (level, text, page = 1) => ({ kind: 'h', level, text, page });
const edit = (e) => ({ op: null, block: null, level: null, at: null, as: null, after: null, note: null, figure: null, from: null, to: null, ...e });

/* ── The rules alone ── */

test('broken words join at a line end; real hyphens, new sentences and CJK stay as they should', () => {
  assert.equal(blocks.join('no longer remem-', 'bered learning'), 'no longer remembered learning');
  assert.equal(blocks.join('a well-', 'Known name'), 'a well-Known name');
  assert.equal(blocks.join('the old', 'tower'), 'the old tower');
  assert.equal(blocks.join('吾輩は猫で', 'ある。'), '吾輩は猫である。');
  assert.equal(blocks.join('', 'first'), 'first');
});

test('words are counted alike in every script: CJK by character, ligatures and long s by their letters', () => {
  assert.deepEqual(blocks.words('Ye olde ſhoppe, ﬁne & dandy!'), ['ye', 'olde', 'shoppe', 'fine', 'dandy']);
  assert.deepEqual(blocks.words('猫である'), ['猫', 'で', 'あ', 'る']);
  assert.deepEqual(blocks.words('Note[^3] and {{img:2}} here'), ['note', 'and', 'here']);
});

test('Claude\'s edits can restructure but never change a word', () => {
  const book = [H(2, 'One'), P('Becos it was Wensday the freind came.'), P('— 12 —'), P('and stayd for tea, as ye olde custom doth.'), P('A long paragraph '.repeat(20)), P('Figure 2: the mill')];
  const ids = book.map((_, i) => i + 1);
  const { blocks: out, applied, refused } = blocks.applyEdits(book, ids, [
    edit({ op: 'heading', block: 'b1', level: 1 }),
    edit({ op: 'delete', block: 'b3' }), // a page number: fine
    edit({ op: 'join', block: 'b2' }), // across the deleted page number
    edit({ op: 'word', block: 'b2', from: 'Becos', to: 'Because' }), // a spelling "fix": refused
    edit({ op: 'word', block: 'b2', from: 'stayd', to: 'stay-d' }), // same letters and a hyphen: allowed (Claude's call)
    edit({ op: 'delete', block: 'b5' }), // the book's own text: refused
    edit({ op: 'split', block: 'b2', at: 'nowhere in it', as: 'p' }), // refused
    edit({ op: 'rewrite', block: 'b2' }), // no such edit
  ]);
  assert.equal(applied, 4);
  assert.equal(refused.length, 4);
  assert.deepEqual(out.map((b) => b.kind === 'h' ? `h${b.level}` : b.kind), ['h1', 'p', 'p', 'p']);
  assert.equal(out[1].text, 'Becos it was Wensday the freind came. and stay-d for tea, as ye olde custom doth.');
  const before = blocks.blockWords(book.filter((_, i) => i !== 2)), after = blocks.blockWords(out);
  assert.equal(blocks.overlap(before, after).faithful, 1);
});

test('a stray paragraph becomes a note or a caption, and blocks move into reading order', () => {
  const book = [P('The keeper slept.[^1]'), P('She dreamed of herring.'), P('Rebuilt twice.'), { kind: 'figure', image: 1, caption: null, page: 1, role: 'picture' }, P('The tower at dusk.'), P('A sidebar spliced in.')];
  const { blocks: out } = blocks.applyEdits(book, [1, 2, 3, 4, 5, 6], [
    edit({ op: 'note', block: 'b3', note: 1 }),
    edit({ op: 'caption', block: 'b5', figure: 'b4' }),
    edit({ op: 'move', block: 'b6', after: 'b1' }),
  ]);
  assert.deepEqual(out.map((b) => b.kind), ['p', 'p', 'p', 'note', 'figure']);
  assert.equal(out[1].text, 'A sidebar spliced in.');
  assert.equal(out[4].caption, 'The tower at dusk.');
});

test('parts are cut between blocks and keep a note with its paragraph', () => {
  const book = Array.from({ length: 30 }, (_, i) => i === 10 ? { kind: 'note', id: 1, text: 'A note.', page: 1 } : i === 20 ? H(1, 'Two') : P(`Paragraph ${i} ${'word '.repeat(40)}`));
  const cut = restructure.parts(book, 300);
  assert.ok(cut.length > 2);
  assert.deepEqual(cut.flat(), book);
  assert.ok(cut.every((p) => p[0].kind !== 'note'));
  assert.ok(cut.some((p) => p[0].kind === 'h'));
});

test('figures come out of the ink no text explains; ruled lines and text alone don\'t', () => {
  /* A 100×100 point page at one pixel a point: a filled box (a picture), a rule, and text. */
  const W = 100, H2 = 100, data = new Uint8Array(W * H2).fill(255);
  const paint = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * W + x] = 0; };
  paint(10, 10, 60, 50); // a drawing
  paint(10, 70, 90, 71); // a rule
  paint(10, 80, 80, 88); // a line of text, explained by its box
  const found = figures.figuresOf({ w: W, h: H2, data }, { width: 100, height: 100 }, [{ x: 10, y: 80, w: 70, h: 8 }], []);
  assert.equal(found.length, 1);
  assert.deepEqual([Math.round(found[0].x), Math.round(found[0].y), Math.round(found[0].w), Math.round(found[0].h)], [10, 10, 50, 40]);
  /* A raster image poppler reported is a figure even when it's pale. */
  assert.equal(figures.figuresOf(null, { width: 100, height: 100 }, [], [{ x: 5, y: 5, w: 40, h: 30 }])[0].raster, true);
});

test('columns are read one after the other, verse keeps its lines, and a figure waits for its paragraph', () => {
  const item = (left, top, text, size = 10, width = 200) => ({ left, top, width, height: size * 1.2, size, text });
  const leftCol = ['The left column begins here and runs', 'down the page with a sentence that', 'ends on this line.'];
  const rightCol = ['La colonne de droite commence ici', 'et descend la page avec une phrase', 'qui finit sur cette ligne.'];
  const page = { number: 1, width: 500, height: 700, items: [
    ...leftCol.map((t, i) => item(40, 100 + i * 14, t)), ...rightCol.map((t, i) => item(270, 100 + i * 14, t)),
    item(40, 200, 'Twas brillig, and the slithy toves', 10, 160), item(60, 214, 'Did gyre and gimble in the wabe:', 10, 150), item(40, 228, 'All mimsy were the borogoves,', 10, 140), item(60, 242, 'And the mome raths outgrabe.', 10, 140),
    item(40, 300, 'A paragraph runs into a picture and', 10, 420), item(40, 420, 'carries on below it to its end.', 10, 300),
  ] };
  const { blocks: out, regions } = structure.structure([page], new Map([[1, [{ x: 40, y: 320, w: 300, h: 90, raster: true }]]]));
  const kinds = out.map((b) => b.kind);
  assert.deepEqual(kinds, ['p', 'p', 'verse', 'p', 'figure']);
  assert.match(out[0].text, /^The left column begins.*ends on this line\.$/);
  assert.match(out[1].text, /^La colonne de droite.*cette ligne\.$/);
  assert.deepEqual(out[2].lines.map((l) => l.indent), [0, 4, 0, 4]);
  assert.equal(out[3].text, 'A paragraph runs into a picture and carries on below it to its end.');
  assert.equal(regions.length, 1);
});

test('an EPUB from blocks: valid, notes linked across files, pictures with captions, verse, tables', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const book = [
    H(1, 'One'), P('A *first* paragraph with a note.[^1] And a literal \\* star & an <angle> and a {{img:2}} glyph.'),
    { kind: 'note', id: 1, text: 'The note.', page: 1 },
    { kind: 'figure', image: 1, caption: 'Plate I. The mill.', page: 1, role: 'picture' },
    { kind: 'verse', lines: [{ indent: 0, text: 'Twas brillig,' }, { indent: 2, text: 'and the slithy toves' }], page: 1 },
    { kind: 'table', rows: [['Name', 'Age'], ['Odile', '11']], page: 1 },
    H(2, 'A section'), P('Words '.repeat(6000)), H(1, 'Two'), P('The end.'),
  ];
  const built = epub.buildEpub(book, { id: 'urn:isbn:9780306406157', title: 'T & T', authors: ['A. Writer'], isbn: '9780306406157', language: 'en' }, null,
    new Map([[1, { bytes: png, type: 'png' }], [2, { bytes: png, type: 'png' }]]));
  const entries = unzip(built.bytes);
  assert.equal(entries[0].name, 'mimetype');
  assert.equal(entries[0].method, 0);
  for (const e of entries) if (/\.(x?html|opf|ncx|xml)$/.test(e.name)) wellFormed(e.data.toString(), e.name);
  assert.deepEqual(built.chapters, ['One', 'Two']);
  assert.equal(built.images, 2);
  const first = entries.find((e) => e.name === 'OEBPS/text/part0001.xhtml').data.toString();
  assert.match(first, /<i>first<\/i>/);
  assert.match(first, /literal \* star &amp; an &lt;angle&gt; and a <img class="inline" src="..\/images\/fig0002.png" alt=""\/> glyph/);
  assert.match(first, /<figure class="picture"><img src="..\/images\/fig0001.png" alt="Plate I. The mill."\/><figcaption>Plate I. The mill.<\/figcaption><\/figure>/);
  assert.match(first, /<div class="verse"><p>Twas brillig,<\/p><p>    and the slithy toves<\/p><\/div>/);
  assert.match(first, /<thead><tr><th>Name<\/th><th>Age<\/th><\/tr><\/thead><tbody><tr><td>Odile<\/td><td>11<\/td><\/tr><\/tbody>/);
  assert.match(first, /<aside epub:type="footnote" id="n1"><p><a href="#r1">1<\/a>\. The note\.<\/p><\/aside>/);
  assert.match(entries.find((e) => e.name === 'OEBPS/content.opf').data.toString(), /<item id="fig1" href="images\/fig0001.png" media-type="image\/png"\/>/);
  assert.ok(entries.some((e) => e.name === 'OEBPS/text/part0002.xhtml'), 'a long chapter is cut into files');
});

test('a record\'s language becomes an EPUB language tag', () => {
  assert.equal(epub.languageTag('spa'), 'es');
  assert.equal(epub.languageTag('en'), 'en');
  assert.equal(epub.languageTag('pt-BR'), 'pt-br');
  assert.equal(epub.languageTag(''), 'en');
});

test('chapters marked one level down still become chapters', () => {
  const built = epub.buildEpub([H(1, 'The Book'), P('By someone.'), H(2, 'One'), P('First.'), H(3, 'A part'), P('More.'), H(2, 'Two'), P('Second.')], { id: 'x', title: 'The Book', authors: [], isbn: null, language: 'en' }, null);
  assert.deepEqual(built.chapters, ['The Book', 'One', 'Two']);
  const docs = unzip(built.bytes).filter((e) => /part\d+\.xhtml$/.test(e.name)).map((e) => e.data.toString());
  assert.match(docs[1], /<h1>One<\/h1>[\s\S]*<h2>A part<\/h2>/);
});

/* ── The whole way: a source's PDF, offered as an EPUB, made on first open, kept, served by range. ── */

test('a PDF is offered as an EPUB, made on first open with the LLM pass, and served from the cache', { skip: !poppler && 'poppler (pdftohtml) is not installed' }, async () => {
  const pdf = makePdf(book);
  const claude = await fakeClaude();
  const record = { key: 'ol:TEST1W', title: 'The Lantern Keeper', authors: ['Test Author'], isbns: ['9780306406157'], language: 'en', publisher: 'Kimono Tests', year: 2026 };
  files.registerFileSource({
    name: 'shelf',
    async find(b) { return b.isbns.includes('9780306406157') ? [{ id: 'keeper.pdf', format: 'pdf', size: pdf.length, label: null, language: 'en', sample: false }] : []; },
    async open(id, range) { return files.sliceOf(pdf, id, range); },
  });
  convert.registerConversions({
    dir: join(state, 'converted'),
    bookFor: (key) => key === record.key ? record : null,
    token: async () => 'sk-ant-api03-test',
    restructurer: (token) => restructure.claudeRestructurer(token, { baseURL: claude.url }),
  });
  try {
    const listed = await files.filesFor(record);
    assert.deepEqual(listed.map((f) => [f.source, f.format, f.label]), [['converted', 'epub', 'From PDF'], ['shelf', 'pdf', null]]);
    const address = files.fileAddress(listed[0]);
    assert.equal(listed[0].preparing, false);
    assert.equal(listed[0].size, null);

    /* First open starts it and answers "still preparing" rather than waiting. */
    await assert.rejects(files.openFile(address), (e) => e instanceof files.FilePreparing && e.status === 202);
    assert.equal((await files.filesFor(record))[0].preparing, true);
    await convert.converted(record.key, 'shelf:keeper.pdf');

    assert.equal(claude.seen.length, 1);
    const asked = claude.seen[0].request;
    assert.equal(asked.model, 'claude-opus-5-5');
    assert.equal(asked.stream, true);
    assert.equal(asked.output_config.format.type, 'json_schema');
    assert.match(asked.system.at(-1).text, /there is no edit for changing a word/);
    assert.match(asked.messages[0].content, /\[b\d+ p p\.2\] Every evening the keeper/);

    const ready = (await files.filesFor(record))[0];
    assert.equal(ready.preparing, false);
    const whole = await files.openFile(address);
    const bytes = new Uint8Array(await new Response(whole.body).arrayBuffer());
    assert.equal(whole.size, bytes.length);
    assert.equal(ready.size, bytes.length);
    assert.equal(whole.filename, 'The Lantern Keeper.epub');

    const entries = unzip(bytes);
    assert.equal(entries[0].name, 'mimetype');
    const get = (name) => entries.find((e) => e.name === name)?.data.toString();
    for (const e of entries) if (/\.(x?html|opf|ncx|xml)$/.test(e.name)) wellFormed(e.data.toString(), e.name);
    assert.match(get('META-INF/container.xml'), /full-path="OEBPS\/content.opf"/);
    const opf = get('OEBPS/content.opf');
    assert.match(opf, /<dc:title>The Lantern Keeper<\/dc:title>/);
    assert.match(opf, /<dc:creator id="author1">Test Author<\/dc:creator>/);
    assert.match(opf, /urn:isbn:9780306406157/);
    assert.match(opf, /properties="cover-image"/);
    assert.ok(entries.find((e) => e.name === 'OEBPS/cover.jpg').data.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])), 'the cover is the first page as a JPEG');
    const nav = get('OEBPS/nav.xhtml');
    assert.match(nav, /Chapter One: The Harbour at Dusk/);
    assert.match(nav, /Chapter Two: Salt and Paper/);

    const chapters = entries.filter((e) => /text\/part\d+\.xhtml$/.test(e.name)).map((e) => e.data.toString());
    const all = chapters.join('\n');
    const read = textOf(all);
    assert.doesNotMatch(read, /LANTERN KEEPER'S ALMANAC/, 'the running head is gone');
    assert.doesNotMatch(textOf(all.replace(/<sup>.*?<\/sup>|<aside[\s\S]*?<\/aside>/g, '')), /\d/, 'the page numbers are gone');
    assert.match(read, /no longer remembered learning/);
    assert.match(read, /a merchant had paid/);
    assert.match(read, /as though listening for an answer/, 'a paragraph broken by the page joins up');
    assert.match(all, /<h1>Chapter One: The Harbour at Dusk<\/h1>/);
    /* Both pages' notes are "1"; each keeps its own text, linked from its own mark. */
    assert.match(all, /sleeves\.<a epub:type="noteref" id="r1" href="#n1"><sup>1<\/sup><\/a>/);
    assert.match(all, /<aside epub:type="footnote" id="n1"><p><a href="#r1">1<\/a>\. The tower was rebuilt twice after the winter storms of the previous century\.<\/p>/);
    assert.match(all, /spring\.<a epub:type="noteref" id="r2" href="#n2">/);
    assert.match(all, /id="n2"><p><a href="#r2">2<\/a>\. Three of the notebooks survive in the village library\./);
    const { kept, faithful } = blocks.overlap(blocks.words(expectedWords), blocks.words(read.replace(/\b(\d)\. /g, ' ')));
    assert.ok(kept > 0.99 && faithful > 0.97, `words kept ${kept}, faithful ${faithful}`);

    /* Ranges from the cache. */
    const head = await files.openFile(address, files.parseRange('bytes=0-1'));
    assert.deepEqual(head.range, { start: 0, end: 1 });
    assert.equal(await new Response(head.body).text(), 'PK');
    const tail = await files.openFile(address, files.parseRange(`bytes=${bytes.length - 22}-`));
    assert.deepEqual(new Uint8Array(await new Response(tail.body).arrayBuffer()), bytes.subarray(bytes.length - 22));
    await assert.rejects(files.openFile(address, { start: bytes.length + 5 }), (e) => e.status === 416);
    assert.equal(claude.seen.length, 1, 'served from the cache, not made again');

    const report = await convert.conversionReport('shelf:keeper.pdf');
    assert.equal(report.llm.accepted, 1);
    assert.equal(report.llm.usage.input, 1000);
    assert.equal(report.notes, 2);
  } finally {
    claude.close();
    files.unregisterFileSource('shelf');
    convert.unregisterConversions();
  }
});

test('without a Claude token the base conversion alone is used, and edits that would reword are refused', { skip: !poppler && 'poppler (pdftohtml) is not installed' }, async () => {
  const pdf = makePdf(book);
  const record = { key: 'ol:TEST2W', title: 'The Lantern Keeper', authors: [], isbns: ['9780000000002'], language: 'en' };
  /* A Claude that tries to "improve" the book: a spelling change and deleting a whole paragraph. */
  const meddler = await fakeClaude((part) => {
    const id = /\[(b\d+) p p\.2\] Every evening/.exec(part)[1];
    return { edits: [edit({ op: 'word', block: id, from: 'keeper', to: 'kepper' }), edit({ op: 'delete', block: id })] };
  });
  files.registerFileSource({ name: 'shelf', async find() { return [{ id: 'k.pdf', format: 'pdf', size: pdf.length, label: null, language: null, sample: false }]; }, async open(id, range) { return files.sliceOf(pdf, id, range); } });
  try {
    convert.registerConversions({ dir: join(state, 'converted'), bookFor: () => record, token: async () => '' });
    await convert.converted(record.key, 'shelf:k.pdf');
    assert.equal((await convert.conversionReport('shelf:k.pdf')).llm, null);

    convert.registerConversions({ dir: join(state, 'converted'), bookFor: () => record, token: async () => 'sk-ant-api03-test', restructurer: (t) => restructure.claudeRestructurer(t, { baseURL: meddler.url }) });
    await convert.converted(record.key, 'shelf:k2.pdf');
    const report = await convert.conversionReport('shelf:k2.pdf');
    assert.equal(report.llm.sent, 1);
    assert.equal(report.llm.refused, 2);
    const address = `converted:${convert.convertedId(record.key, 'shelf:k2.pdf')}`;
    const read = textOf(unzip(new Uint8Array(await new Response((await files.openFile(address)).body).arrayBuffer())).filter((e) => /part\d+\.xhtml$/.test(e.name)).map((e) => e.data.toString()).join(' '));
    assert.match(read, /Every evening the keeper climbed/, 'the paragraph and its spelling stay');
  } finally {
    meddler.close();
    files.unregisterFileSource('shelf');
    convert.unregisterConversions();
  }
});
