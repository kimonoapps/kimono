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

/* ── Claude, stood in for: a local server speaking the Messages API's stream, answering with the text it was sent. ── */

function fakeClaude(answer = (text) => text) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const request = JSON.parse(body);
      seen.push({ request, headers: req.headers });
      const asked = request.messages[0].content;
      const text = answer(asked.slice(asked.indexOf('\n\n') + 2));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      send('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model: request.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
      send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      for (let i = 0; i < text.length; i += 400) send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 400) } });
      send('content_block_stop', { index: 0 });
      send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
      send('message_stop', {});
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() })));
}

/* ── The rules alone ── */

test('broken words join at a line end; real hyphens and new sentences stay', () => {
  assert.equal(structure.join('no longer remem-', 'bered learning'), 'no longer remembered learning');
  assert.equal(structure.join('a well-', 'Known name'), 'a well-Known name');
  assert.equal(structure.join('the old', 'tower'), 'the old tower');
  assert.equal(structure.join('', 'first'), 'first');
});

test('the word check passes restructuring and refuses rewriting, and notes must survive', () => {
  const base = 'Every evening the keeper climbed the ninety steps of the old tower.[^1]\n\n[^1]: Rebuilt twice.\n\n12\n\nShe had done it for so long.';
  const moved = 'Every evening the keeper climbed the ninety steps of the old tower.[^1] She had done it for so long.\n\n[^1]: Rebuilt twice.';
  assert.equal(restructure.check(base, moved).accepted, true);
  assert.equal(restructure.check(base, 'The keeper climbed a tower every night.[^1]\n\n[^1]: Rebuilt twice.').accepted, false); // a summary
  assert.equal(restructure.check(base, moved.replace('[^1] ', ' ')).accepted, false); // a note mark lost
  assert.equal(restructure.check(base, null).text, base);
  assert.equal(restructure.check(base, '```\n' + moved + '\n```').accepted, true); // a fence around the answer is shed
});

test('parts are cut between blocks and keep a note with its paragraph', () => {
  const text = Array.from({ length: 30 }, (_, i) => i === 10 ? '[^1]: A note.' : i === 20 ? '# Two' : `Paragraph ${i} ${'word '.repeat(40)}`).join('\n\n');
  const cut = restructure.parts(text, 300);
  assert.ok(cut.length > 2);
  assert.equal(cut.join('\n\n'), text);
  assert.ok(cut.every((p) => !p.startsWith('[^')));
  assert.ok(cut.some((p) => p.startsWith('# Two')));
});

test('an EPUB from the text format: valid, notes linked across files, contents from the headings', () => {
  const text = `# One\n\nA *first* paragraph with a note.[^1] And a literal \\* star & an <angle>.\n\n[^1]: The note.\n\n## A section\n\n${'Words '.repeat(6000)}\n\n# Two\n\nThe end.`;
  const built = epub.buildEpub(text, { id: 'urn:isbn:9780306406157', title: 'T & T', authors: ['A. Writer'], isbn: '9780306406157', language: 'en' }, null);
  const entries = unzip(built.bytes);
  assert.equal(entries[0].name, 'mimetype');
  assert.equal(entries[0].method, 0);
  assert.equal(entries[0].data.toString(), 'application/epub+zip');
  for (const e of entries) if (/\.(x?html|opf|ncx|xml)$/.test(e.name)) wellFormed(e.data.toString(), e.name);
  assert.deepEqual(built.chapters, ['One', 'Two']);
  const first = entries.find((e) => e.name === 'OEBPS/text/part0001.xhtml').data.toString();
  assert.match(first, /<i>first<\/i>/);
  assert.match(first, /literal \* star &amp; an &lt;angle&gt;/);
  assert.match(first, /<a epub:type="noteref" id="r1" href="#n1">/);
  assert.match(first, /<aside epub:type="footnote" id="n1"><p><a href="#r1">1<\/a>\. The note\.<\/p><\/aside>/);
  assert.ok(entries.some((e) => e.name === 'OEBPS/text/part0002.xhtml'), 'a long chapter is cut into files');
});

