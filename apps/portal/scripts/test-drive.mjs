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

test('emptying the trash now removes what the person can edit, and nothing else', () => {
  const db = fresh();
  const mine = drive.createSpace(db, 'akram', { name: 'Mine' });
  const theirs = drive.createSpace(db, 'mina', { name: 'Theirs', members: [{ username: 'akram', role: 'viewer' }] });
  const folder = drive.createFolder(db, mine.rootId, 'akram', 'Old');
  drive.addFile(db, folder.id, 'akram', file('a.png', 'b-a'));
  const kept = drive.addFile(db, mine.rootId, 'akram', file('kept.png', 'b-kept'));
  const viewed = drive.addFile(db, theirs.rootId, 'mina', file('v.png', 'b-v'));
  drive.trashNode(db, folder.id, 'akram');
  drive.trashNode(db, viewed.id, 'mina');
  assert.deepEqual(drive.emptyTrash(db, 'akram'), ['b-a']);
  assert.equal(drive.trashOf(db, 'akram').length, 1, 'a viewer leaves the owner\'s trash alone');
  assert.equal(drive.nodeFor(db, kept.id, 'akram').name, 'kept.png');
  assert.deepEqual(drive.emptyTrash(db, 'mina'), ['b-v']);
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
  assert.throws(() => drive.startUpload(fresh(), 'x', 'a', { name: 'a', size: 1, mime: null }, 1));
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'S', members: [{ username: 'ren', role: 'viewer' }, { username: 'mina', role: 'editor' }] });
  assert.throws(() => drive.startUpload(db, space.rootId, 'ren', { name: 'a.mp4', size: 5, mime: null }, 100), /only view/);
  assert.throws(() => drive.startUpload(db, space.rootId, 'akram', { name: 'big.mp4', size: 101, mime: null }, 100), (e) => e.status === 413);
  const upload = drive.startUpload(db, space.rootId, 'akram', { name: 'a.mp4', size: 5, mime: 'video/mp4' }, 100);
  assert.throws(() => drive.uploadFor(db, upload.id, 'mina'), (e) => e.status === 404);
  assert.equal(drive.promisedBytes(db), 5);
  drive.recordReceived(db, upload.id, 3);
  assert.equal(drive.uploadFor(db, upload.id, 'akram').received, 3);
  assert.equal(drive.promisedBytes(db), 2);
});

test('a slow upload survives as long as bytes keep arriving', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'S' });
  const hour = 3600000, day = 24 * hour, start = 1_000_000;
  const upload = drive.startUpload(db, space.rootId, 'akram', { name: 'film.mkv', size: 150 * 1024 ** 3, mime: null }, 150 * 1024 ** 3, start);
  for (let d = 1; d <= 6; d += 1) drive.recordReceived(db, upload.id, d * 1024, start + d * day - hour);
  assert.deepEqual(drive.staleUploads(db, start + 6 * day + 12 * hour), [], 'six days in, still receiving');
  assert.deepEqual(drive.staleUploads(db, start + 7 * day), [upload.id], 'a day of silence ends it');
});

test('an upload that never starts lets its room go within the hour', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'S' });
  const token = drive.setSpaceLink(db, space.id, 'akram', 'add');
  const minute = 60000, start = 1_000_000;
  const empty = drive.startGuestUpload(db, token, undefined, null, { name: 'nothing.bin', size: 10 * 1024 ** 3, mime: null }, 150 * 1024 ** 3, start);
  const started = drive.startGuestUpload(db, token, undefined, null, { name: 'some.bin', size: 10, mime: null }, 150 * 1024 ** 3, start);
  drive.recordReceived(db, started.id, 1, start + 10 * minute);
  assert.deepEqual(drive.staleUploads(db, start + 30 * minute), []);
  assert.deepEqual(drive.staleUploads(db, start + 61 * minute), [empty.id], 'nothing sent in an hour');
  assert.equal(drive.promisedBytes(db), 9);
});

