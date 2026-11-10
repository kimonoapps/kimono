/*
 * Asking for a person's Drive, end to end on Portal's side: a real Drive
 * (in a temporary folder) and a stand-in node that keeps a sandbox's files in
 * memory. Run with: node --conditions=react-server --test scripts/test-access-flow.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const state = mkdtempSync(join(tmpdir(), 'kimono-access-'));
process.env.KIMONO_STATE_DIR = state;

const drive = await import('../src/lib/drive/index.ts');
const model = await import('../src/lib/code/model.ts');
const access = await import('../src/lib/code/access.ts');

/* The node: a sandbox's files, by path under /workspace. */
const sandboxFiles = new Map();
/* What each PUT said its length was, and how much room the stand-in sandbox has (Infinity: plenty). */
const putLengths = new Map();
let sandboxRoom = Infinity;
const sha1 = (b) => createHash('sha1').update(b).digest('hex');
const node = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://node');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const path = url.searchParams.get('path');
    if (url.pathname.endsWith('/tree') && url.searchParams.get('dir') === 'granted') {
      const files = [...sandboxFiles].filter(([p]) => p.startsWith('.kimono/files/')).map(([p, b]) => ({ path: p.slice('.kimono/files/'.length), size: b.length, sha1: sha1(b) }));
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ files, truncated: false }));
    }
    if (url.pathname.endsWith('/file')) {
      if (req.method === 'PUT' && Number(req.headers['content-length']) > sandboxRoom) {
        res.writeHead(507, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'no room', room: sandboxRoom }));
      }
      if (req.method === 'PUT') { putLengths.set(path, req.headers['content-length']); sandboxFiles.set(path, Buffer.concat(chunks)); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{}'); }
      if (req.method === 'DELETE') { sandboxFiles.delete(path); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{}'); }
      if (sandboxFiles.has(path)) { res.writeHead(200); return res.end(sandboxFiles.get(path)); }
      res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"no"}');
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => node.listen(0, '127.0.0.1', r));
/* Closed however the tests went, so a failure can't leave the run hanging. */
test.after(() => node.close());
const config = { nodeAddress: `http://127.0.0.1:${node.address().port}`, nodeKey: 'k' };

/* Drive: Mina's Photos with 2026/a.txt and 2026/b.txt, and Family, where she can only view. */
const ddb = drive.db();
async function put(parentId, owner, name, text) {
  const blob = drive.newId();
  const path = drive.blobPath(drive.root, blob);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return drive.addFile(ddb, parentId, owner, { name, size: Buffer.byteLength(text), mime: 'text/plain', blob });
}
const photos = drive.createSpace(ddb, 'mina', { name: 'Photos' });
const y2026 = drive.createFolder(ddb, photos.rootId, 'mina', '2026');
const a = await put(y2026.id, 'mina', 'a.txt', 'alpha');
await put(y2026.id, 'mina', 'b.txt', 'bravo');
const family = drive.createSpace(ddb, 'sam', { name: 'Family', members: [{ username: 'mina', role: 'viewer' }] });
await put(family.rootId, 'sam', 'plan.txt', 'trip');
drive.createSpace(ddb, 'sam', { name: 'Secret' });

const db = new DatabaseSync(':memory:');
model.migrate(db);
const ws = model.createWorkspace(db, 'mina', { repoOwner: 'mina', repoName: 'notes', base: 'main', prompt: 'Sort my notes' });

const text = (p) => sandboxFiles.get(p)?.toString();
const driveText = async (id) => (await import('node:fs')).readFileSync(drive.blobPath(drive.root, drive.nodeFor(ddb, id, 'mina').blob), 'utf8');

test('the agent learns the spaces it can ask for, and nothing is open yet', () => {
  const note = access.accessPrompt(db, ws);
  assert.match(note, /^Drive spaces you can ask for: (AI, )?Family, Photos\./);
  assert.match(note, /keeps its files in the "AI" space/, "it's told where the person's chats keep their files");
  assert.doesNotMatch(note, /Open to you now/);
});

