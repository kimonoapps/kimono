import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/lib/books/model.ts';
import * as files from '../src/lib/books/files.ts';
import { annasFiles, md5IdsIn } from '../src/lib/books/annas-files.ts';

test('ISBNs read in any form, and bad ones are refused', () => {
  assert.equal(model.normalizeIsbn('0-306-40615-2'), '9780306406157');
  assert.equal(model.normalizeIsbn('9780306406157'), '9780306406157');
  assert.equal(model.normalizeIsbn('0306406152 (pbk.)'), '9780306406157');
  assert.equal(model.normalizeIsbn('ISBN 080442957X'), '9780804429573');
  assert.equal(model.normalizeIsbn('0306406153'), null);
  assert.equal(model.normalizeIsbn('hello'), null);
});

test('genres keep the recognised ones, with fiction last', () => {
  assert.deepEqual(model.genresOf(['Ghosts', 'Fiction', 'Fantasy', 'Wizards', 'Juvenile fiction', 'nyt:bestseller']), ['Fantasy', "Children's", 'Fiction']);
  assert.deepEqual(model.genresOf(['Wizards', 'Owls']), ['Wizards', 'Owls']);
});

test('the same book from two sources merges, the readers’ summary winning', () => {
  const ol = { ...model.emptyBook('ol:OL1W', 'The Book'), authors: ['A. Writer'], description: 'Chapter one began like this, a long passage from the book itself.', genres: ['Ghosts'], readers: 10, cover: 'ol.jpg' };
  const hc = { ...model.emptyBook('hc:1', 'The Book'), authors: ['A. Writer'], description: 'A summary a reader would write, telling what the book is about without quoting it.', genres: ['Fantasy'], readers: 500, rating: 4.1, ratings: 90 };
  const [one, ...rest] = model.dedupe([ol, hc]);
  assert.equal(rest.length, 0);
  assert.equal(one.key, 'ol:OL1W');
  assert.equal(one.cover, 'ol.jpg');
  assert.deepEqual(one.genres, ['Fantasy']);
  assert.match(one.description, /^A summary/);
  assert.equal(one.readers, 500);
  assert.equal(one.rating, 4.1);
});

test('file sources: found across sources, best first, and opened by range', async () => {
  const bytes = new TextEncoder().encode('0123456789abcdef');
  files.registerFileSource({
    name: 'slow', async find() { await new Promise((r) => setTimeout(r, 200)); return [{ id: 'x', format: 'pdf', size: 1, label: null, language: null, sample: false }]; },
    async open() { throw new Error('unused'); },
  });
  files.registerFileSource({
    name: 'fake',
    async find(book) { return book.isbns.includes('9780306406157') ? [{ id: 'sample', format: 'epub', size: 16, label: 'Sample', language: 'en', sample: true }, { id: 'full', format: 'epub', size: 16, label: null, language: 'en', sample: false }] : []; },
    async open(id, range) { return files.sliceOf(bytes, `${id}.epub`, range); },
  });
  files.registerFileSource({ name: 'broken', async find() { throw new Error('down'); }, async open() { throw new Error('down'); } });
  const book = { ...model.emptyBook('ol:OL1W', 'T'), isbns: ['9780306406157'] };
  const found = await files.filesFor(book, 100);
  assert.deepEqual(found.map(files.fileAddress), ['fake:full', 'fake:sample']); // slow timed out, broken left out
  const whole = await files.openFile('fake:full');
  assert.equal(whole.size, 16);
  assert.equal(whole.range, null);
  const part = await files.openFile('fake:full', files.parseRange('bytes=4-7'));
  assert.deepEqual(part.range, { start: 4, end: 7 });
  assert.equal(await new Response(part.body).text(), '4567');
  const tail = await files.openFile('fake:full', files.parseRange('bytes=12-'));
  assert.equal(await new Response(tail.body).text(), 'cdef');
  await assert.rejects(files.openFile('fake:full', { start: 99 }), (e) => e.status === 416);
  await assert.rejects(files.openFile('nowhere:full'), (e) => e.status === 404);
  assert.throws(() => files.registerFileSource({ name: 'Bad Name', find: async () => [], open: async () => { throw new Error(); } }));
  for (const n of ['slow', 'fake', 'broken']) files.unregisterFileSource(n);
  assert.equal(files.fileSources().length, 0);
});

