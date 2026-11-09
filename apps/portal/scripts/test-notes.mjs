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

test('someone with no notebook gets "Notes" in their own Notes space, made once', () => {
  const db = fresh();
  const [first] = notes.ensureNotebook(db, 'Akram');
  assert.equal(first.name, 'Notes');
  assert.equal(first.space.name, 'Notes');
  assert.equal(first.isSpace, false);
  assert.equal(notes.ensureNotebook(db, 'akram').length, 1);
  assert.equal(drive.spacesOf(db, 'akram').length, 1, 'one space, not one per notebook');
  assert.equal(drive.spacesOf(db, 'akram')[0].purpose, 'notes', 'Drive knows it as the Notes space');
  /* New notebooks go there too. */
  assert.equal(notes.createNotebook(db, 'akram', { name: 'Ideas' }).space.id, first.space.id);
});

test('notebooks in spaces only you are in move into the Notes space when it is made; shared ones stay', () => {
  const db = fresh();
  const mine = drive.createSpace(db, 'mina', { name: 'Mina' });
  const family = drive.createSpace(db, 'mina', { name: 'Family', members: [{ username: 'sam', role: 'editor' }] });
  const solo = drive.createFolder(db, mine.rootId, 'mina', 'Journal');
  drive.setPurpose(db, solo.id, 'mina', 'notebook');
  drive.addFile(db, solo.id, 'mina', md('Monday.md'));
  drive.shareNode(db, solo.id, 'mina', 'sam', 'viewer');
  const together = notes.createNotebook(db, 'mina', { name: 'Recipes', space: family.id });
  notes.ensureNotebook(db, 'mina');
  const space = notes.personalSpace(db, 'mina');
  assert.equal(space.purpose, 'notes');
  const books = Object.fromEntries(notes.notebooksOf(db, 'mina').map((b) => [b.name, b]));
  assert.equal(books.Journal.space.id, space.id, 'the solo notebook moved');
  assert.equal(books.Recipes.space.id, family.id, 'the shared one stayed');
  assert.equal(notes.libraryOf(db, 'mina').notes.length, 1, 'its notes came with it');
  assert.ok(notes.notebooksOf(db, 'sam').some((b) => b.id === solo.id), 'its own shares came with it');
  assert.equal(together.space.id, family.id);
  /* Deleted (here, left to someone else), it is made again; later solo notebooks aren't moved again. */
  const later = notes.createNotebook(db, 'mina', { name: 'Scratch', space: mine.id });
  db.prepare("UPDATE members SET role = 'editor' WHERE space_id = ?").run(space.id);
  const again = notes.personalSpace(db, 'mina');
  assert.notEqual(again.id, space.id);
  assert.equal(notes.notebooksOf(db, 'mina').find((b) => b.id === later.id).space.id, mine.id);
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
  assert.equal(notes.excerptOf('# Groceries\n\n- [ ] **Milk**\n- [x] [Eggs](https://x)\n\n```js\ncode\n```\nDone'), 'Milk · Eggs · Done');
  assert.equal(notes.excerptOf('a'.repeat(200), 10), `${'a'.repeat(10)}…`);
});

test('Kimono AI is told which notebooks are theirs and how to write notes', async () => {
  const { notesGuide } = await import('../src/lib/notes/agent.ts');
  assert.equal(notesGuide([]), '');
  const guide = notesGuide([{ name: 'Notes', isSpace: false, space: { name: 'Notes' } }, { name: 'Kyoto trip', isSpace: true, space: { name: 'Kyoto trip' } }]);
  assert.match(guide, /"Notes \/ Notes", "Kyoto trip"/);
  assert.match(guide, /kimono-access ask --space "Notes" --path "Notes"/);
  assert.match(guide, /- \[ \] /);
  assert.match(guide, /kimono-remember is only for what you should know about them/);
});