test("asking for a space that isn't theirs, or isn't there, opens nothing", async () => {
  const asked = await access.onRequest(db, config, ws, null, { id: '1-00000001', space: 'Secret', path: '', need: 'read', why: 'x' });
  assert.equal(asked.event.state, 'missing');
  assert.equal(sandboxFiles.size, 0);
});

let request;
test('a request waits for the person, and nothing is copied until they answer', async () => {
  const asked = await access.onRequest(db, config, ws, null, { id: '1-00000002', space: 'photos', path: '2026', need: 'change', why: 'To sort them.' });
  assert.equal(asked.event.state, 'pending');
  assert.equal(asked.carryOn, null);
  assert.equal(sandboxFiles.size, 0);
  request = asked.event.id;
});

test('only its owner answers', async () => {
  await assert.rejects(access.answer(db, config, ws, 'sam', request, 'chat'), (e) => e.status === 403);
});

test('allowing for this chat copies the folder in, under /files', async () => {
  const answered = await access.answer(db, config, ws, 'mina', request, 'chat');
  assert.equal(answered.event.state, 'allowed');
  assert.match(answered.carryOn, /\/files\/Photos\/2026/);
  assert.equal(text('.kimono/files/Photos/2026/a.txt'), 'alpha');
  assert.equal(text('.kimono/files/Photos/2026/b.txt'), 'bravo');
  await assert.rejects(access.answer(db, config, ws, 'mina', request, 'chat'), (e) => e.status === 409);
  assert.match(access.accessPrompt(db, ws), /Open to you now: \/files\/Photos\/2026 \(read and change\)/);
});

test('with change, what the agent edits, adds and deletes goes back to Drive', async () => {
  sandboxFiles.set('.kimono/files/Photos/2026/a.txt', Buffer.from('alpha, sorted'));
  sandboxFiles.set('.kimono/files/Photos/2026/c.txt', Buffer.from('charlie'));
  sandboxFiles.delete('.kimono/files/Photos/2026/b.txt');
  await access.syncOpened(db, config, ws);
  assert.equal(await driveText(a.id), 'alpha, sorted');
  const names = drive.childrenOf(ddb, y2026.id, 'mina').children.map((c) => c.name);
  assert.deepEqual(names.sort(), ['a.txt', 'c.txt']);
  assert.ok(drive.trashOf(ddb, 'mina').some((n) => n.name === 'b.txt'), 'deleted goes to the trash');
});

test('a person edit in Drive comes into the sandbox, and the agent is told', async () => {
  const upload = drive.startReplace(ddb, a.id, 'mina', drive.nodeFor(ddb, a.id, 'mina').contentVersion, { size: 5, mime: 'text/plain' }, 1e9);
  const blob = drive.newId();
  mkdirSync(dirname(drive.blobPath(drive.root, blob)), { recursive: true });
  writeFileSync(drive.blobPath(drive.root, blob), 'ALPHA');
  drive.finishUpload(ddb, upload, blob);
  const news = await access.syncOpened(db, config, ws);
  assert.deepEqual(news, ['/files/Photos/2026/a.txt']);
  assert.equal(text('.kimono/files/Photos/2026/a.txt'), 'ALPHA');
});

test("in a space they can only view, it's read only, and changes are put back", async () => {
  const asked = await access.onRequest(db, config, ws, null, { id: '1-00000003', space: 'Family', path: '', need: 'change', why: 'To fix the plan.' });
  const answered = await access.answer(db, config, ws, 'mina', asked.event.id, 'chat');
  assert.equal(answered.event.need, 'read');
  assert.match(answered.carryOn, /read only/);
  assert.equal(text('.kimono/files/Family/plan.txt'), 'trip');
  sandboxFiles.set('.kimono/files/Family/plan.txt', Buffer.from('hacked'));
  sandboxFiles.set('.kimono/files/Family/extra.txt', Buffer.from('new'));
  await access.syncOpened(db, config, ws);
  assert.equal(text('.kimono/files/Family/plan.txt'), 'trip', 'put back from Drive');
  assert.deepEqual(drive.childrenOf(ddb, family.rootId, 'mina').children.map((c) => c.name), ['plan.txt'], 'nothing uploaded');
});