test('what one person or one link may have on its way, and what guests may leave, is capped', () => {
  const db = fresh();
  const GB = 1024 ** 3, max = 150 * GB;
  const space = drive.createSpace(db, 'akram', { name: 'Drop' });
  const token = drive.setSpaceLink(db, space.id, 'akram', 'add');
  const guest = (size, name = 'f.bin') => drive.startGuestUpload(db, token, undefined, null, { name, size, mime: null }, max);
  assert.throws(() => guest(drive.reservedPerLink + 1), (e) => e.status === 413);
  guest(15 * GB);
  assert.throws(() => guest(6 * GB), (e) => e.status === 429, 'the link has 20 GB on its way at most');
  const small = guest(5 * GB);
  drive.finishUpload(db, drive.uploadFor(db, small.id, null), 'b-small');
  guest(5 * GB, 'room again.bin');

  /* Finished files count towards what the link may leave in the space. */
  const other = drive.createSpace(db, 'akram', { name: 'Full' });
  const full = drive.setSpaceLink(db, other.id, 'akram', 'add');
  for (let i = 0; i < 3; i += 1) {
    const upload = drive.startGuestUpload(db, full, undefined, null, { name: `big${i}.bin`, size: 16 * GB, mime: null }, max);
    drive.finishUpload(db, drive.uploadFor(db, upload.id, null), `b-big${i}`);
  }
  assert.throws(() => drive.startGuestUpload(db, full, undefined, null, { name: 'more.bin', size: 3 * GB, mime: null }, max), (e) => e.status === 507);

  drive.startUpload(db, space.rootId, 'akram', { name: 'a.mkv', size: 150 * GB, mime: null }, max);
  assert.throws(() => drive.startUpload(db, space.rootId, 'akram', { name: 'b.mkv', size: 60 * GB, mime: null }, max), (e) => e.status === 429);
  drive.startUpload(db, space.rootId, 'akram', { name: 'c.mkv', size: 50 * GB, mime: null }, max);
});

test('an upload finishes only while whoever started it may still add', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'S', members: [{ username: 'mina', role: 'editor' }] });
  const doc = drive.addFile(db, space.rootId, 'akram', file('plan.key', 'b-1'));
  const edit = drive.startReplace(db, doc.id, 'mina', 1, { size: 20, mime: null }, 100);
  const added = drive.startUpload(db, space.rootId, 'mina', { name: 'new.txt', size: 1, mime: null }, 100);
  drive.setMember(db, space.id, 'akram', 'mina', 'viewer');
  assert.throws(() => drive.finishUpload(db, drive.uploadFor(db, edit.id, 'mina'), 'b-2'), /only view/);
  assert.throws(() => drive.finishUpload(db, drive.uploadFor(db, added.id, 'mina'), 'b-3'), /only view/);
  assert.equal(drive.nodeFor(db, doc.id, 'akram').contentVersion, 1, 'the file was not overwritten');
  drive.setMember(db, space.id, 'akram', 'mina', null);
  assert.throws(() => drive.finishUpload(db, edit, 'b-2'), (e) => e.status === 404);

  /* A guest's upload, once its link stops letting people add. */
  const token = drive.setSpaceLink(db, space.id, 'akram', 'add');
  const upload = drive.uploadFor(db, drive.startGuestUpload(db, token, undefined, null, { name: 'g.png', size: 1, mime: null }, 100).id, null);
  drive.setSpaceLink(db, space.id, 'akram', 'view');
  assert.throws(() => drive.finishUpload(db, upload, 'b-g'), /viewing only/);
  assert.deepEqual(drive.childrenOf(db, space.rootId, 'akram').children.map((n) => n.name), ['plan.key']);
});

