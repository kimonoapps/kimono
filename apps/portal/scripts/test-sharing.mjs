import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as model from '../src/lib/code/model.ts';
import * as sharing from '../src/lib/code/sharing.ts';
import { saveArtifact } from '../src/lib/code/artifacts.ts';

function fresh() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  model.migrate(db);
  return db;
}
const chat = (db, owner = 'akram') => model.createWorkspace(db, owner, { prompt: 'Plan the Kyoto trip' });

test('a chat is the owner\'s alone until it is shared', () => {
  const db = fresh();
  const w = chat(db);
  assert.equal(sharing.accessOf(db, w.id, 'akram'), 'owner');
  assert.equal(sharing.accessOf(db, w.id, 'mina'), null);
  assert.throws(() => sharing.workspaceAs(db, w.id, 'mina', 'read'), (e) => e.status === 404);
  assert.equal(sharing.sharedWithMe(db, 'mina').length, 0);
});

test('someone invited to read can read, not write; a writer can write, not manage', () => {
  const db = fresh();
  const w = chat(db);
  sharing.shareChat(db, w, 'Mina', 'read');
  assert.equal(sharing.workspaceAs(db, w.id, 'mina', 'read').access, 'read');
  assert.throws(() => sharing.workspaceAs(db, w.id, 'mina', 'edit'), (e) => e.status === 403);
  sharing.shareChat(db, w, 'mina', 'edit');
  assert.equal(sharing.workspaceAs(db, w.id, 'mina', 'edit').access, 'edit');
  assert.throws(() => sharing.workspaceAs(db, w.id, 'mina', 'owner'), (e) => e.status === 403);
  assert.deepEqual(sharing.sharedWithMe(db, 'mina').map((s) => [s.id, s.access]), [[w.id, 'edit']]);
  /* The owner's own list is unchanged, and Mina's own list has no copy of it. */
  assert.equal(model.workspacesOf(db, 'mina').length, 0);
  sharing.shareChat(db, w, 'mina', null);
  assert.equal(sharing.accessOf(db, w.id, 'mina'), null);
  assert.throws(() => sharing.shareChat(db, w, 'akram', 'read'));
});

test('a chat link lets anyone read, and only signed-in people write', () => {
  const db = fresh();
  const w = chat(db);
  const { link } = sharing.setChatLink(db, w, 'edit');
  assert.equal(sharing.accessOf(db, w.id, null, link.token), 'read');
  assert.equal(sharing.accessOf(db, w.id, 'mina', link.token), 'edit');
  assert.equal(sharing.accessOf(db, w.id, null, 'wrong'), null);
  /* Joining keeps it in Mina's list; a read link never lowers what she was given. */
  sharing.joinByLink(db, link.token, 'mina');
  assert.equal(sharing.accessOf(db, w.id, 'mina'), 'edit');
  sharing.setChatLink(db, w, 'read');
  sharing.joinByLink(db, sharing.chatSharing(db, w.id).link.token, 'mina');
  assert.equal(sharing.accessOf(db, w.id, 'mina'), 'edit');
  /* Off and on again: the old link stops working. */
  const before = sharing.chatSharing(db, w.id).link.token;
  sharing.setChatLink(db, w, null);
  assert.equal(sharing.accessOf(db, w.id, null, before), null);
  assert.notEqual(sharing.setChatLink(db, w, 'read').link.token, before);
});

test('a read link that starts letting people write is a new link', () => {
  const db = fresh();
  const w = chat(db);
  const read = sharing.setChatLink(db, w, 'read').link.token;
  const edit = sharing.setChatLink(db, w, 'edit').link.token;
  assert.notEqual(edit, read);
  assert.equal(sharing.accessOf(db, w.id, 'mina', read), null);
  /* Back to read only: the same link, with less. */
  assert.equal(sharing.setChatLink(db, w, 'read').link.token, edit);
});

test('each turn knows whether the owner sent it', () => {
  const db = fresh();
  const w = chat(db);
  const first = model.startTurn(db, w.id, 1);
  model.setTurnByOwner(db, first, true);
  model.endTurn(db, first, 'done', 2);
  const second = model.startTurn(db, w.id, 3);
  model.setTurnByOwner(db, second, false);
  assert.equal(model.turnByOwner(db, second), false);
  assert.deepEqual(model.turnsByOwner(db, w.id, 2), [false, true]);
  /* A turn from before this was kept counts as the owner's, but isn't known for steering. */
  model.endTurn(db, second, 'done', 4);
  const third = model.startTurn(db, w.id, 5);
  assert.equal(model.turnByOwner(db, third), null);
  assert.deepEqual(model.turnsByOwner(db, w.id, 2), [true, false]);
});

test('an artifact opens for its people, then for anyone once public', () => {
  const db = fresh();
  const w = chat(db);
  saveArtifact(db, w.id, 'quiz', '<title>Heart quiz</title><p>hi</p>');
  const { token } = sharing.shareArtifact(db, w, 'quiz', 'mina', true);
  assert.ok(token);
  assert.equal(sharing.artifactByLink(db, token, 'mina').title, 'Heart quiz');
  assert.equal(sharing.artifactByLink(db, token, 'akram').name, 'quiz');
  assert.throws(() => sharing.artifactByLink(db, token, 'sora'), (e) => e.status === 404);
  assert.throws(() => sharing.artifactByLink(db, token, null), (e) => e.status === 401);
  assert.deepEqual(sharing.artifactsSharedWith(db, 'mina').map((a) => a.title), ['Heart quiz']);
  sharing.setArtifactPublic(db, w, 'quiz', true);
  assert.equal(sharing.artifactByLink(db, token, null).name, 'quiz');
  /* Deleting the chat takes its shares and links with it. */
  model.removeWorkspace(db, w.id, 'akram');
  assert.throws(() => sharing.artifactByLink(db, token, null), (e) => e.status === 404);
  assert.equal(sharing.sharedWithMe(db, 'mina').length, 0);
});
