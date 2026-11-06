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
      if (req.method === 'PUT') { sandboxFiles.set(path, Buffer.concat(chunks)); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{}'); }
      if (req.method === 'DELETE') { sandboxFiles.delete(path); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{}'); }
      if (sandboxFiles.has(path)) { res.writeHead(200); return res.end(sandboxFiles.get(path)); }
      res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"no"}');
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => node.listen(0, '127.0.0.1', r));
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
  assert.match(note, /^Drive spaces you can ask for: (Code, )?Family, Photos\./);
  assert.match(note, /keeps its files in the "Code" space/, "it's told where the person's chats keep their files");
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
  const asked = await access.onRequest(db, config, ws5, null, { id: '1-00000008', space: 'Code', path: 'Chats/Plan the trip', need: 'change', why: 'To build on the plan.' });
  assert.equal(asked.event.state, 'auto');
  assert.equal(text('.kimono/files/Code/Chats/Plan the trip/itinerary.md'), 'day one');
  node.close();
});
