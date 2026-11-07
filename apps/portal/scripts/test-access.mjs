import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as model from '../src/lib/code/model.ts';
import { accessNote, coveringGrant, covers, needOn, openedDir, readOnly, segment } from '../src/lib/code/access-plan.ts';

const g = (over) => ({ id: 'g', username: 'mina', workspaceId: null, spaceId: 's', nodeId: 'root', need: 'read', ...over });
/* IMG.jpg in 2026 in Photos: nearest first. */
const chain = ['img', '2026', 'root'];

test('change includes read; read does not include change', () => {
  assert.equal(covers('change', 'read'), true);
  assert.equal(covers('read', 'change'), false);
});

test('a grant covers what is under it, for its own chat or always, for its own person', () => {
  assert.ok(coveringGrant([g({})], 'mina', 'chat1', chain, 'read'), 'always read on the space covers a file in it');
  assert.equal(coveringGrant([g({})], 'mina', 'chat1', chain, 'change'), null, 'read does not allow change');
  assert.equal(coveringGrant([g({ workspaceId: 'chat2' })], 'mina', 'chat1', chain, 'read'), null, "another chat's grant is not this chat's");
  assert.ok(coveringGrant([g({ workspaceId: 'chat1' })], 'mina', 'chat1', chain, 'read'));
  assert.equal(coveringGrant([g({})], 'sam', 'chat1', chain, 'read'), null, "someone else's grant is not theirs");
  assert.equal(coveringGrant([g({ nodeId: 'other' })], 'mina', 'chat1', chain, 'read'), null, 'a grant elsewhere covers nothing here');
  assert.equal(coveringGrant([g({ nodeId: 'img' })], 'mina', 'chat1', ['2026', 'root'], 'read'), null, 'a file grant does not open its folder');
});

test('the strongest permission on an open node is what it gets', () => {
  assert.equal(needOn([g({}), g({ id: 'h', nodeId: '2026', need: 'change', workspaceId: 'chat1' })], 'mina', 'chat1', chain), 'change');
  assert.equal(needOn([g({})], 'mina', 'chat1', chain), 'read');
  assert.equal(needOn([], 'mina', 'chat1', chain), null);
});

test('read only: nothing goes out, and what the agent changed is put back', () => {
  const out = readOnly([
    { kind: 'upload', path: 'new.txt' },
    { kind: 'update', path: 'a.txt', nodeId: 'n1' },
    { kind: 'trash', path: 'b.txt', nodeId: 'n2' },
    { kind: 'conflict', path: 'c.txt', nodeId: 'n3' },
    { kind: 'conflict', path: 'd.txt', nodeId: null },
    { kind: 'put', path: 'e.txt', nodeId: 'n4' },
  ]);
  assert.deepEqual(out, [
    { kind: 'put', path: 'a.txt', nodeId: 'n1' },
    { kind: 'put', path: 'b.txt', nodeId: 'n2' },
    { kind: 'put', path: 'c.txt', nodeId: 'n3' },
    { kind: 'delete', path: 'd.txt' },
    { kind: 'put', path: 'e.txt', nodeId: 'n4' },
  ]);
  assert.ok(!out.some((a) => a.kind === 'upload' || a.kind === 'update' || a.kind === 'trash'));
});

test('names become safe paths under .kimono/files', () => {
  assert.equal(segment('../etc'), 'etc');
  assert.equal(segment('a/b'), 'a b');
  assert.equal(segment('.hidden'), 'hidden');
  assert.equal(openedDir('Photos', ['2026', 'Trip/Kyoto']), '.kimono/files/Photos/2026/Trip Kyoto');
});

test('the note names the spaces and what is open', () => {
  assert.equal(accessNote(['Family', 'Photos'], [{ dir: '.kimono/files/Photos/2026', need: 'change' }]),
    'Drive spaces you can ask for: Family, Photos. Open to you now: /files/Photos/2026 (read and change).');
  assert.equal(accessNote([], []), 'This person has no Drive spaces.');
});

test('the schema has requests, grants and what each chat has open', () => {
  const db = new DatabaseSync(':memory:');
  model.migrate(db);
  for (const table of ['access_requests', 'grants', 'opened', 'opened_files']) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), table);
  }
});

test('notebooks are named apart from the spaces of files', () => {
  assert.equal(accessNote(['Photos'], [], ['Notes', 'Kyoto trip']),
    'Drive spaces you can ask for: Photos. Their notebooks in Kimono Notes, asked for the same way: Notes, Kyoto trip.');
});