test('always allowed: another chat gets it without asking', async () => {
  const ws2 = model.createWorkspace(db, 'mina', { repoOwner: 'mina', repoName: 'notes', base: 'main', prompt: 'Another' });
  access.setSpaceAuto(db, 'mina', photos.id, 'read');
  const asked = await access.onRequest(db, config, ws2, null, { id: '1-00000004', space: 'Photos', path: '2026/a.txt', need: 'read', why: 'Look.' });
  assert.equal(asked.event.state, 'auto');
  assert.match(asked.carryOn, /already allowed/);
  const changing = await access.onRequest(db, config, ws2, null, { id: '1-00000005', space: 'Photos', path: '2026', need: 'change', why: 'Edit.' });
  assert.equal(changing.event.state, 'pending', 'read always does not give change');
});

test('taking a permission back empties the sandbox of it', async () => {
  const ws3 = model.createWorkspace(db, 'mina', { repoOwner: 'mina', repoName: 'notes', base: 'main', prompt: 'Third' });
  sandboxFiles.clear();
  const asked = await access.onRequest(db, config, ws3, null, { id: '1-00000006', space: 'Photos', path: '2026/a.txt', need: 'read', why: 'Look.' });
  assert.equal(asked.event.state, 'auto');
  assert.equal(text('.kimono/files/Photos/2026/a.txt'), 'ALPHA');
  access.setSpaceAuto(db, 'mina', photos.id, null);
  await access.syncOpened(db, config, ws3);
  assert.equal(sandboxFiles.has('.kimono/files/Photos/2026/a.txt'), false);
});

test('only one file: picked from what was asked for', async () => {
  const ws4 = model.createWorkspace(db, 'mina', { repoOwner: 'mina', repoName: 'notes', base: 'main', prompt: 'Fourth' });
  sandboxFiles.clear();
  const asked = await access.onRequest(db, config, ws4, null, { id: '1-00000007', space: 'Photos', path: '2026', need: 'read', why: 'One.' });
  await assert.rejects(access.answer(db, config, ws4, 'mina', asked.event.id, 'file', family.rootId), /Pick a file/);
  await access.answer(db, config, ws4, 'mina', asked.event.id, 'file', a.id);
  assert.deepEqual([...sandboxFiles.keys()], ['.kimono/files/Photos/2026/a.txt']);
});

test("a chat opens another of the person's chats' files without asking", async () => {
  const codeDb = (await import('../src/lib/code/drive.ts')).codeSpaceOf(db, 'mina');
  const codeSpace = drive.spacesOf(ddb, 'mina').find((s) => s.id === codeDb);
  const chats = drive.createFolder(ddb, codeSpace.rootId, 'mina', 'Chats');
  const other = drive.createFolder(ddb, chats.id, 'mina', 'Plan the trip');
  await put(other.id, 'mina', 'itinerary.md', 'day one');
  const ws5 = model.createWorkspace(db, 'mina', { prompt: 'Fifth' });
  sandboxFiles.clear();
  const asked = await access.onRequest(db, config, ws5, null, { id: '1-00000008', space: 'AI', path: 'Chats/Plan the trip', need: 'change', why: 'To build on the plan.' });
  assert.equal(asked.event.state, 'auto');
  assert.equal(text('.kimono/files/AI/Chats/Plan the trip/itinerary.md'), 'day one');
});

