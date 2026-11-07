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

test('someone with no notebook gets "Notes" in their own space, made once', () => {
  const db = fresh();
  const [first] = notes.ensureNotebook(db, 'Akram');
  assert.equal(first.name, 'Notes');
  assert.equal(first.space.name, 'Personal');
  assert.equal(first.isSpace, false);
  assert.equal(notes.ensureNotebook(db, 'akram').length, 1);
  assert.equal(drive.spacesOf(db, 'akram').length, 1, 'one space, not one per notebook');
  /* Someone who already owns a space of their own gets it there. */
  const mine = drive.createSpace(db, 'mina', { name: 'Mina' });
  assert.equal(notes.ensureNotebook(db, 'mina')[0].space.id, mine.id);
});

test('notebooks are folders in any space; Drive marks them, and sees who shares one by its space', () => {
  const db = fresh();
  const family = drive.createSpace(db, 'akram', { name: 'Family', members: [{ username: 'mina', role: 'editor' }] });
  const book = notes.createNotebook(db, 'akram', { name: 'Recipes', space: family.id });
  assert.equal(drive.nodeFor(db, book.id, 'akram').purpose, 'notebook');
  assert.equal(book.space.members, 2);
  assert.deepEqual(notes.notebooksOf(db, 'mina').map((n) => n.name), ['Recipes']);
  assert.equal(notes.notebookPlace(book), 'Family / Recipes');
});

test('a library lists sections and Markdown notes only, newest first, skipping the trash', () => {
  const db = fresh();
  const [book] = notes.ensureNotebook(db, 'akram');
  const recipes = drive.createFolder(db, book.id, 'akram', 'Recipes');
  drive.addFile(db, book.id, 'akram', md('Groceries.md'), 1000);
  const curry = drive.addFile(db, recipes.id, 'akram', md('Curry.md'), 2000);
  drive.addFile(db, book.id, 'akram', { ...md('photo.png'), mime: 'image/png' }, 3000);
  const gone = drive.addFile(db, book.id, 'akram', md('Old.md'), 4000);
  drive.trashNode(db, gone.id, 'akram');
  /* Markdown beside the notebook, in the same space, isn't a note. */
  const loose = drive.addFile(db, drive.spacesOf(db, 'akram')[0].rootId, 'akram', md('Readme.md'));
  const lib = notes.libraryOf(db, 'akram');
  assert.deepEqual(lib.sections.map((s) => s.name), ['Recipes']);
  assert.deepEqual(lib.notes.map((n) => n.title), ['Curry', 'Groceries']);
  assert.equal(lib.notes[0].notebookId, book.id);
  assert.equal(lib.notes[0].parentId, recipes.id);
  assert.equal(notes.noteFor(db, curry.id, 'akram').title, 'Curry');
  assert.throws(() => notes.noteFor(db, loose.id, 'akram'), /isn't a note/);
  assert.throws(() => notes.noteFor(db, curry.id, 'mina'), (e) => e.status === 404);
  assert.equal(notes.placeFor(db, recipes.id, 'akram').notebookId, book.id);
});

test('a notebook moved inside another is a section of it', () => {
  const db = fresh();
  const [outer] = notes.ensureNotebook(db, 'akram');
  const inner = notes.createNotebook(db, 'akram', { name: 'Inner' });
  drive.moveNode(db, inner.id, 'akram', outer.id);
  assert.deepEqual(notes.notebooksOf(db, 'akram').map((n) => n.name), ['Notes']);
  assert.deepEqual(notes.libraryOf(db, 'akram').sections.map((s) => s.name), ['Inner']);
});

test('a notebook shared on its own becomes a space and stays a notebook', () => {
  const db = fresh();
  const trip = notes.createNotebook(db, 'akram', { name: 'Kyoto trip' });
  drive.addFile(db, trip.id, 'akram', md('Plan.md'));
  drive.folderToSpace(db, trip.id, 'akram', { members: [{ username: 'mina', role: 'editor' }] });
  const shared = notes.notebooksOf(db, 'mina').find((n) => n.name === 'Kyoto trip');
  assert.ok(shared);
  assert.equal(shared.isSpace, true);
  assert.equal(notes.notebookPlace(shared), 'Kyoto trip');
  assert.deepEqual(notes.libraryOf(db, 'mina').notes.map((n) => n.title), ['Plan']);
});

test('a folder can be marked a chat or project, and only by its app', () => {
  const db = fresh();
  const ai = drive.createSpace(db, 'akram', { name: 'AI' });
  const chat = drive.createFolder(db, ai.rootId, 'akram', 'Trip ideas');
  const marked = drive.setPurpose(db, chat.id, 'akram', 'chat', 'w123');
  assert.equal(marked.purpose, 'chat');
  assert.equal(marked.ref, 'w123');
  assert.equal(drive.childrenOf(db, ai.rootId, 'akram').children[0].purpose, 'chat');
  assert.throws(() => drive.setPurpose(db, chat.id, 'akram', 'shrine'));
  assert.throws(() => drive.setPurpose(db, chat.id, 'stranger', 'chat'), (e) => e.status === 404);
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

test('Kimono AI is told which notebooks are theirs and how to write notes', async () => {
  const { notesGuide } = await import('../src/lib/notes/agent.ts');
  assert.equal(notesGuide([]), '');
  const guide = notesGuide([{ name: 'Notes', isSpace: false, space: { name: 'Personal' } }, { name: 'Kyoto trip', isSpace: true, space: { name: 'Kyoto trip' } }]);
  assert.match(guide, /"Personal \/ Notes", "Kyoto trip"/);
  assert.match(guide, /kimono-access ask --space "Personal" --path "Notes"/);
  assert.match(guide, /- \[ \] /);
  assert.match(guide, /kimono-remember is only for what you should know about them/);
});