test('Anna fast downloads: discover a file, resolve it privately, and stream a range', async (t) => {
  const md5 = 'd6e1dc51a50726f00ec438af21952a45';
  const bytes = new TextEncoder().encode('0123456789abcdef');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.origin === 'https://books.example') {
      if (url.pathname === '/account/') return new Response(null, { headers: { 'set-cookie': 'aa_account_id2=test; Path=/' } });
      if (url.pathname === '/search') {
        /* As Anna's lists files: one result per block, the details on the page itself. */
        const result = (hash, title, author, line) => `<div class="flex  pt-3 pb-3 border-b last:border-b-0 border-gray-100"><a href="/md5/${hash}" class="custom-a"></a>
          <div><a href="/md5/${hash}" class="line-clamp-[3] custom-a font-semibold text-lg leading-[1.2]">${title}</a><a href="/search?q=x" class="text-sm"><span class="icon-[mdi--user-edit] text-base align-sub"></span> ${author}</a></div>
          <div class="text-gray-800 dark:text-slate-400 font-semibold text-sm leading-[1.2] mt-2">${line}</div></div>`;
        return new Response([
          result(md5, 'The Book', 'Writer, A.', 'English [en] · EPUB · 16 KB · 2020 · 📗 Book'),
          result('a'.repeat(32), 'Another Book Entirely', 'Someone Else', 'English [en] · EPUB · 1.0MB · 2019'),
          result('b'.repeat(32), 'The Book', 'Writer, A.', 'English [en] · MOBI · 1.0MB · 2019'),
        ].join(''));
      }
      if (url.pathname === `/db/aarecord_elasticsearch/md5:${md5}.json`) return Response.json({ file_unified_data: {
        title_best: 'The Book', author_best: 'Writer, A.', extension_best: 'epub', filesize_best: 16, language_codes: ['en'],
      } });
      if (url.pathname === '/dyn/api/fast_download.json') {
        if (url.searchParams.get('md5') === '0'.repeat(32)) return Response.json({ download_url: null, error: 'Invalid md5' }, { status: 400 });
        return Response.json({ download_url: 'https://cdn.example/member/The%20Book.epub', account_fast_download_info: {} });
      }
    }
    if (url.origin === 'https://cdn.example') return new Response(bytes.subarray(4, 8), { status: 206, headers: {
      'content-range': 'bytes 4-7/16', 'content-length': '4', 'content-disposition': 'attachment; filename="The Book.epub"',
    } });
    throw new Error(`Unexpected request: ${url}`);
  });

  const source = annasFiles(async () => ({ url: 'https://books.example', key: 'member-secret', pathIndex: 2, domainIndex: 1 }));
  const book = { ...model.emptyBook('ol:OL1W', 'The Book'), authors: ['A. Writer'], isbns: ['9780306406157'] };
  const found = await source.find(book);
  assert.deepEqual(md5IdsIn(`<a href="/md5/${md5}">one</a><a href="/md5/${md5}">again</a>`), [md5]);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], { id: `${md5}.2.1.epub`, format: 'epub', size: 16 * 1024, label: 'English · 2020', language: 'en', sample: false });
  const searched = requests.filter((r) => r.url.pathname === '/search').map((r) => r.url.searchParams.get('q'));
  assert.deepEqual(searched.sort(), ['9780306406157', 'The Book A. Writer']);

  const opened = await source.open(found[0].id, { start: 4, end: 7 });
  assert.equal(opened.size, 16);
  assert.deepEqual(opened.range, { start: 4, end: 7 });
  assert.equal(opened.filename, 'The Book.epub');
  assert.equal(await new Response(opened.body).text(), '4567');
  const api = requests.find((r) => r.url.pathname === '/dyn/api/fast_download.json');
  assert.equal(api.url.searchParams.get('md5'), md5);
  assert.equal(api.url.searchParams.get('key'), 'member-secret');
  assert.equal(api.url.searchParams.get('path_index'), '2');
  assert.equal(api.url.searchParams.get('domain_index'), '1');
  const download = requests.find((r) => r.url.origin === 'https://cdn.example');
  assert.equal(download.url.searchParams.get('key'), null);
  assert.equal(download.init.headers.get('range'), 'bytes=4-7');

  await assert.rejects(source.open(`${'0'.repeat(32)}.0.0.epub`), (e) => e.status === 400 && e.message === "Anna's Archive: Invalid md5");
  await assert.rejects(source.open('not-an-md5'), (e) => e.status === 404);
  const unconfigured = annasFiles(async () => null);
  assert.deepEqual(await unconfigured.find(book), []);
  await assert.rejects(unconfigured.open(`${md5}.0.0.epub`), (e) => e.status === 404);
});

