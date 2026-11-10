/*
 * Attaching a file over 20 MB: it is a file in the chat's Drive folder, picked
 * through fromDrive, and it streams into the sandbox where Drive has it. A real
 * Drive (in a temporary folder, switched on) and a stand-in node that keeps a
 * sandbox's files in memory.
 * Run with: node --conditions=react-server --test scripts/test-big-attachments.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const state = mkdtempSync(join(tmpdir(), 'kimono-big-'));
process.env.KIMONO_STATE_DIR = state;
/* Drive switched on, as an administrator would in Applications. */
writeFileSync(join(state, 'settings.json'), JSON.stringify({ version: 4, apps: { 'kimono-drive': { id: 'kimono-drive', definitionId: 'kimono-drive', enabled: true } } }));

const drive = await import('../src/lib/drive/index.ts');
const model = await import('../src/lib/code/model.ts');
const code = await import('../src/lib/code/drive.ts');

const sha1 = (b) => createHash('sha1').update(b).digest('hex');
/* The node: a sandbox's files by path, and the length each PUT said it had. */
const sandboxFiles = new Map();
const putLengths = new Map();
const node = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://node');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const path = url.searchParams.get('path');
    if (url.pathname.endsWith('/file') && req.method === 'PUT') {
      putLengths.set(path, req.headers['content-length']);
      sandboxFiles.set(path, Buffer.concat(chunks));
      res.writeHead(204); return res.end();
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"no"}');
  });
});
await new Promise((r) => node.listen(0, '127.0.0.1', r));
test.after(() => node.close());
const config = { nodeAddress: `http://127.0.0.1:${node.address().port}`, nodeKey: 'k' };

const ddb = drive.db();
function put(parentId, owner, name, bytes, mime = 'video/mp4') {
  const blob = drive.newId();
  const path = drive.blobPath(drive.root, blob);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return drive.addFile(ddb, parentId, owner, { name, size: bytes.length, mime, blob });
}

const db = new DatabaseSync(':memory:');
model.migrate(db);
const ws = model.createWorkspace(db, 'mina', { prompt: 'Make my video smaller for Moodle' });
const big = Buffer.alloc(25 * 1024 * 1024 + 1, 9);
const school = drive.createSpace(ddb, 'mina', { name: 'School' });

test('a big file picked from Drive comes back as the Drive file, streamed in whole', async () => {
  const clip = put(school.rootId, 'mina', 'clip.mp4', big);
  const [picked] = await code.fromDrive(db, config, ws, 'mina', [clip.id]);
  assert.ok('attachment' in picked, 'not handed back as bytes');
  const a = picked.attachment;
  assert.equal(a.path, '/workspace/clip.mp4');
  assert.equal(a.size, big.length);
  assert.equal(a.type, 'video/mp4');
  assert.ok(a.node && a.node !== clip.id, 'a copy in the chat folder, not their own file');
  assert.equal(sha1(sandboxFiles.get('clip.mp4')), sha1(big));
  assert.equal(putLengths.get('clip.mp4'), String(big.length), 'the node is told how long it is');
  /* The chat can show it, and only what is in its folder. */
  const fresh = model.workspaceFor(db, ws.id, 'mina');
  assert.equal(code.driveAttachment(fresh, a.node).size, big.length);
  assert.throws(() => code.driveAttachment(fresh, clip.id), (e) => e.status === 404);
});

test('uploaded into the chat folder first, it is attached where it is, not copied', async () => {
  const folder = await code.uploadFolder(db, ws, 'mina');
  const before = drive.childrenOf(ddb, folder, 'mina').children.length;
  const uploaded = put(folder, 'mina', '1108.mp4', big);
  const [picked] = await code.fromDrive(db, config, ws, 'mina', [uploaded.id]);
  assert.equal(picked.attachment.node, uploaded.id);
  assert.equal(picked.attachment.path, '/workspace/1108.mp4');
  assert.equal(drive.childrenOf(ddb, folder, 'mina').children.length, before + 1, 'no second copy');
  assert.equal(sha1(sandboxFiles.get('1108.mp4')), sha1(big));
});

test('small files still come back as bytes, in the order asked', async () => {
  const note = put(school.rootId, 'mina', 'notes.txt', Buffer.from('slide 5'), 'text/plain');
  const clip2 = put(school.rootId, 'mina', 'clip2.mp4', big);
  const picked = await code.fromDrive(db, config, ws, 'mina', [note.id, clip2.id]);
  assert.equal(Buffer.from(picked[0].bytes).toString(), 'slide 5');
  assert.equal(picked[1].attachment.name, 'clip2.mp4');
});

test('only the chat\'s owner gets its folder to upload into', async () => {
  await assert.rejects(code.uploadFolder(db, ws, 'sam'), (e) => e.status === 403);
});