test('a notebook shared with someone outside its space stays put, and they can write in it', () => {
  const db = fresh();
  const family = drive.createSpace(db, 'akram', { name: 'Family', members: [{ username: 'mina', role: 'editor' }] });
  const book = notes.createNotebook(db, 'akram', { name: 'Recipes', space: family.id });
  const curry = drive.addFile(db, book.id, 'akram', md('Curry.md'));
  /* An editor in the space may share it. */
  drive.shareNode(db, book.id, 'mina', 'ren', 'editor');
  assert.equal(notes.notebooksOf(db, 'akram')[0].space.members, 2, 'Family keeps it');
  const seen = notes.notebooksOf(db, 'ren').find((n) => n.id === book.id);
  assert.ok(seen);
  assert.equal(seen.sharedWithYou, true);
  assert.equal(seen.space.name, '', "ren doesn't see the space's name");
  assert.deepEqual(notes.libraryOf(db, 'ren').notes.map((n) => n.title), ['Curry']);
  drive.addFile(db, book.id, 'ren', md('Dal.md'));
  assert.throws(() => drive.childrenOf(db, family.rootId, 'ren'), (e) => e.status === 404, 'nothing else in Family');
  assert.throws(() => drive.trashNode(db, book.id, 'ren'), /Leave it instead/);
  assert.equal(drive.childrenOf(db, book.id, 'ren').path.length, 0, 'the way up stops at what was shared');
  /* Their own first notebook still gets made, beside the shared one. */
  assert.ok(notes.notebooksOf(db, 'ren').some((n) => !n.sharedWithYou));
  /* Viewers read only; people can be changed and taken off; anyone may leave. */
  drive.shareNode(db, book.id, 'akram', 'ren', 'viewer');
  assert.throws(() => drive.addFile(db, book.id, 'ren', md('More.md')), (e) => e.status === 403);
  assert.deepEqual(drive.sharesOn(db, book.id, 'akram').shares.map((s) => [s.username, s.role]), [['ren', 'viewer']]);
  drive.shareNode(db, book.id, 'ren', 'ren', null);
  assert.throws(() => notes.noteFor(db, curry.id, 'ren'), (e) => e.status === 404);
});

test("sharing is refused to viewers, to people already in the space, and for a space's top", () => {
  const db = fresh();
  const family = drive.createSpace(db, 'akram', { name: 'Family', members: [{ username: 'mina', role: 'viewer' }] });
  const book = notes.createNotebook(db, 'akram', { name: 'Recipes', space: family.id });
  assert.throws(() => drive.shareNode(db, book.id, 'mina', 'ren', 'viewer'), (e) => e.status === 403);
  assert.throws(() => drive.shareNode(db, book.id, 'akram', 'mina', 'editor'), /already in Family/);
  assert.throws(() => drive.shareNode(db, family.rootId, 'akram', 'ren', 'editor'), /space instead/);
  assert.throws(() => drive.shareNode(db, book.id, 'akram', 'ren', 'owner'), /editor or a viewer/);
});

test('one note can be shared on its own; it stands outside their notebooks', () => {
  const db = fresh();
  const [book] = notes.ensureNotebook(db, 'akram');
  const wifi = drive.addFile(db, book.id, 'akram', md('Wi-Fi.md'));
  drive.addFile(db, book.id, 'akram', md('Private.md'));
  drive.shareNode(db, wifi.id, 'akram', 'guest', 'viewer');
  const lib = notes.libraryOf(db, 'guest');
  assert.deepEqual(lib.notes.map((n) => [n.title, n.notebookId]), [['Wi-Fi', null]]);
  assert.equal(notes.noteFor(db, wifi.id, 'guest').notebookId, null);
  assert.deepEqual(drive.sharedWithYou(db, 'guest').map((n) => [n.name, n.parentId]), [['Wi-Fi.md', null]]);
  /* The note's shares say it also comes with nothing above; the notebook's would show on the note as inherited. */
  drive.shareNode(db, book.id, 'akram', 'mina', 'editor');
  assert.deepEqual(drive.sharesOn(db, wifi.id, 'akram').inherited.map((s) => [s.username, s.via.name]), [['mina', 'Notes']]);
});

test('a share reaches their devices through the change log, and leaves it when taken off', () => {
  const db = fresh();
  const [book] = notes.ensureNotebook(db, 'akram');
  const cursor = drive.latestChange(db);
  drive.shareNode(db, book.id, 'akram', 'ren', 'editor');
  const plan = drive.addFile(db, book.id, 'akram', md('Plan.md'));
  const seen = drive.changesFor(db, 'ren', cursor);
  assert.deepEqual(seen.changed.map((n) => [n.name, n.parentId === null]).sort(), [['Notes', true], ['Plan.md', false]]);
  const after = seen.cursor;
  drive.shareNode(db, book.id, 'akram', 'ren', null);
  assert.ok(drive.changesFor(db, 'ren', after).removed.includes(book.id));
  assert.ok(!drive.changesFor(db, 'ren', 0).changed.some((n) => n.id === plan.id));
});

test('a notebook can have a public link that shows its notes, and stops when trashed', () => {
  const db = fresh();
  const [book] = notes.ensureNotebook(db, 'akram');
  drive.addFile(db, book.id, 'akram', md('Recipes.md'));
  const token = drive.linkFile(db, book.id, 'akram');
  assert.deepEqual(drive.publicFolder(db, token).nodes.map((n) => n.name), ['Recipes.md']);
  const plain = drive.createFolder(db, drive.spacesOf(db, 'akram')[0].rootId, 'akram', 'Plain');
  assert.throws(() => drive.linkFile(db, plain.id, 'akram'), /files and notebooks/);
  drive.trashNode(db, book.id, 'akram');
  assert.equal(drive.publicFolder(db, token), null);
});