test('only editors and owners see links; viewers get none', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'S', members: [{ username: 'mina', role: 'editor' }, { username: 'ren', role: 'viewer' }] });
  const folder = drive.createFolder(db, space.rootId, 'akram', 'F');
  const photo = drive.addFile(db, folder.id, 'akram', file('photo.png'));
  const token = drive.linkFile(db, photo.id, 'akram');
  const spaceLink = drive.setSpaceLink(db, space.id, 'akram', 'add');
  const linkOf = (who) => drive.spacesOf(db, who)[0];
  assert.deepEqual([linkOf('akram').link, linkOf('akram').linkAccess], [spaceLink, 'add']);
  assert.equal(drive.spaceFor(db, space.id, 'mina').link, spaceLink);
  assert.deepEqual([linkOf('ren').link, linkOf('ren').linkAccess], [null, null]);
  assert.equal(drive.spaceFor(db, space.id, 'ren').link, null);
  assert.equal(drive.changesFor(db, 'ren', 0).spaces[0].link, null);

  assert.equal(drive.nodeFor(db, photo.id, 'mina').link, token);
  assert.equal(drive.nodeFor(db, photo.id, 'ren').link, null);
  assert.equal(drive.childrenOf(db, folder.id, 'ren').children[0].link, null);
  assert.equal(drive.childrenOf(db, folder.id, 'mina').children[0].link, token);
  assert.equal(drive.searchNodes(db, 'ren', 'photo')[0].link, null);
  assert.equal(drive.searchNodes(db, 'akram', 'photo')[0].link, token);
  assert.equal(drive.recentFiles(db, 'ren')[0].link, null);
  assert.equal(drive.changesFor(db, 'ren', 0).changed.find((n) => n.id === photo.id).link, null);
  assert.equal(drive.changesFor(db, 'mina', 0).changed.find((n) => n.id === photo.id).link, token);
  drive.trashNode(db, folder.id, 'akram');
  assert.equal(drive.trashOf(db, 'ren')[0].link, null);
  assert.equal(drive.trashOf(db, 'akram')[0].id, folder.id);
});

test('a space opened by its link: guests view, add only when allowed, and never see members', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'Wedding', members: [{ username: 'mina', role: 'editor' }] });
  const photos = drive.createFolder(db, space.rootId, 'akram', 'Photos');
  drive.addFile(db, photos.id, 'akram', file('vows.png', 'b-vows'));
  assert.throws(() => drive.setSpaceLink(db, space.id, 'mina', 'view'), /owners/);
  const token = drive.setSpaceLink(db, space.id, 'akram', 'view');
  assert.equal(drive.spaceFor(db, space.id, 'mina').link, token);
  const top = drive.sharedFolder(db, token);
  assert.equal(top.space.name, 'Wedding');
  assert.deepEqual(top.children.map((n) => n.name), ['Photos']);
  const inside = drive.sharedFolder(db, token, photos.id);
  assert.equal(inside.children[0].createdBy, undefined, 'no usernames for guests');
  assert.equal(drive.sharedFile(db, token, inside.children[0].id).blob, 'b-vows');
  assert.throws(() => drive.startGuestUpload(db, token, photos.id, 'Sam', { name: 'a.png', size: 3, mime: null }, 100), /viewing only/);

  assert.equal(drive.setSpaceLink(db, space.id, 'akram', 'add'), token, 'changing access keeps the link');
  const upload = drive.startGuestUpload(db, token, photos.id, '  Sam  ', { name: 'vows.png', size: 3, mime: 'image/png' }, 100);
  assert.equal(drive.uploadFor(db, upload.id, null).guest, 'Sam');
  assert.throws(() => drive.uploadFor(db, 'nope', null), (e) => e.status === 404);
  const mine = drive.startUpload(db, space.rootId, 'akram', { name: 'm.png', size: 3, mime: null }, 100);
  assert.throws(() => drive.uploadFor(db, mine.id, null), (e) => e.status === 404, "a member's upload needs its member");
  const { node } = drive.finishUpload(db, drive.uploadFor(db, upload.id, null), 'b-guest');
  assert.equal(node.name, 'vows (2).png');
  assert.equal(node.guest, 'Sam');
  assert.equal(node.createdBy, '');
  assert.throws(() => drive.uploadFor(db, upload.id, null), (e) => e.status === 404, 'finished uploads are gone');

  /* Things elsewhere, or in the trash, are out of reach. */
  const other = drive.createSpace(db, 'akram', { name: 'Private' });
  assert.throws(() => drive.sharedFolder(db, token, other.rootId), (e) => e.status === 404);
  assert.throws(() => drive.startGuestUpload(db, token, other.rootId, null, { name: 'x', size: 1, mime: null }, 100), (e) => e.status === 404);
  drive.trashNode(db, photos.id, 'akram');
  assert.throws(() => drive.sharedFolder(db, token, photos.id), (e) => e.status === 404);

  /* Turning the link off ends it, and its unfinished uploads, for good. */
  const pending = drive.startGuestUpload(db, token, undefined, null, { name: 'late.png', size: 3, mime: null }, 100);
  drive.setSpaceLink(db, space.id, 'akram', null);
  assert.throws(() => drive.sharedFolder(db, token), /doesn't work/);
  assert.throws(() => drive.uploadFor(db, pending.id, null), (e) => e.status === 404);
  assert.ok(drive.staleUploads(db).includes(pending.id), 'and its bytes are swept');
  assert.ok(!drive.staleUploads(db).includes(mine.id));
  assert.notEqual(drive.setSpaceLink(db, space.id, 'akram', 'view'), token, 'a new link, not the old one');
  assert.equal(drive.linkedSpace(db, 'short'), null);
});

