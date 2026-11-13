import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as friends from '../src/lib/friends/model.ts';
import * as watchFriends from '../src/lib/watch/friends.ts';
import * as booksSection from '../src/lib/friends/books-section.ts';

function fresh() {
  const db = new DatabaseSync(':memory:');
  friends.migrateSocial(db);
  return db;
}
let n = 0;
const id = () => `r${++n}`;
const film = { app: 'watch', itemId: 'movie-1', title: 'Kotori', subtitle: '2026', cover: 'https://img.example/k.jpg' };

test('friends: asking, a yes, an ask back, no and unfriending', () => {
  const db = fresh();
  assert.equal(friends.askFriend(db, 'Ana', 'sami', 1), 'asking');
  assert.equal(friends.linkOf(db, 'sami', 'ana'), 'asked');
  assert.equal(friends.areFriends(db, 'ana', 'sami'), false);
  assert.equal(friends.askFriend(db, 'ana', 'sami', 2), 'asking');
  assert.equal(friends.answerFriend(db, 'sami', 'ana', true, 3), 'friends');
  assert.deepEqual(friends.friendsOf(db, 'ana'), ['sami']);
  /* Asking someone who asked you is a yes. */
  friends.askFriend(db, 'lee', 'ana', 4);
  assert.equal(friends.askFriend(db, 'ana', 'lee', 5), 'friends');
  /* No forgets the ask; the asker can't answer their own. */
  friends.askFriend(db, 'kai', 'ana', 6);
  assert.equal(friends.answerFriend(db, 'kai', 'ana', true, 7), 'asking');
  assert.equal(friends.answerFriend(db, 'ana', 'kai', false, 8), null);
  assert.equal(friends.linkOf(db, 'kai', 'ana'), null);
  friends.removeFriend(db, 'sami', 'ana');
  assert.deepEqual(friends.friendsOf(db, 'ana'), ['lee']);
  assert.throws(() => friends.askFriend(db, 'ana', 'ANA', 9));
});

test('friends: Watch reads the same friend list', () => {
  assert.equal(watchFriends.askFriend, friends.askFriend);
  assert.equal(watchFriends.friendsOf, friends.friendsOf);
});

