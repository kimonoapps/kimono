import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as drive from '../src/lib/drive/model.ts';
import * as notes from '../src/lib/notes/model.ts';

function fresh() {
  const db = new DatabaseSync(':memory:');
  drive.migrate(db);
  return db;
}
const md = (name, blob = drive.newId()) => ({ name, size: 10, mime: 'text/markdown', blob });

test('everyone gets one notebook of their own, made once', () => {
  const db = fresh();
  const first = notes.ownNotebook(db, 'Akram');
  assert.equal(first.name, 'Notes');
  assert.equal(first.own, true);
  assert.equal(notes.ownNotebook(db, 'akram').id, first.id);
  assert.equal(drive.spacesOf(db, 'akram')[0].purpose, 'notes');
  assert.equal(notes.notebooksOf(db, 'mina').length, 1);
  assert.notEqual(notes.ownNotebook(db, 'mina').id, first.id);
});

test('a library lists sections and Markdown notes only, newest first, skipping the trash', () => {
  const db = fresh();
  const book = notes.ownNotebook(db, 'akram');
  const recipes = drive.createFolder(db, book.rootId, 'akram', 'Recipes');
  drive.addFile(db, book.rootId, 'akram', md('Groceries.md'), 1000);
  const curry = drive.addFile(db, recipes.id, 'akram', md('Curry.md'), 2000);
  drive.addFile(db, book.rootId, 'akram', { ...md('photo.png'), mime: 'image/png' }, 3000);
  const gone = drive.addFile(db, book.rootId, 'akram', md('Old.md'), 4000);
  drive.trashNode(db, gone.id, 'akram');
  drive.createSpace(db, 'akram', { name: 'Files' });
  const lib = notes.libraryOf(db, 'akram');
  assert.deepEqual(lib.sections.map((s) => s.name), ['Recipes']);
  assert.deepEqual(lib.notes.map((n) => n.title), ['Curry', 'Groceries']);
  assert.equal(lib.notes[0].parentId, recipes.id);
  assert.equal(notes.noteFor(db, curry.id, 'akram').title, 'Curry');
  assert.throws(() => notes.noteFor(db, curry.id, 'mina'), (e) => e.status === 404);
});

test('a file outside a notebook is not a note, and notes only go in notebooks', () => {
  const db = fresh();
  const files = drive.createSpace(db, 'akram', { name: 'Files' });
  const readme = drive.addFile(db, files.rootId, 'akram', md('Readme.md'));
  assert.throws(() => notes.noteFor(db, readme.id, 'akram'), /isn't a note/);
  assert.throws(() => notes.placeFor(db, files.rootId, 'akram'), /in a notebook/);
});

test('a shared section becomes a notebook, and its new members see it', () => {
  const db = fresh();
  const book = notes.ownNotebook(db, 'akram');
  const trip = drive.createFolder(db, book.rootId, 'akram', 'Kyoto trip');
  drive.addFile(db, trip.id, 'akram', md('Plan.md'));
  drive.folderToSpace(db, trip.id, 'akram', { members: [{ username: 'mina', role: 'editor' }] });
  const shared = notes.notebooksOf(db, 'mina').find((n) => n.name === 'Kyoto trip');
  assert.ok(shared);
  assert.equal(shared.own, false);
  assert.deepEqual(notes.libraryOf(db, 'mina').notes.map((n) => n.title), ['Plan']);
});

test('titles become file names and back', () => {
  assert.equal(notes.noteName('Groceries'), 'Groceries.md');
  assert.equal(notes.noteName('  '), 'Untitled.md');
  assert.throws(() => notes.noteName('a/b'));
  assert.equal(notes.titleOf('Plan.MD'), 'Plan');
  assert.equal(notes.isNoteName('.md'), false);
});

test('an excerpt is the prose, without the title line or markup', () => {
  assert.equal(notes.excerptOf('# Groceries\n\n- [ ] **Milk**\n- [x] [Eggs](https://x)\n\n```js\ncode\n```\nDone'), 'Milk Eggs Done');
  assert.equal(notes.excerptOf('a'.repeat(200), 10), `${'a'.repeat(10)}…`);
});
