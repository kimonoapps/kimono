import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as drive from '../src/lib/drive/model.ts';

function fresh() {
  const db = new DatabaseSync(':memory:');
  drive.migrate(db);
  return db;
}
const file = (name, blob = drive.newId()) => ({ name, size: 10, mime: 'image/png', blob });

test('a new space has its creator as owner, plus the people they add', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'Akram', { name: 'Game nights', crest: 'kikyo', members: [{ username: 'mina', role: 'editor' }, { username: 'ren', role: 'viewer' }] });
  assert.equal(space.role, 'owner');
  assert.equal(space.crest, 'kikyo');
  assert.deepEqual(drive.spaceFor(db, space.id, 'akram').memberList.map((m) => [m.username, m.role]), [['akram', 'owner'], ['mina', 'editor'], ['ren', 'viewer']]);
  assert.equal(drive.spacesOf(db, 'mina').length, 1);
  assert.equal(drive.spacesOf(db, 'stranger').length, 0);
});

test('viewers read, editors change, strangers see nothing', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'Family', members: [{ username: 'mina', role: 'editor' }, { username: 'ren', role: 'viewer' }] });
  const clips = drive.createFolder(db, space.rootId, 'mina', 'Clips');
  assert.throws(() => drive.createFolder(db, space.rootId, 'ren', 'Nope'), /only view/);
  assert.throws(() => drive.childrenOf(db, space.rootId, 'stranger'), (e) => e.status === 404);
  assert.deepEqual(drive.childrenOf(db, space.rootId, 'ren').children.map((n) => n.name), ['Clips']);
  assert.throws(() => drive.setMember(db, space.id, 'mina', 'ren', 'editor'), /owners/);
  drive.renameNode(db, clips.id, 'mina', 'Videos');
  assert.equal(drive.childrenOf(db, space.rootId, 'akram').children[0].name, 'Videos');
});

test('names are checked, unique per folder ignoring case, and numbered on upload clashes', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'Personal' });
  for (const bad of ['', '  ', '.', '..', 'a/b', 'a\\b', 'tab\there', 'x'.repeat(256)]) assert.throws(() => drive.createFolder(db, space.rootId, 'akram', bad));
  drive.createFolder(db, space.rootId, 'akram', 'Maps');
  assert.throws(() => drive.createFolder(db, space.rootId, 'akram', 'maps'), (e) => e.status === 409);
  assert.equal(drive.addFile(db, space.rootId, 'akram', file('clip.mp4')).name, 'clip.mp4');
  assert.equal(drive.addFile(db, space.rootId, 'akram', file('Clip.mp4')).name, 'Clip (2).mp4');
  assert.equal(drive.addFile(db, space.rootId, 'akram', file('clip.mp4')).name, 'clip (3).mp4');
  assert.equal(drive.numbered('notes', 2), 'notes (2)');
  assert.equal(drive.numbered('.env', 2), '.env (2)');
});

test('moving stays within a space and never puts a folder inside itself', () => {
  const db = fresh();
  const a = drive.createSpace(db, 'akram', { name: 'A' });
  const b = drive.createSpace(db, 'akram', { name: 'B' });
  const outer = drive.createFolder(db, a.rootId, 'akram', 'Outer');
  const inner = drive.createFolder(db, outer.id, 'akram', 'Inner');
  assert.throws(() => drive.moveNode(db, outer.id, 'akram', inner.id), /inside itself/);
  assert.throws(() => drive.moveNode(db, outer.id, 'akram', b.rootId), /within a space/);
  assert.throws(() => drive.moveNode(db, a.rootId, 'akram', inner.id), /top folder/);
  const moved = drive.moveNode(db, inner.id, 'akram', a.rootId);
  assert.equal(moved.parentId, a.rootId);
});

test('trash hides things and their links; restoring brings both back', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'Game nights' });
  const folder = drive.createFolder(db, space.rootId, 'akram', 'Clips');
  const clip = drive.addFile(db, folder.id, 'akram', file('ace.mp4', 'blob1'));
  const token = drive.linkFile(db, clip.id, 'akram');
  assert.equal(drive.linkFile(db, clip.id, 'akram'), token, 'one link per file');
  assert.equal(drive.publicFile(db, token).blob, 'blob1');
  drive.trashNode(db, folder.id, 'akram');
  assert.equal(drive.publicFile(db, token), null, 'a link into the trash stops working');
  assert.throws(() => drive.nodeFor(db, clip.id, 'akram'), /trash/);
  assert.equal(drive.trashOf(db, 'akram').length, 1);
  drive.restoreNode(db, folder.id, 'akram');
  assert.equal(drive.publicFile(db, token).blob, 'blob1');
  drive.unlinkFile(db, clip.id, 'akram');
  assert.equal(drive.publicFile(db, token), null);
});