test('guests can only have a few uploads going through one link at once', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'Drop' });
  const token = drive.setSpaceLink(db, space.id, 'akram', 'add');
  for (let i = 0; i < drive.guestUploadsAtOnce; i += 1) drive.startGuestUpload(db, token, undefined, null, { name: `f${i}`, size: 1, mime: null }, 100);
  assert.throws(() => drive.startGuestUpload(db, token, undefined, null, { name: 'one more', size: 1, mime: null }, 100), (e) => e.status === 429);
  assert.throws(() => drive.startGuestUpload(db, token, undefined, 'x'.repeat(61), { name: 'n', size: 1, mime: null }, 100));
});

test('the change feed tells each device what to add, update and remove', () => {
  const db = fresh();
  const start = drive.changesFor(db, 'mina', 0);
  assert.deepEqual([start.changed, start.removed], [[], []]);
  const space = drive.createSpace(db, 'akram', { name: 'Family', members: [{ username: 'mina', role: 'viewer' }] });
  const docs = drive.createFolder(db, space.rootId, 'akram', 'Docs');
  const a = drive.addFile(db, docs.id, 'akram', file('a.pdf'));
  let feed = drive.changesFor(db, 'mina', start.cursor);
  assert.deepEqual(feed.changed.map((n) => n.name).sort(), ['Docs', 'Family', 'a.pdf']);
  assert.equal(feed.spaces[0].role, 'viewer');
  assert.equal(drive.changesFor(db, 'stranger', 0).changed.length, 0, 'strangers hear nothing');

  const before = drive.nodeFor(db, a.id, 'akram').version;
  drive.renameNode(db, a.id, 'akram', 'b.pdf');
  drive.renameNode(db, a.id, 'akram', 'c.pdf');
  let next = drive.changesFor(db, 'mina', feed.cursor);
  assert.deepEqual(next.changed.map((n) => [n.name, n.version]), [['c.pdf', before + 2]], 'one entry per node, as it is now');

  drive.trashNode(db, docs.id, 'akram');
  next = drive.changesFor(db, 'mina', next.cursor);
  assert.deepEqual(next.removed, [docs.id], 'trashing a folder removes it; its children go with it');
  drive.restoreNode(db, docs.id, 'akram');
  assert.deepEqual(drive.changesFor(db, 'mina', next.cursor).changed.map((n) => n.id), [docs.id]);

  /* Leaving, and being brought back, as one space. */
  const cursor = drive.changesFor(db, 'mina', 0).cursor;
  drive.setMember(db, space.id, 'akram', 'mina', null);
  drive.createFolder(db, space.rootId, 'akram', 'Secret');
  next = drive.changesFor(db, 'mina', cursor);
  assert.deepEqual([next.changed, next.removed], [[], [space.rootId]], 'a space left is removed, and nothing after leaks');
  drive.setMember(db, space.id, 'akram', 'mina', 'editor');
  next = drive.changesFor(db, 'mina', next.cursor);
  assert.deepEqual(next.changed.map((n) => n.id), [space.rootId]);
  assert.equal(next.spaces[0].role, 'editor');
});