test('a video over the old 50 MB cap streams in whole, with its length said', async () => {
  const school = drive.createSpace(ddb, 'mina', { name: 'School' });
  const big = Buffer.alloc(60 * 1024 * 1024, 7);
  const blob = drive.newId();
  const path = drive.blobPath(drive.root, blob);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, big);
  drive.addFile(ddb, school.rootId, 'mina', { name: '1108.mp4', size: big.length, mime: 'video/mp4', blob });
  const ws6 = model.createWorkspace(db, 'mina', { prompt: 'Make my video smaller' });
  sandboxFiles.clear();
  const asked = await access.onRequest(db, config, ws6, null, { id: '1-00000009', space: 'School', path: '', need: 'change', why: 'To shrink it.' });
  await access.answer(db, config, ws6, 'mina', asked.event.id, 'chat');
  const got = sandboxFiles.get('.kimono/files/School/1108.mp4');
  assert.ok(got, 'the video is in the sandbox');
  assert.equal(sha1(got), sha1(big));
  assert.equal(putLengths.get('.kimono/files/School/1108.mp4'), String(big.length), 'the node is told how long it is');

  /* What the agent makes goes back to Drive, streamed the other way. */
  const small = Buffer.alloc(45 * 1024 * 1024, 3);
  sandboxFiles.set('.kimono/files/School/1108 (720p).mp4', small);
  await access.syncOpened(db, config, ws6);
  const made = drive.childrenOf(ddb, school.rootId, 'mina').children.find((c) => c.name === '1108 (720p).mp4');
  assert.ok(made, 'the smaller copy is in Drive');
  assert.equal(made.size, small.length);
  assert.equal(sha1((await import('node:fs')).readFileSync(drive.blobPath(drive.root, drive.nodeFor(ddb, made.id, 'mina').blob))), sha1(small));
});

test("a file the sandbox hasn't room for is named to the agent, once", async () => {
  const space = drive.createSpace(ddb, 'mina', { name: 'Clips' });
  await put(space.rootId, 'mina', 'long.mp4', 'x'.repeat(5000));
  const ws7 = model.createWorkspace(db, 'mina', { prompt: 'Clips' });
  sandboxFiles.clear();
  sandboxRoom = 1000;
  try {
    const asked = await access.onRequest(db, config, ws7, null, { id: '1-0000000a', space: 'Clips', path: '', need: 'read', why: 'Look.' });
    const answered = await access.answer(db, config, ws7, 'mina', asked.event.id, 'chat');
    assert.equal(sandboxFiles.has('.kimono/files/Clips/long.mp4'), false);
    assert.match(answered.carryOn, /Some of it isn't here: \/files\/Clips\/long\.mp4 \(in their Drive but not here: it's 1 MB and the sandbox has 1 MB free/);
    assert.equal((await access.syncOpened(db, config, ws7)).length, 0, 'not said again');
    sandboxRoom = Infinity;
    const later = await access.syncOpened(db, config, ws7);
    assert.ok(sandboxFiles.has('.kimono/files/Clips/long.mp4'), 'with room, it comes in');
    assert.deepEqual(later, ['/files/Clips/long.mp4']);
  } finally { sandboxRoom = Infinity; }
});

test('a file over 4 GB stays in Drive, and the agent hears why', async () => {
  const space = drive.createSpace(ddb, 'mina', { name: 'Raw' });
  drive.addFile(ddb, space.rootId, 'mina', { name: 'huge.mov', size: 5 * 1024 ** 3, mime: 'video/quicktime', blob: drive.newId() });
  const ws8 = model.createWorkspace(db, 'mina', { prompt: 'Raw' });
  sandboxFiles.clear();
  const asked = await access.onRequest(db, config, ws8, null, { id: '1-0000000b', space: 'Raw', path: '', need: 'read', why: 'Look.' });
  const answered = await access.answer(db, config, ws8, 'mina', asked.event.id, 'chat');
  assert.match(answered.carryOn, /huge\.mov \(in their Drive but not here: it's 5\.0 GB, and files over 4 GB stay in Drive\)/);
  assert.equal((await access.syncOpened(db, config, ws8)).length, 0, 'not said again');
});