test('old trash is emptied with everything inside it, and its blobs handed back', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'S' });
  const folder = drive.createFolder(db, space.rootId, 'akram', 'Old');
  drive.addFile(db, folder.id, 'akram', file('a.png', 'b-a'));
  drive.addFile(db, folder.id, 'akram', file('b.png', 'b-b'));
  drive.trashNode(db, folder.id, 'akram', 1000);
  assert.deepEqual(drive.emptyOldTrash(db, 1000 + 29 * 86400000), []);
  assert.deepEqual(drive.emptyOldTrash(db, 1000 + 31 * 86400000).sort(), ['b-a', 'b-b']);
  assert.equal(drive.trashOf(db, 'akram').length, 0);
});

test('a space always keeps an owner; anyone may leave', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'S', members: [{ username: 'mina', role: 'viewer' }] });
  assert.throws(() => drive.setMember(db, space.id, 'akram', 'akram', 'editor'), (e) => e.status === 409);
  assert.throws(() => drive.setMember(db, space.id, 'akram', 'akram', null), (e) => e.status === 409);
  drive.setMember(db, space.id, 'mina', 'mina', null);
  assert.equal(drive.roleIn(db, space.id, 'mina'), null);
  drive.setMember(db, space.id, 'akram', 'mina', 'owner');
  drive.setMember(db, space.id, 'akram', 'akram', null);
  assert.equal(drive.roleIn(db, space.id, 'akram'), null);
});

test('a folder becomes a space with its contents and links, and leaves the old space', () => {
  const db = fresh();
  const family = drive.createSpace(db, 'akram', { name: 'Family', members: [{ username: 'mina', role: 'editor' }] });
  const trip = drive.createFolder(db, family.rootId, 'akram', 'Kyoto 2026');
  const photo = drive.addFile(db, trip.id, 'akram', file('temple.png', 'b-temple'));
  const token = drive.linkFile(db, photo.id, 'akram');
  assert.throws(() => drive.folderToSpace(db, trip.id, 'mina', {}), /owners/);
  const kyoto = drive.folderToSpace(db, trip.id, 'akram', { crest: 'kiku', members: [{ username: 'jun', role: 'viewer' }] });
  assert.equal(kyoto.name, 'Kyoto 2026');
  assert.equal(kyoto.rootId, trip.id);
  assert.deepEqual(drive.childrenOf(db, family.rootId, 'akram').children, []);
  assert.deepEqual(drive.childrenOf(db, kyoto.rootId, 'jun').children.map((n) => n.name), ['temple.png']);
  assert.throws(() => drive.childrenOf(db, kyoto.rootId, 'mina'), (e) => e.status === 404, 'old members do not come along');
  assert.equal(drive.publicFile(db, token).blob, 'b-temple');
});

test('uploads belong to the person who started them and respect the size limit', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'S', members: [{ username: 'ren', role: 'viewer' }, { username: 'mina', role: 'editor' }] });
  assert.throws(() => drive.startUpload(db, space.rootId, 'ren', { name: 'a.mp4', size: 5, mime: null }, 100), /only view/);
  assert.throws(() => drive.startUpload(db, space.rootId, 'akram', { name: 'big.mp4', size: 101, mime: null }, 100), (e) => e.status === 413);
  const upload = drive.startUpload(db, space.rootId, 'akram', { name: 'a.mp4', size: 5, mime: 'video/mp4' }, 100);
  assert.throws(() => drive.uploadFor(db, upload.id, 'mina'), (e) => e.status === 404);
  drive.recordReceived(db, upload.id, 3);
  assert.equal(drive.uploadFor(db, upload.id, 'akram').received, 3);
  assert.deepEqual(drive.staleUploads(db, Date.now() + 2 * 86400000), [upload.id]);
});