test('something shared from a space you are not in stands on its own on your devices, with what you may do', () => {
  const db = fresh();
  const family = drive.createSpace(db, 'akram', { name: 'Family', members: [{ username: 'mina', role: 'editor' }] });
  const docs = drive.createFolder(db, family.rootId, 'akram', 'Docs');
  const trip = drive.createFolder(db, docs.id, 'akram', 'Trip');
  const plan = drive.addFile(db, trip.id, 'akram', file('plan.pdf'));
  const cursor = drive.changesFor(db, 'ren', 0).cursor;
  drive.shareNode(db, trip.id, 'mina', 'ren', 'viewer');
  const feed = drive.changesFor(db, 'ren', cursor);
  assert.deepEqual(feed.changed.map((n) => [n.id, n.parentId, n.sharedWithYou, n.role]), [[trip.id, null, true, 'viewer']]);
  assert.deepEqual(drive.sharedWithYou(db, 'ren').map((n) => [n.id, n.role, n.sharedBy]), [[trip.id, 'viewer', 'mina']]);
  /* Opened on its own, it still has no parent they can't see; what's inside says what they may do. */
  const opened = drive.childrenOf(db, trip.id, 'ren');
  assert.deepEqual([opened.folder.parentId, opened.folder.sharedWithYou, opened.children.map((n) => [n.id, n.parentId, n.role])], [null, true, [[plan.id, trip.id, 'viewer']]]);
  assert.equal(drive.asSeenBy(db, drive.nodeFor(db, plan.id, 'ren'), 'ren').parentId, trip.id);
  assert.equal(drive.childrenOf(db, family.rootId, 'mina').children[0].role, 'editor', 'members hear their role too');
  /* Made an editor, then taken off: their devices hear both. */
  drive.shareNode(db, trip.id, 'akram', 'ren', 'editor');
  let next = drive.changesFor(db, 'ren', feed.cursor);
  assert.deepEqual(next.changed.map((n) => [n.id, n.role]), [[trip.id, 'editor']]);
  assert.throws(() => drive.shareNode(db, plan.id, 'ren', 'mina', 'viewer'), /^Error: mina already has it\.$/, "the space isn't named to them");
  drive.renameNode(db, plan.id, 'ren', 'plan v2.pdf');
  next = drive.changesFor(db, 'ren', next.cursor);
  assert.deepEqual(next.changed.map((n) => [n.name, n.parentId, n.role]), [['plan v2.pdf', trip.id, 'editor']]);
  drive.shareNode(db, trip.id, 'akram', 'ren', null);
  next = drive.changesFor(db, 'ren', next.cursor);
  assert.deepEqual([next.changed, next.removed], [[], [trip.id]]);
  assert.deepEqual(drive.sharedWithYou(db, 'ren'), []);
});

test('a folder made into a space leaves old members and arrives for new ones', () => {
  const db = fresh();
  const family = drive.createSpace(db, 'akram', { name: 'Family', members: [{ username: 'mina', role: 'editor' }] });
  const trip = drive.createFolder(db, family.rootId, 'akram', 'Trip');
  const mina = drive.changesFor(db, 'mina', 0).cursor, jun = drive.changesFor(db, 'jun', 0).cursor, akram = drive.changesFor(db, 'akram', 0).cursor;
  drive.folderToSpace(db, trip.id, 'akram', { members: [{ username: 'jun', role: 'viewer' }] });
  assert.deepEqual(drive.changesFor(db, 'mina', mina).removed, [trip.id]);
  assert.deepEqual(drive.changesFor(db, 'jun', jun).changed.map((n) => [n.id, n.parentId]), [[trip.id, null]]);
  assert.deepEqual(drive.changesFor(db, 'akram', akram).changed.map((n) => [n.id, n.parentId]), [[trip.id, null]], 'moved to the top for its owner');
});

test('the feed pages, and a cursor older than the log asks for a fresh listing', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'S' }, 1000);
  for (let i = 0; i < 7; i += 1) drive.createFolder(db, space.rootId, 'akram', `f${i}`, 1000);
  const first = drive.changesFor(db, 'akram', 0, 5);
  assert.equal(first.changed.length, 5);
  assert.ok(first.more);
  const second = drive.changesFor(db, 'akram', first.cursor, 5);
  assert.equal(second.changed.length, 3);
  assert.ok(!second.more);
  drive.forgetOldChanges(db, 1000 + 91 * 86400000);
  assert.throws(() => drive.changesFor(db, 'akram', first.cursor), (e) => e.status === 410);
  assert.throws(() => drive.changesFor(db, 'akram', 99999), (e) => e.status === 410);
  assert.equal(drive.changesFor(db, 'akram', second.cursor).changed.length, 0, 'a cursor at the end still works');
});