test('friends: Watch friendships come over once, none lost, none doubled', () => {
  const watch = new DatabaseSync(':memory:');
  watchFriends.migrateFriends(watch);
  watch.prepare("INSERT INTO friends VALUES ('ana', 'sami', 'ana', 'friends', 5), ('kai', 'ana', 'kai', 'asked', 6)").run();
  const rows = watch.prepare('SELECT * FROM friends').all();
  const db = fresh();
  /* One already made here stays as it is. */
  friends.askFriend(db, 'sami', 'ana', 1);
  assert.equal(friends.importFriends(db, rows, 'watch-friends'), 1);
  assert.equal(friends.linkOf(db, 'ana', 'sami'), 'asked');
  /* Kept in order (a < b), whichever way Watch had it. */
  assert.equal(friends.linkOf(db, 'ana', 'kai'), 'asked');
  assert.equal(friends.linkOf(db, 'kai', 'ana'), 'asking');
  assert.equal(friends.importFriends(db, rows, 'watch-friends'), 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM friends').get().n, 2);
});

test('profiles: a short bio, kept tidy', () => {
  const db = fresh();
  assert.equal(friends.bioOf(db, 'ana'), '');
  assert.equal(friends.setBio(db, 'Ana', '  Reads on trains.\r\n\r\n\r\nWatches anime.  ', 1), 'Reads on trains.\n\nWatches anime.');
  assert.equal(friends.bioOf(db, 'ana'), 'Reads on trains.\n\nWatches anime.');
  assert.throws(() => friends.setBio(db, 'ana', 'x'.repeat(friends.bioLimit + 1)), /under/);
  assert.throws(() => friends.setBio(db, 'ana', 42));
});

test('profiles: private until friends — a stranger sees a name and portrait, nothing more', () => {
  const db = fresh();
  friends.setBio(db, 'ana', 'Reads on trains.');
  friends.recommend(db, 'ana', [], film, id, 1);
  const ana = { username: 'ana', name: 'Ana', picture: null };
  const rows = [{ app: 'watch', appName: 'Watch', kind: 'watched', title: 'Watched', items: [film] }];
  let asked = 0;
  const sections = () => { asked++; return rows; };
  const stranger = friends.profileFor(db, 'sami', ana, sections);
  assert.deepEqual(Object.keys(stranger).sort(), ['link', 'name', 'open', 'picture', 'username', 'you']);
  assert.equal(stranger.open, false);
  assert.equal(asked, 0);
  /* Asked but not yet friends: still private. */
  friends.askFriend(db, 'sami', 'ana', 2);
  assert.equal(friends.profileFor(db, 'sami', ana, sections).open, false);
  assert.equal(friends.profileFor(db, 'sami', ana, sections).link, 'asking');
  friends.askFriend(db, 'ana', 'sami', 3);
  const friend = friends.profileFor(db, 'sami', ana, sections);
  assert.equal(friend.open, true);
  assert.equal(friend.bio, 'Reads on trains.');
  assert.equal(friend.sections.length, 1);
  assert.equal(friend.recommendations.length, 1);
  assert.equal('hidden' in friend, false);
  /* Unfriended: private again. */
  friends.removeFriend(db, 'ana', 'sami');
  assert.equal(friends.profileFor(db, 'sami', ana, sections).open, false);
});

test('profiles: an app kept off your profile is hidden from friends, still shown to you', () => {
  const db = fresh();
  friends.askFriend(db, 'ana', 'sami', 1);
  friends.askFriend(db, 'sami', 'ana', 2);
  const ana = { username: 'ana', name: 'Ana', picture: null };
  const rows = [
    { app: 'watch', appName: 'Watch', kind: 'watched', title: 'Watched', items: [film] },
    { app: 'books', appName: 'Books', kind: 'read', title: 'Read', items: [{ ...film, app: 'books' }] },
  ];
  assert.deepEqual(friends.setAppHidden(db, 'ana', 'watch', true), ['watch']);
  assert.deepEqual(friends.profileFor(db, 'sami', ana, () => rows).sections.map((s) => s.app), ['books']);
  const own = friends.profileFor(db, 'ana', ana, () => rows);
  assert.deepEqual(own.sections.map((s) => s.app), ['watch', 'books']);
  assert.deepEqual(own.hidden, ['watch']);
  /* The bio survives the setting, and the setting survives the bio. */
  friends.setBio(db, 'ana', 'Hi');
  assert.deepEqual(friends.hiddenAppsOf(db, 'ana'), ['watch']);
  assert.deepEqual(friends.setAppHidden(db, 'ana', 'watch', false), []);
  assert.throws(() => friends.setAppHidden(db, 'ana', 'music', true), /app/);
});

test('profiles: Books rows from the shelf — reading with how far, want to read, read', () => {
  const book = (key, state, updatedAt, fraction = 0) => ({ key, title: key, authors: ['Sōseki'], cover: null, year: 1914, isbn: null, state, fraction, updatedAt });
  const rows = booksSection.booksSectionsFrom([
    book('ol:1', 'read', '2026-01-01'), book('ol:2', 'reading', '2026-02-01', .4), book('ol:3', 'read', '2026-03-01'), book('ol:4', 'want', '2026-01-05'),
  ]);
  assert.deepEqual(rows.map((r) => r.kind), ['reading', 'want', 'read']);
  assert.equal(rows[0].items[0].href, '/books?b=ol%3A2');
  assert.equal(rows[1].items[0].progress, null);
  assert.equal(rows[0].items[0].progress, .4);
  assert.equal(rows[0].items[0].subtitle, 'Sōseki · 1914');
  assert.deepEqual(rows[2].items.map((i) => i.itemId), ['ol:3', 'ol:1']);
});

test('recommendations: to friends only, again brings it back, put away or taken back', () => {
  const db = fresh();
  friends.askFriend(db, 'ana', 'sami', 1);
  assert.throws(() => friends.recommend(db, 'ana', ['sami'], film, id, 2), /friends/);
  friends.askFriend(db, 'sami', 'ana', 3);
  const [sent] = friends.recommend(db, 'ana', ['Sami'], { ...film, note: 'The second half!' }, id, 4);
  assert.equal(sent.to, 'sami');
  assert.equal(sent.note, 'The second half!');
  assert.deepEqual(friends.receivedBy(db, 'sami').map((r) => r.id), [sent.id]);
  assert.equal(friends.unseenCount(db, 'sami'), 1);
  friends.markSeen(db, 'sami', 5);
  assert.equal(friends.unseenCount(db, 'sami'), 0);
  /* Again: the same one, back on top and new, with the new note. */
  const [again] = friends.recommend(db, 'ana', ['sami'], { ...film, note: '' }, id, 6);
  assert.equal(again.id, sent.id);
  assert.equal(again.note, null);
  assert.equal(friends.unseenCount(db, 'sami'), 1);
  assert.deepEqual(friends.recommendedTo(db, 'sami', 'watch', 'movie-1').map((r) => r.from), ['ana']);
  assert.deepEqual(friends.sentBy(db, 'ana').map((r) => r.id), [sent.id]);
  /* Someone else can't touch it; the one it's for puts it away; the sender takes it back. */
  assert.equal(friends.dropRecommendation(db, 'lee', sent.id), false);
  assert.equal(friends.dropRecommendation(db, 'sami', sent.id, 7), true);
  assert.equal(friends.receivedBy(db, 'sami').length, 0);
  assert.equal(friends.sentBy(db, 'ana').length, 1);
  assert.equal(friends.dropRecommendation(db, 'ana', sent.id), true);
  assert.equal(friends.sentBy(db, 'ana').length, 0);
  assert.throws(() => friends.recommend(db, 'ana', ['ana'], film, id), /someone else/);
  assert.throws(() => friends.recommend(db, 'ana', [], { ...film, note: 'x'.repeat(friends.noteLimit + 1) }, id), /note/);
  assert.throws(() => friends.recommend(db, 'ana', [], { ...film, title: '' }, id), /Pick/);
});

test('recommendations: on your profile with no one to send to; gone with the friendship', () => {
  const db = fresh();
  const [mine] = friends.recommend(db, 'ana', [], { app: 'books', itemId: 'ol:OL1W', title: 'Kokoro', cover: '/api/v1/books/cover/1' }, id, 1);
  assert.equal(mine.to, null);
  assert.equal(mine.cover, '/api/v1/books/cover/1');
  assert.deepEqual(friends.onProfile(db, 'ana').map((r) => r.itemId), ['ol:OL1W']);
  assert.equal(friends.sentBy(db, 'ana').length, 0);
  friends.askFriend(db, 'ana', 'sami', 2);
  friends.askFriend(db, 'sami', 'ana', 3);
  friends.recommend(db, 'sami', ['ana'], film, id, 4);
  friends.removeFriend(db, 'ana', 'sami');
  assert.equal(friends.receivedBy(db, 'ana').length, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM recommendations WHERE to_user IS NOT NULL').get().n, 0);
  assert.equal(friends.onProfile(db, 'ana').length, 1);
});