import { mkdtempSync, writeFileSync as writeFs, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import * as cache from '../src/lib/books/cache.ts';
import * as parts from '../src/lib/books/epub-parts.ts';

/* A small zip, written by hand: stored and deflated parts, as EPUBs have. */
function zip(entries) {
  const locals = []; const central = []; let offset = 0;
  for (const [name, text, deflate] of entries) {
    const raw = Buffer.from(text); const data = deflate ? deflateRawSync(raw) : raw; const n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(deflate ? 8 : 0, 10);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(local, n, data); central.push(cd, n); offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

test('an EPUB is read a part at a time, and nothing outside it', () => {
  const dir = mkdtempSync(joinPath(tmpdir(), 'kb-'));
  const path = joinPath(dir, 'book.epub');
  writeFs(path, zip([['mimetype', 'application/epub+zip', false], ['META-INF/container.xml', '<container>c</container>', true], ['OEBPS/Ch 1.xhtml', '<p>' + 'words '.repeat(500) + '</p>', true]]));
  assert.equal(parts.directoryOf(path).parts.size, 3);
  assert.equal(parts.readPart(path, 'mimetype').bytes.toString(), 'application/epub+zip');
  assert.equal(parts.readPart(path, 'META-INF/container.xml').bytes.toString(), '<container>c</container>');
  assert.match(parts.readPart(path, 'OEBPS/Ch%201.xhtml').bytes.toString(), /^<p>words words/);
  assert.match(parts.readPart(path, 'oebps/ch 1.XHTML').bytes.toString(), /^<p>/); // case differs: still found
  assert.throws(() => parts.readPart(path, '../../etc/passwd'), (e) => e.status === 404);
  assert.throws(() => parts.readPart(path, 'OEBPS/missing.xhtml'), (e) => e.status === 404);
  assert.equal(parts.typeOfPart('a/b.XHTML'), 'application/xhtml+xml; charset=utf-8');
  assert.equal(parts.addressOfPathId(parts.bookPathId('test:9780141439471.epub')), 'test:9780141439471.epub');
});

test('the file cache: first from the source, then from disk; one copy at a time; old books make room', async () => {
  const dir = mkdtempSync(joinPath(tmpdir(), 'kb-cache-'));
  let opened = 0;
  const bytes = (n, c) => new Uint8Array(n).fill(c);
  const books = { 'fake:a': bytes(400, 1), 'fake:b': bytes(400, 2), 'fake:c': bytes(400, 3) };
  files.registerFileSource({ name: 'fake', async find() { return []; }, async open(id, range) { opened++; await new Promise((r) => setTimeout(r, 20)); return files.sliceOf(books[`fake:${id}`], `${id}.epub`, range); } });
  const c = new cache.FileCache(dir, 1000);
  /* First opening: from the source, and the copy fills behind it, once even when asked three times. */
  const first = await cache.openCached(c, 'fake:a', { start: 0, end: 9 });
  assert.equal((await new Response(first.body).arrayBuffer()).byteLength, 10);
  await Promise.all([c.fill('fake:a'), c.fill('fake:a')]);
  const afterFill = opened;
  assert.ok(afterFill <= 2, `the source was opened ${afterFill} times`);
  /* Then from disk: the source isn't asked again, and ranges come from the copy. */
  const again = await cache.openCached(c, 'fake:a', { start: 390 });
  assert.equal(opened, afterFill);
  assert.deepEqual(again.range, { start: 390, end: 399 });
  assert.equal((await new Response(again.body).arrayBuffer()).byteLength, 10);
  /* Past the cap (1000 bytes), the least recently opened goes. */
  await c.fill('fake:b');
  c.get('fake:a'); // a was opened more recently than b
  await c.fill('fake:c');
  assert.ok(c.get('fake:a'), 'a stays');
  assert.equal(c.get('fake:b'), null, 'b made room');
  assert.ok(c.get('fake:c'));
  assert.ok(!readdirSync(dir).some((f) => f.endsWith('.part')), 'no half copies left');
  files.unregisterFileSource('fake');
});
