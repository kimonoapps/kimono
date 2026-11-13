import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/lib/books/model.ts';
import * as files from '../src/lib/books/files.ts';

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
