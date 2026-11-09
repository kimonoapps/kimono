import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as drive from '../src/lib/drive/model.ts';
import * as notes from '../src/lib/notes/model.ts';
import { importOutline, markdownOf } from '../src/lib/notes/outline-import.ts';

function fresh() {
  const db = new DatabaseSync(':memory:');
  drive.migrate(db);
  return db;
}
const blobs = new Map();
const put = (bytes) => { const id = drive.newId(); blobs.set(id, bytes.toString('utf8')); return id; };
const textOf = (db, id) => blobs.get(db.prepare('SELECT blob FROM nodes WHERE id = ?').get(id).blob);

const accounts = [
  { username: 'akram', email: 'akram@example.com', name: 'Akram' },
  { username: 'sam', email: 'sam@home.test', name: 'Sam' },
];
const dump = {
  users: [
    { id: 'u1', email: 'Akram@Example.com', name: 'Akram B' },
    { id: 'u2', email: 'old-sam@mail.test', name: 'Sam' },
    { id: 'u3', email: 'gone@mail.test', name: 'Gone' },
  ],
  collections: [
    { id: 'c1', name: 'Household', permission: 'read_write', createdById: 'u1', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'c2', name: 'Akram private', permission: null, createdById: 'u1' },
    { id: 'c3', name: 'Ghost', permission: null, createdById: 'u3' },
    { id: 'c4', name: 'Recipes', permission: 'read_write', createdById: 'u1' },
  ],
  userPermissions: [{ userId: 'u1', collectionId: 'c2', permission: 'admin' }, { userId: 'u2', collectionId: 'c4', permission: 'read' }],
  documents: [
    { id: 'd1', title: 'Wi-Fi', text: 'Network: home\n\\\nPassword: hunter2', collectionId: 'c1', createdById: 'u1', publishedAt: '2026-01-02', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
    { id: 'd2', title: 'Trips', text: '', content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] }, { type: 'checkbox_list', content: [{ type: 'checkbox_item', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Book', marks: [{ type: 'strong' }] }] }] }] }] }, collectionId: 'c1', createdById: 'u2', publishedAt: '2026-01-03' },
    { id: 'd3', title: 'Japan / 2027', text: 'Kyoto', collectionId: 'c1', parentDocumentId: 'd2', createdById: 'u2', publishedAt: '2026-01-03' },
    { id: 'd4', title: 'Secret draft', text: 'mine', collectionId: 'c1', createdById: 'u2', publishedAt: null },
    { id: 'd5', title: 'Deleted', text: 'x', collectionId: 'c1', createdById: 'u1', publishedAt: '2026-01-01', deletedAt: '2026-01-05' },
    { id: 'd6', title: 'Diary', text: 'Dear', collectionId: 'c2', createdById: 'u1', publishedAt: '2026-01-01' },
    { id: 'd7', title: 'Old', text: 'then', collectionId: 'c2', createdById: 'u1', publishedAt: '2026-01-01', archivedAt: '2026-01-04' },
    { id: 'd9', title: 'Curry', text: 'spice', collectionId: 'c4', createdById: 'u1', publishedAt: '2026-01-01' },
    { id: 'd8', title: 'Boo', text: 'x', collectionId: 'c3', createdById: 'u3', publishedAt: '2026-01-01' },
  ],
};

test('collections become notebooks shared only with who was added; drafts stay their writer\'s', () => {
  const db = fresh();
  const summary = importOutline(db, dump, accounts, put, Date.parse('2026-11-09'));
  assert.equal(summary.notebooks, 4); // Household, Akram private, Recipes, Sam's Drafts
  assert.equal(summary.notes, 7);
  assert.deepEqual(summary.unmatched, [{ name: 'Gone', email: 'gone@mail.test', documents: 1 }]);

  const akram = notes.libraryOf(db, 'akram');
  assert.deepEqual(akram.notebooks.map((n) => n.name).sort(), ['Akram private', 'Household', 'Recipes']);
  assert.ok(akram.notebooks.every((n) => n.space.name === 'Notes'), 'in their Notes space');
  const sam = notes.libraryOf(db, 'sam');
  const samBooks = sam.notebooks.map((n) => [n.name, n.sharedWithYou, n.role]).sort();
  /* Household was open to the whole Outline workspace, which doesn't make it Sam's; Recipes Sam was added to. */
  assert.deepEqual(samBooks, [['Drafts', false, 'owner'], ['Recipes', true, 'viewer']]);
  assert.ok(!akram.notes.some((n) => n.title === 'Secret draft'));

  const wifi = akram.notes.find((n) => n.title === 'Wi-Fi');
  assert.equal(textOf(db, wifi.id), 'Network: home\n\nPassword: hunter2\n');
  assert.equal(wifi.createdAt, Date.parse('2026-01-02T00:00:00Z'));
  assert.equal(wifi.updatedAt, Date.parse('2026-02-01T00:00:00Z'));

  const trips = akram.notes.find((n) => n.title === 'Trips');
  assert.equal(textOf(db, trips.id), '## Plan\n\n- [x] **Book**\n');
  const section = akram.sections.find((s) => s.name === 'Trips');
  assert.ok(section);
  assert.equal(akram.notes.find((n) => n.title === 'Japan - 2027').parentId, section.id);
  assert.ok(akram.sections.some((s) => s.name === 'Archived'));
});

test('running it again adds nothing', () => {
  const db = fresh();
  importOutline(db, dump, accounts, put);
  const again = importOutline(db, dump, accounts, put);
  assert.equal(again.notes, 0);
  assert.equal(again.notebooks, 0);
  assert.equal(again.alreadyImported, 7);
});

test('a rerun takes back shares an earlier run gave everyone, and keeps ones added since', () => {
  const db = fresh();
  importOutline(db, dump, accounts, put, 1000);
  const household = notes.libraryOf(db, 'akram').notebooks.find((n) => n.name === 'Household');
  drive.shareNode(db, household.id, 'akram', 'sam', 'editor', 1000); // as the first version did
  const later = [...accounts, { username: 'kai', email: 'kai@home.test' }];
  drive.shareNode(db, household.id, 'akram', 'kai', 'viewer', 5000); // shared by hand afterwards
  const again = importOutline(db, dump, later, put, 9000);
  assert.equal(again.unshared, 1);
  assert.ok(!notes.libraryOf(db, 'sam').notebooks.some((n) => n.name === 'Household'));
  assert.ok(notes.libraryOf(db, 'kai').notebooks.some((n) => n.name === 'Household'));
});

test('Outline markdown is tidied', () => {
  assert.equal(markdownOf({ text: 'Hi @[Sam](mention://a/user/b)\n\\\n\\\nok' }), 'Hi @Sam\n\nok\n');
});