test('an edit saved in place replaces the bytes, and a clashing edit is kept as a copy', () => {
  const db = fresh();
  const space = drive.createSpace(db, 'akram', { name: 'S', members: [{ username: 'mina', role: 'editor' }] });
  const doc = drive.addFile(db, space.rootId, 'akram', file('plan.key', 'b-1'));
  assert.equal(doc.contentVersion, 1);
  const mine = drive.startReplace(db, doc.id, 'akram', 1, { size: 20, mime: null }, 100);
  const hers = drive.startReplace(db, doc.id, 'mina', 1, { size: 30, mime: null }, 100);
  const first = drive.finishUpload(db, drive.uploadFor(db, mine.id, 'akram'), 'b-2');
  assert.deepEqual([first.conflict, first.oldBlob, first.node.id, first.node.contentVersion, first.node.size], [false, 'b-1', doc.id, 2, 20]);
  const second = drive.finishUpload(db, drive.uploadFor(db, hers.id, 'mina'), 'b-3');
  assert.equal(second.conflict, true);
  assert.equal(second.oldBlob, null);
  assert.equal(second.node.name, 'plan (edited elsewhere).key');
  assert.deepEqual(drive.childrenOf(db, space.rootId, 'akram').children.map((n) => n.name), ['plan (edited elsewhere).key', 'plan.key']);
  const ren = drive.createSpace(db, 'akram', { name: 'T', members: [{ username: 'ren', role: 'viewer' }] });
  const theirs = drive.addFile(db, ren.rootId, 'akram', file('x.txt'));
  assert.throws(() => drive.startReplace(db, theirs.id, 'ren', 1, { size: 1, mime: null }, 100), /only view/);
});

test('search and recent files cover only live things in your own spaces', () => {
  const db = fresh();
  const mine = drive.createSpace(db, 'akram', { name: 'Trips', members: [{ username: 'ren', role: 'viewer' }] });
  const other = drive.createSpace(db, 'mina', { name: 'Mina' });
  const kyoto = drive.createFolder(db, mine.rootId, 'akram', 'Kyoto', 10);
  drive.addFile(db, kyoto.id, 'akram', file('Temple.png'), 20);
  drive.addFile(db, mine.rootId, 'akram', file('kyoto-map.pdf'), 30);
  drive.addFile(db, other.rootId, 'mina', file('Kyoto secret.png'), 40);
  const old = drive.createFolder(db, mine.rootId, 'akram', 'Old', 50);
  drive.addFile(db, old.id, 'akram', file('kyoto-2019.png'), 60);
  drive.trashNode(db, old.id, 'akram', 70);
  assert.deepEqual(drive.searchNodes(db, 'akram', 'KYOTO').map((n) => n.name), ['Kyoto', 'kyoto-map.pdf']);
  assert.deepEqual(drive.searchNodes(db, 'ren', 'temple').map((n) => n.name), ['Temple.png'], 'viewers find things too');
  assert.deepEqual(drive.searchNodes(db, 'stranger', 'kyoto'), []);
  assert.deepEqual(drive.searchNodes(db, 'akram', '%'), [], 'wildcards are taken literally');
  assert.deepEqual(drive.searchNodes(db, 'akram', '  '), []);
  assert.deepEqual(drive.recentFiles(db, 'akram').map((n) => n.name), ['kyoto-map.pdf', 'Temple.png']);
});

test('a crest has a colour its owner picks, plum until then', () => {
  const db = fresh();
  const plain = drive.createSpace(db, 'akram', { name: 'Plain', members: [{ username: 'mina', role: 'editor' }] });
  assert.equal(plain.color, 'plum');
  const dyed = drive.createSpace(db, 'akram', { name: 'Dyed', crest: 'kiku', color: 'ai' });
  assert.deepEqual([dyed.crest, dyed.color], ['kiku', 'ai']);
  drive.renameSpace(db, plain.id, 'akram', { color: 'koke' });
  assert.equal(drive.spaceFor(db, plain.id, 'akram').color, 'koke');
  assert.throws(() => drive.renameSpace(db, plain.id, 'akram', { color: '#ff0000' }), /colours/);
  assert.throws(() => drive.renameSpace(db, plain.id, 'mina', { color: 'ai' }), /owner/i);
});