test('a record\'s language becomes an EPUB language tag', () => {
  assert.equal(epub.languageTag('spa'), 'es');
  assert.equal(epub.languageTag('en'), 'en');
  assert.equal(epub.languageTag('pt-BR'), 'pt-br');
  assert.equal(epub.languageTag(''), 'en');
});

test('chapters marked one level down still become chapters', () => {
  const built = epub.buildEpub('# The Book\n\nBy someone.\n\n## One\n\nFirst.\n\n### A part\n\nMore.\n\n## Two\n\nSecond.', { id: 'x', title: 'The Book', authors: [], isbn: null, language: 'en' }, null);
  assert.deepEqual(built.chapters, ['The Book', 'One', 'Two']);
  const files = unzip(built.bytes).filter((e) => /part\d+\.xhtml$/.test(e.name)).map((e) => e.data.toString());
  assert.match(files[1], /<h1>One<\/h1>[\s\S]*<h2>A part<\/h2>/);
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
    assert.equal(claude.seen[0].request.model, 'claude-opus-5-5');
    assert.equal(claude.seen[0].request.stream, true);
    assert.match(claude.seen[0].request.system.at(-1).text, /never rewrite, summarise/);

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
    assert.ok(get('OEBPS/cover.jpg') !== undefined && entries.find((e) => e.name === 'OEBPS/cover.jpg').data.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])), 'the cover is the first page as a JPEG');
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
    const { kept, faithful } = structure.overlap(expectedWords, read.replace(/\b(\d)\. /g, ' '));
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
    assert.equal(report.notes, 2);
  } finally {
    claude.close();
    files.unregisterFileSource('shelf');
    convert.unregisterConversions();
  }
});

test('without a Claude token the base conversion alone is used, and an answer that rewrites is refused', { skip: !poppler && 'poppler (pdftohtml) is not installed' }, async () => {
  const pdf = makePdf(book);
  const record = { key: 'ol:TEST2W', title: 'The Lantern Keeper', authors: [], isbns: ['9780000000002'], language: 'en' };
  const summariser = await fakeClaude(() => '# Chapter One\n\nA keeper lights a tower each night and keeps notebooks.');
  files.registerFileSource({ name: 'shelf', async find() { return [{ id: 'k.pdf', format: 'pdf', size: pdf.length, label: null, language: null, sample: false }]; }, async open(id, range) { return files.sliceOf(pdf, id, range); } });
  try {
    convert.registerConversions({ dir: join(state, 'converted'), bookFor: () => record, token: async () => '' });
    await convert.converted(record.key, 'shelf:k.pdf');
    assert.equal((await convert.conversionReport('shelf:k.pdf')).llm, null);

    convert.registerConversions({ dir: join(state, 'converted'), bookFor: () => record, token: async () => 'sk-ant-api03-test', restructurer: (t) => restructure.claudeRestructurer(t, { baseURL: summariser.url }) });
    await convert.converted(record.key, 'shelf:k2.pdf');
    const report = await convert.conversionReport('shelf:k2.pdf');
    assert.equal(report.llm.sent, 1);
    assert.equal(report.llm.accepted, 0);
    assert.match(report.llm.rejected[0], /words changed/);
    const address = `converted:${convert.convertedId(record.key, 'shelf:k2.pdf')}`;
    const read = textOf(unzip(new Uint8Array(await new Response((await files.openFile(address)).body).arrayBuffer())).filter((e) => /part\d+\.xhtml$/.test(e.name)).map((e) => e.data.toString()).join(' '));
    assert.match(read, /no longer remembered learning how/, 'the base text was kept');
  } finally {
    summariser.close();
    files.unregisterFileSource('shelf');
    convert.unregisterConversions();
  }
});
